import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import AdmZip from 'adm-zip';

const [coreArgument,moduleArgument]=process.argv.slice(2);
if(!coreArgument||!moduleArgument)throw new Error('Usage: node scripts/verify-separated-installation.mjs <Core folder> <module package>');
const core=path.resolve(coreArgument),artifact=path.resolve(moduleArgument);
assert.equal(fs.existsSync(path.join(core,'packages/audiobooks')),false,'Core source must physically lack Audiobooks.');
const bytes=fs.readFileSync(artifact),manifest=JSON.parse(new AdmZip(bytes).readAsText('module.json'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'swissmouse-separated-'));
const guard=path.join(root,'resolution-guard.cjs');
fs.writeFileSync(guard,`const path=require('node:path'),Module=require('node:module'),resolve=Module._resolveFilename;const allowed=path.resolve(process.env.SWISSMOUSE_TEST_NODE_MODULES)+path.sep;Module._resolveFilename=function(...args){const file=resolve.apply(this,args);if(typeof file==='string'&&file.includes('node_modules')&&!path.resolve(file).startsWith(allowed))throw new Error('Dependency escaped isolated installation: '+file);return file;};`);
fs.writeFileSync(path.join(root,'module-trust.json'),JSON.stringify({schemaVersion:1,packages:[{id:manifest.id,publisher:manifest.publisher,version:manifest.version,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
fs.writeFileSync(path.join(root,'jobs.json'),JSON.stringify([{id:'preserved-book',name:'Existing title',status:'draft',createdAt:'2026-01-01',parts:[],chapters:[{id:'chapter-1',title:'Existing chapter',start:'00:00:00.000'}],logs:[],candidates:[],metadata:{title:'Existing title',author:'Doe, Jane',authors:['Doe, Jane'],narrator:'Reader',series:'Kept series',genres:['Fantasy'],language:'en',abridged:false,explicit:false},metadataDraft:{title:'Unfinished draft'},transcriptSegments:[{text:'Saved transcript',start:0,end:1}],personalRating:7}]));
let child,base='',output='';
const wait=milliseconds=>new Promise(done=>setTimeout(done,milliseconds));
async function start(){
  output='';child=spawn(process.execPath,[path.join(core,'dist/core-server.cjs')],{cwd:core,windowsHide:true,env:{...process.env,APP_ROOT:root,PORT:'0',SWISSMOUSE_CORE_ASSETS:path.join(core,'dist/core'),SWISSMOUSE_INFORMATION_DURABLE:'1',SWISSMOUSE_INFORMATION_DIRECTORY:'1',SWISSMOUSE_RUNTIME_MODE:'managed',SWISSMOUSE_TEST_NODE_MODULES:path.join(core,'node_modules'),NODE_OPTIONS:'--require='+JSON.stringify(guard.replaceAll('\\','/'))},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output=(output+bytes).slice(-16000);});
  const deadline=Date.now()+60000;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('Isolated Core exited: '+output);const match=output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);if(match){base=match[1];const state=await get('/api/core/status');if(!state.moduleActivationPending)return state;}await wait(100);}throw new Error('Isolated Core readiness failed: '+output);
}
async function stop(){if(!child)return;const stopped=once(child,'exit');child.kill('SIGTERM');await Promise.race([stopped,wait(15000).then(()=>{if(child.exitCode===null)throw new Error('Isolated Core did not shut down.');})]);child=undefined;}
async function get(route){const response=await fetch(base+route,{headers:{Connection:'close'},signal:AbortSignal.timeout(10000)});assert.ok(response.ok,await response.clone().text());return response.json();}
async function post(route,body){const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});assert.ok(response.ok,await response.clone().text());return response.json();}
try{
  let state=await start();assert.deepEqual(state.modules.modules,[]);assert.equal(state.processingInitialized,false);assert.equal((await fetch(base+'/api/jobs/preserved-book')).status,404);
  const form=new FormData();form.append('package',new Blob([bytes]),'audiobooks.smmodule');form.append('confirmed','true');let response=await fetch(base+'/api/modules/install',{method:'POST',body:form,headers:{Connection:'close'}});assert.ok(response.ok,await response.clone().text());await stop();state=await start();assert.equal(state.modules.modules[0].active,true,JSON.stringify(state.modules));
  const original=await get('/api/jobs/preserved-book');assert.equal(original.metadataDraft.title,'Unfinished draft');assert.equal(original.transcriptSegments[0].text,'Saved transcript');assert.equal(original.chapters[0].title,'Existing chapter');
  await post('/api/jobs/preserved-book/metadata',{metadata:{...original.metadata,title:'Independent installation edit'},expectedRevision:original.metadataRevision||0});
  await post('/api/modules/audiobooks/disable',{confirmed:true});await post('/api/core/resources/rebuild',{});assert.ok((await get('/api/core/resources')).items.some(item=>item.descriptor.title==='Independent installation edit'&&!item.available));
  await post('/api/modules/audiobooks/remove',{confirmed:true});await stop();
  const code=path.join(root,'.installed-modules',createHash('sha256').update(bytes).digest('hex'));assert.ok(path.resolve(code).startsWith(path.resolve(root)+path.sep));fs.rmSync(code,{recursive:true});
  state=await start();assert.deepEqual(state.modules.modules,[]);assert.equal((await fetch(base+'/api/jobs/preserved-book')).status,404);await post('/api/core/resources/rebuild',{});assert.ok((await get('/api/core/resources')).items.some(item=>item.descriptor.title==='Independent installation edit'));
  await post('/api/core/preferences',{theme:'dark'});assert.equal((await get('/api/appearance')).theme,'dark');
  const reinstall=new FormData();reinstall.append('package',new Blob([bytes]),'audiobooks.smmodule');reinstall.append('confirmed','true');response=await fetch(base+'/api/modules/install',{method:'POST',body:reinstall,headers:{Connection:'close'}});assert.ok(response.ok,await response.clone().text());await stop();state=await start();assert.equal(state.modules.modules[0].active,true,JSON.stringify(state.modules));const restored=await get('/api/jobs/preserved-book');assert.equal(restored.metadata.title,'Independent installation edit');assert.equal(restored.transcriptSegments[0].text,'Saved transcript');assert.equal(restored.personalRating,7);assert.equal(restored.chapters[0].title,'Existing chapter');
  console.log('PASS: independently built Core and Audiobook package; data outside installation; all Node dependencies confined to Core; install/save/disable/remove/code-absent rebuild/reinstall preserved chapters, transcript, draft and rating.');
}finally{await stop();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
