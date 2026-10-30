import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import AdmZip from 'adm-zip';
import {createCoreHost} from './core-host';
import {moduleDigest,validateModuleManifest} from './module-host';
import {createTestFixture} from './test-fixtures.mjs';

function candidate(backend:string){
  const files={'browser.mjs':'export async function activate(){return {Workspace:()=>null}}','backend.cjs':backend,'source.txt':'Synthetic protocol fixture, not application source.'};
  const manifest={format:'swissmouse.module',id:'example',publisher:'swissmouse-development',name:'Example',version:'0.0.2',apiVersion:2,sdkVersion:'0.0.2',reactMajor:18,browser:'browser.mjs',backend:'backend.cjs',styles:[],assets:['source.txt'],operations:[],panels:[],files:Object.fromEntries(Object.entries(files).map(([id,value])=>[id,moduleDigest(value)])),application:{kind:'node-http-workspace',health:'/api/example/health',prepareRemoval:'/api/example/prepare',routes:['/api/example'],requirements:{},publicAssets:{}}};
  const zip=new AdmZip();zip.addFile('module.json',Buffer.from(JSON.stringify(manifest)));for(const[id,value]of Object.entries(files))zip.addFile(id,Buffer.from(value));const bytes=zip.toBuffer();
  return {manifest,bytes,trust:{schemaVersion:1,packages:[{id:manifest.id,publisher:manifest.publisher,version:manifest.version,sha256:moduleDigest(bytes)}]}};
}
const backend=`const http=require('node:http');let busy=true;http.createServer((req,res)=>{if(req.headers['x-swissmouse-module-token']!==process.env.SWISSMOUSE_MODULE_CHILD_TOKEN){res.writeHead(403);return res.end('{}');}res.setHeader('Content-Type','application/json');if(req.url==='/api/example/health')return res.end('{}');if(req.url==='/api/example/unlock'){busy=false;return res.end('{}');}if(req.url==='/api/example/prepare'){if(busy){res.statusCode=409;return res.end(JSON.stringify({error:'Active fixture operation'}));}return res.end('{}');}let chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>res.end(JSON.stringify({body:Buffer.concat(chunks).toString(),host:req.headers.host})));}).listen(Number(process.env.PORT),'127.0.0.1');`;

test('full protocol rejects reserved routes, incompatible SDKs and invalid requirement links before activation',()=>{
  const {manifest}=candidate(backend);assert.equal(validateModuleManifest(manifest,true).apiVersion,2);
  assert.throws(()=>validateModuleManifest(manifest),/incompatible/);
  assert.throws(()=>validateModuleManifest({...manifest,sdkVersion:'0.0.1'},true),/SDK/);
  assert.throws(()=>validateModuleManifest({...manifest,application:{...manifest.application,routes:['/api/core']}},true),/contract/);
  assert.throws(()=>validateModuleManifest({...manifest,application:{...manifest.application,requirements:{engine:{description:'Bad URL',website:'javascript:alert(1)',license:'MIT',licenseUrl:'https://example.com/license',usedBy:'Example'}}}},true),/metadata/);
});

test('full process forwarding preserves empty JSON and Core availability; active work blocks removal',{timeout:30000},async t=>{
  const f=createTestFixture('.cache/application-protocol-'),packageData=candidate(backend);fs.writeFileSync(path.join(f.root,'module-trust.json'),JSON.stringify(packageData.trust));
  let host=await createCoreHost({appRoot:f.root});host.modules.install(packageData.bytes);await host.close();host=await createCoreHost({appRoot:f.root});
  const server=host.app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await host.close();f.cleanup();});await host.moduleActivation;
  assert.equal(host.modules.list().modules[0].active,true);
  const post=(route:string,value:unknown)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const echoed=await (await post('/api/example/echo',{})).json();assert.equal(echoed.body,'{}');assert.equal(echoed.host,new URL(base).host);
  let removed=await post('/api/modules/example/disable',{confirmed:true});assert.equal(removed.status,400);assert.match((await removed.json()).error,/Active fixture operation/);assert.equal(host.modules.list().modules[0].active,true);
  assert.equal((await fetch(base+'/api/core/status')).status,200);
  await post('/api/example/unlock',{});removed=await post('/api/modules/example/disable',{confirmed:true});assert.equal(removed.status,200);assert.equal((await fetch(base+'/api/example/echo')).status,404);
  assert.equal((await fetch(base+'/api/core/status')).status,200);
});

test('failed full-module startup leaves Core and opaque saved data available',{timeout:15000},async t=>{
  const f=createTestFixture('.cache/application-failure-'),packageData=candidate('throw new Error("Synthetic startup failure");');fs.writeFileSync(path.join(f.root,'module-trust.json'),JSON.stringify(packageData.trust));fs.writeFileSync(path.join(f.root,'jobs.json'),'opaque module data');
  let host=await createCoreHost({appRoot:f.root});host.modules.install(packageData.bytes);await host.close();host=await createCoreHost({appRoot:f.root});t.after(async()=>{await host.close();f.cleanup();});await host.moduleActivation;
  const module=host.modules.list().modules[0];assert.equal(module.active,false);assert.match(module.error||'',/Synthetic startup failure|exited|stopped/);assert.equal(fs.readFileSync(path.join(f.root,'jobs.json'),'utf8'),'opaque module data');
});

test('pending publications block removal without leaving the module drained',{timeout:15000},async t=>{
  const script="const http=require('node:http');http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/example/prepare'?{publicationPending:true,historyPending:true}:{}));}).listen(Number(process.env.PORT),'127.0.0.1');";
  const f=createTestFixture('.cache/application-pending-'),data=candidate(script);fs.writeFileSync(path.join(f.root,'module-trust.json'),JSON.stringify(data.trust));
  let host=await createCoreHost({appRoot:f.root});host.modules.install(data.bytes);await host.close();host=await createCoreHost({appRoot:f.root});
  const server=host.app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await host.close();f.cleanup();});await host.moduleActivation;
  await assert.rejects(host.modules.prepareChange('example','disable'),/finish saving/);assert.equal(host.modules.list().modules[0].active,true);
  assert.equal((await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/example/echo')).status,200);
});
