import fs from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import express from 'express';
import { InformationStore } from './information-store';
import { InformationProjection } from './information-projection';
import { inspectInformationUserFile } from './information-schema';
import { coreInformationBundle } from '../src/core/information-builtins';
import { ModuleHost } from './module-host';
import { registerModuleRoutes } from './module-routes';
import {readAppearance,saveAppearance,validThemeId} from '../packages/sdk/storage/appearance-preferences';

export interface CoreHostOptions {appRoot:string;staticDirectory?:string;trustFile?:string}
/** Neutral host entry. It never opens project stores or initializes external processing tools. */
export async function createCoreHost(options:CoreHostOptions) {
  const root=path.resolve(options.appRoot);fs.mkdirSync(root,{recursive:true});
  const app=express();
  app.use((req,res,next)=>{
    if(!['localhost','127.0.0.1','::1','[::1]'].includes(req.hostname))return res.status(403).json({error:'Core development host accepts localhost requests only.'});
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')){
      try{if(new URL(req.get('origin')!).origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Core changes must come from this installation.'});}catch{return res.status(403).json({error:'Invalid request origin.'});}
    }
    next();
  });
  app.use('/api/core',express.json({limit:'1mb'}));
  app.use(express.json({limit:'50mb'}));
  const logs:{time:string;level:string;message:string}[]=[];
  const log=(message:string,level='info')=>{logs.push({time:new Date().toISOString(),level,message});if(logs.length>500)logs.shift();};
  const preferenceFile=path.join(root,'core-preferences.json');
  const appearanceFile=path.join(root,'ui-preferences.json');
  let preferences:Record<string,unknown>={schemaVersion:1,theme:'forest'};
  if(fs.existsSync(preferenceFile)){
    const saved=JSON.parse(fs.readFileSync(preferenceFile,'utf8'));
    if(!saved||saved.schemaVersion!==1||typeof saved.theme!=='string')throw new Error('Unsupported Core preferences. Keep the original file.');
    preferences=saved;
  }
  const userFile=path.join(root,'catalog.sqlite.user.sqlite');
  const legacyIdentityOnly=fs.existsSync(userFile)&&inspectInformationUserFile(userFile)===0;
  let information:InformationStore|undefined,index:DatabaseSync|undefined,projection:InformationProjection|undefined,legacy:DatabaseSync|undefined;
  if(!legacyIdentityOnly){
    information=new InformationStore(userFile);information.registerDefinitions([coreInformationBundle]);
    index=new DatabaseSync(path.join(root,'core-resources.sqlite'));index.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    projection=new InformationProjection(index,information);
  } else if(fs.existsSync(path.join(root,'catalog.sqlite'))){
    // Generic legacy resource summaries only. No opaque module payload interpretation or migration.
    legacy=new DatabaseSync(path.join(root,'catalog.sqlite'),{readOnly:true});
    if(!legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='resources'").get()){legacy.close();legacy=undefined;}
  }
  let rebuilding=false,applied=0,resourceError:string|undefined,closed=false;
  const catchUp=async(reset=false)=>{
    if(!projection)throw new Error('Retained publications are unavailable. Preserve existing stores and publish through the owning module before rebuilding.');
    if(rebuilding)throw new Error('A Core index rebuild is already active.');
    rebuilding=true;
    try{if(reset)projection.reset();while(!closed){const result=projection.advance(100);applied+=result.applied;if(!result.pending)break;await setImmediate();}resourceError=undefined;}
    catch(error){resourceError=String(error);throw error;}
    finally{rebuilding=false;}
  };
  const modules=new ModuleHost({appRoot:root,catalogFile:options.trustFile,applications:true,readRecord:async id=>information?.get(id)?.item as unknown as Readonly<Record<string,unknown>>|undefined});
  let moduleActivationPending=true;
  const moduleActivation=modules.start(process.env.SWISSMOUSE_MODULE_SAFE_MODE==='1').finally(()=>{moduleActivationPending=false;});
  registerModuleRoutes(app,modules,()=>rebuilding?'Wait for the Core index rebuild.':undefined);
  const activeOwners=()=>new Set(['core',...modules.list().modules.filter(module=>module.active).map(module=>module.id)]);
  app.get('/api/core/status',(_req,res)=>res.json({mode:'core',rebuilding,applied,resourceError,legacyIdentityOnly,processingInitialized:false,moduleActivationPending,modules:modules.list()}));
  app.get('/api/core/logs',(_req,res)=>res.json(logs));
  const appearance=()=>readAppearance(appearanceFile);
  app.get('/api/appearance',(_req,res)=>{try{res.json(appearance());}catch(error){res.status(409).json({error:String(error)});}});
  app.post('/api/appearance',(req,res)=>{try{res.json(saveAppearance(appearanceFile,req.body?.theme,req.body?.initialize===true));}catch(error){res.status(400).json({error:String(error)});}});
  app.get('/api/core/preferences',(_req,res)=>{try{res.json({...preferences,theme:appearance().theme||preferences.theme});}catch(error){res.status(409).json({error:String(error)});}});
  app.post('/api/core/preferences',(req,res)=>{
    try{
      if(rebuilding)throw new Error('Wait for the Core index rebuild.');
      if(!req.body||Object.keys(req.body).some(key=>key!=='theme')||!validThemeId(req.body.theme))throw new Error('Choose a supported Core theme.');
      const saved=saveAppearance(appearanceFile,req.body.theme);
      res.json({...preferences,theme:saved.theme});
    }catch(error){res.status(400).json({error:String(error)});}
  });
  app.get('/api/core/resources',(req,res)=>{
    try{
      if(resourceError)throw new Error(resourceError);
      const limit=req.query.limit===undefined?50:Number(req.query.limit);
      if(!Number.isSafeInteger(limit)||limit<1||limit>500||Object.keys(req.query).some(k=>!['limit','cursor'].includes(k))||req.query.cursor!==undefined&&typeof req.query.cursor!=='string')throw new Error('Invalid resource page.');
      if(projection){const page=projection.page({limit,cursor:req.query.cursor as string|undefined});const owners=activeOwners();res.json({...page,items:page.items.map(item=>({...item,available:owners.has(item.descriptor.owner),readOnly:true}))});}
      else {
        if(req.query.cursor!==undefined&&(!/^\d+$/.test(String(req.query.cursor))||Number(req.query.cursor)>10000000))throw new Error('Invalid legacy resource cursor.');
        const offset=Number(req.query.cursor||0),rows=legacy?.prepare('SELECT id,kind,module_id,title,version,archived FROM resources WHERE archived=0 ORDER BY title,id LIMIT ? OFFSET ?').all(limit+1,offset)||[];
        const more=rows.length>limit;if(more)rows.pop();
        res.json({items:rows.map(row=>({descriptor:{id:row.id,kind:row.kind,owner:row.module_id,title:row.title,revision:row.version},fields:{},relationships:[],memberships:[],available:false,readOnly:true})),nextCursor:more?String(offset+limit):undefined,stale:true,reason:'Generic legacy index only; retained publications have not been enabled.'});
      }
    }catch(error){res.status(409).json({error:String(error)});}
  });
  app.post('/api/core/resources/rebuild',async(_req,res)=>{
    try{await catchUp(true);log('Generic resource index rebuilt from retained publications.');res.json({rebuilt:true,applied});}
    catch(error){log(String(error),'error');res.status(409).json({error:String(error)});}
  });
  const fileRoot=fs.realpathSync(root);
  const resolveFile=(value:unknown,exists=true)=>{
    if(typeof value!=='string'||value.length>2000||path.isAbsolute(value)||value.includes('\0'))throw new Error('Expected a relative path in the granted workspace.');
    const candidate=path.resolve(fileRoot,value),parent=exists?fs.realpathSync(candidate):path.join(fs.realpathSync(path.dirname(candidate)),path.basename(candidate));
    const relative=path.relative(fileRoot,parent);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Path leaves the granted workspace.');
    return parent;
  };
  app.get('/api/core/files',async(req,res)=>{
    try{
      const requested=typeof req.query.path==='string'?req.query.path:'',directory=resolveFile(requested),limit=req.query.limit===undefined?100:Number(req.query.limit);
      if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new Error('Invalid directory page bound.');
      const cursor=typeof req.query.cursor==='string'?req.query.cursor:'';
      const names=await fs.promises.readdir(directory,{withFileTypes:true});names.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
      const items=[];for(const entry of names){if(entry.name<=cursor)continue;if(items.length===limit+1)break;items.push({name:entry.name,path:path.relative(fileRoot,path.join(directory,entry.name)),directory:entry.isDirectory(),link:entry.isSymbolicLink()});}
      const more=items.length>limit;if(more)items.pop();res.json({path:path.relative(fileRoot,directory),items,nextCursor:more?items.at(-1)?.name:undefined});
    }catch(error){res.status(400).json({error:String(error)});}
  });
  app.post('/api/core/files/folder',(req,res)=>{
    try{const destination=resolveFile(req.body?.path,false);fs.mkdirSync(destination);log('Created workspace folder.');res.json({created:true});}catch(error){res.status(409).json({error:String(error)});}
  });
  app.post('/api/core/files/copy',async(req,res)=>{
    let staged:string|undefined;
    try{
      if(req.body?.confirmed!==true)throw new Error('Confirm the source and destination preview before copying.');
      const source=resolveFile(req.body.source),destination=resolveFile(req.body.destination,false);
      if(!fs.statSync(source).isFile()||fs.existsSync(destination))throw new Error('Choose an existing file and an unused destination.');
      const before=fs.statSync(source);staged=destination+'.'+randomUUID()+'.partial';
      await fs.promises.copyFile(source,staged,fs.constants.COPYFILE_EXCL);
      const hash=async(file:string)=>{const result=createHash('sha256');for await(const bytes of fs.createReadStream(file))result.update(bytes);return result.digest('hex');};
      const [original,copied]=await Promise.all([hash(source),hash(staged)]),after=fs.statSync(source);
      if(original!==copied||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Source changed or copied contents failed verification.');
      // Hard-link publication fails on a destination collision instead of overwriting it.
      await fs.promises.link(staged,destination);await fs.promises.unlink(staged);staged=undefined;log('Verified workspace file copy.');res.json({copied:true,sha256:copied});
    }catch(error){if(staged)await fs.promises.unlink(staged).catch(()=>{});res.status(409).json({error:String(error)});}
  });
  app.get('/api/core/media',(req,res)=>{
    try{
      const file=resolveFile(req.query.path);if(!fs.statSync(file).isFile()||!['.mp3','.wav','.ogg','.flac','.m4a','.m4b','.mp4','.webm'].includes(path.extname(file).toLowerCase()))throw new Error('Choose a supported media file in the workspace.');
      res.sendFile(file,{acceptRanges:true});
    }catch(error){res.status(400).json({error:String(error)});}
  });
  app.use((req,res,next)=>{if(!modules.forward(req,res))next();});
  app.use('/api',(_req,res)=>res.status(404).json({error:'This operation is unavailable in Core or its owning module is absent.'}));
  if(options.staticDirectory){app.use(express.static(path.resolve(options.staticDirectory)));app.get('*',(_req,res)=>res.sendFile(path.resolve(options.staticDirectory!,'core.html')));}
  if(projection)try{await catchUp();}catch(error){log('Retained resources need index recovery: '+String(error),'error');}
  let warned='';
  const informationTimer=setInterval(()=>{
    if(closed||rebuilding)return;
    try{
      if(!information&&inspectInformationUserFile(userFile)>=1){
        information=new InformationStore(userFile);index=new DatabaseSync(path.join(root,'core-resources.sqlite'));projection=new InformationProjection(index,information);legacy?.close();legacy=undefined;
      }
      if(projection)void catchUp().catch(error=>{const message=String(error);if(message!==warned){warned=message;log(message,'error');}});
    }catch(error){const message=String(error);if(message!==warned){warned=message;log(message,'error');}}
  },1000);informationTimer.unref();
  log('Core started without module project interpretation or external processing initialization.');
  return {app,modules,root,moduleActivation,close:()=>{closed=true;clearInterval(informationTimer);legacy?.close();index?.close();information?.close();return modules.close();}};
}
