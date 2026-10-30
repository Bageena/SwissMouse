import {useEffect,useState} from 'react';
import type {InformationReadItem} from '../../packages/sdk/information';
import {ApplicationBoundary,loadApplication,type LoadedApplication,type InstalledApplication} from './application-loader';
import {persistTheme,themes} from '../../packages/sdk/appearance';
import './core-workbench.css';

async function request(url:string,body?:unknown){const response=await fetch(url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed.');return value;}
type Resource=InformationReadItem&{available:boolean;readOnly:true};
export default function CoreWorkbench(){
  const [view,setView]=useState('resources'),[resources,setResources]=useState<Resource[]>([]),[cursor,setCursor]=useState<string>(),[selected,setSelected]=useState<Resource>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [directory,setDirectory]=useState(''),[files,setFiles]=useState<{name:string;path:string;directory:boolean;link:boolean}[]>([]),[media,setMedia]=useState(''),[preferences,setPreferences]=useState<{theme:string}>({theme:'forest'}),[status,setStatus]=useState<any>(),[logs,setLogs]=useState<any[]>([]);
  const [installed,setInstalled]=useState<InstalledApplication[]>([]),[loaded,setLoaded]=useState<LoadedApplication[]>([]),[packageFile,setPackageFile]=useState<File>(),[inspection,setInspection]=useState<any>();
  const run=async(action:()=>Promise<void>)=>{setError('');setBusy(true);try{await action();}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const loadResources=async(next?:string)=>{const page=await request('/api/core/resources?limit=50'+(next?'&cursor='+encodeURIComponent(next):''));setResources(next?old=>[...old,...page.items]:page.items);setCursor(page.nextCursor);};
  const loadFiles=async(path:string)=>{const page=await request('/api/core/files?path='+encodeURIComponent(path));setDirectory(page.path);setFiles(page.items);};
  const refreshModules=async()=>setInstalled((await request('/api/modules')).modules);
  useEffect(()=>{void run(async()=>{const [settings,state]=await Promise.all([request('/api/core/preferences'),request('/api/core/status')]);setPreferences(settings);persistTheme(settings.theme);setStatus(state);await Promise.all([loadResources(),refreshModules()]);});},[]);
  // Loading is cancellable so React StrictMode and failed imports leave no active registrations.
  useEffect(()=>{let cancelled=false;const applications:LoadedApplication[]=[];
    void (async()=>{for(const module of installed.filter(item=>item.active&&item.apiVersion===2)){
      try{const application=await loadApplication(module,()=>setView('preferences'));if(cancelled){application.dispose();return;}applications.push(application);}
      catch(error){if(!cancelled)setError(String(error));}
    }if(!cancelled)setLoaded([...applications]);})();
    return()=>{cancelled=true;applications.forEach(application=>application.dispose());};
  },[installed]);
  const navigate=(next:string)=>{setView(next);void run(async()=>{if(next==='files')await loadFiles(directory);if(next==='logs')setLogs(await request('/api/core/logs'));if(next==='modules')setStatus(await request('/api/core/status'));});};
  const prepareChange=async()=>{if(loaded.some(app=>app.contribution.hasUnsavedPreferences?.()))throw new Error('Save your module preferences before changing installed modules.');for(const app of loaded)if(app.contribution.prepareDeactivate&&!await app.contribution.prepareDeactivate())return false;return true;};
  const changeModule=async(id:string,action:string)=>{if(!await prepareChange())return;await request('/api/modules/'+encodeURIComponent(id)+'/'+action,{confirmed:true});setLoaded([]);await refreshModules();};
  const uploadPackage=async(install=false)=>{if(!packageFile)throw new Error('Choose a module package first.');if(install&&!await prepareChange())return;const data=new FormData();data.append('package',packageFile);if(install)data.append('confirmed','true');const response=await fetch('/api/modules/'+(install?'install':'inspect'),{method:'POST',body:data});const result=await response.json();if(!response.ok)throw new Error(result.error||'Package verification failed.');if(install){setInspection(undefined);setPackageFile(undefined);setLoaded([]);await refreshModules();}else setInspection(result.inspection);};
  return <div className="core-workbench" data-theme={preferences.theme}>
    <header><h1>SwissMouse</h1><nav aria-label="Core tools">{[['resources','Library'],['files','File Browser'],['player','Audio Player'],['preferences','Preferences'],['modules','Modules'],['logs','Technical Logs'],...loaded.map(app=>['module:'+app.module.id,app.module.name])].map(([id,label])=><button key={id} type="button" aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}>{label}</button>)}</nav></header>
    <main>{error&&<p role="alert">{error}</p>}{busy&&<p role="status">Working…</p>}
      {view==='resources'&&<><h2>Managed resources</h2><p>Retained descriptions remain available when their module is absent.</p><button type="button" disabled={busy} onClick={()=>void run(async()=>{await request('/api/core/resources/rebuild',{});await loadResources();})}>Rebuild generic index</button>
        {!resources.length&&<p>No retained resources yet. Install a module to add specialized tools.</p>}
        <ul>{resources.map(item=><li key={item.descriptor.id}><button type="button" onClick={()=>setSelected(item)}>{item.descriptor.title}</button> <small>{item.descriptor.owner}{!item.available?' · module unavailable':''}</small></li>)}</ul>
        {cursor&&<button type="button" onClick={()=>void run(()=>loadResources(cursor))}>More resources</button>}
        {selected&&<section aria-label="Retained resource"><h3>{selected.descriptor.title}</h3><p>{selected.available?'Read-only resource description.':'Module unavailable. Its saved data has been preserved.'}</p><dl>{Object.entries(selected.fields).slice(0,30).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{(Array.isArray(value)?value.join(', '):String(value??'')).slice(0,10000)}</dd></div>)}</dl></section>}
      </>}
      {view==='files'&&<><h2>File Browser</h2><p>Granted workspace: {directory||'root'}</p><button type="button" onClick={()=>void run(()=>loadFiles(''))}>Workspace root</button><ul>{files.map(file=><li key={file.path}>{file.directory?<button type="button" disabled={file.link} onClick={()=>void run(()=>loadFiles(file.path))}>{file.name}/</button>:<><span>{file.name}</span>{/\.(mp3|m4a|m4b|mp4|wav|ogg|flac|webm)$/i.test(file.name)&&<button type="button" onClick={()=>{setMedia(file.path);setView('player');}}>Play</button>}</>}</li>)}</ul></>}
      {view==='player'&&<><h2>Audio Player</h2><p>{media||'Choose media from File Browser. No speech engine is needed for native browser playback.'}</p><audio controls src={media?'/api/core/media?path='+encodeURIComponent(media):undefined}/></>}
      <div hidden={view!=='preferences'}><h2>Preferences</h2><label>Theme <select value={preferences.theme} onChange={event=>void run(async()=>{const settings=await request('/api/core/preferences',{theme:event.target.value});setPreferences(settings);persistTheme(settings.theme);})}>{themes.map(theme=><option key={theme}>{theme}</option>)}</select></label>
        {loaded.map(app=>{const Panel=app.contribution.Preferences;return Panel?<ApplicationBoundary key={app.module.id} name={app.module.name}><Panel/></ApplicationBoundary>:null;})}
        <section><h3>Requirements</h3>{!loaded.length&&<p>Core requires no optional processing tools. Install a module to see its requirements here.</p>}{loaded.map(app=>{const Panel=app.contribution.Requirements;return Panel?<ApplicationBoundary key={app.module.id} name={app.module.name}><Panel/></ApplicationBoundary>:null;})}</section>
      </div>
      {view==='modules'&&<><h2>Modules</h2><p>Install an approved package, then restart SwissMouse to activate it. Disabling or removing a module preserves its saved data.</p>{status?.modules?.registryError&&<p role="alert">{status.modules.registryError}</p>}<ul>{installed.map(module=><li key={module.id}>{module.name} · {module.version} · {module.active?'active':module.error||'inactive'}{module.restartRequired&&' · restart required'} <button disabled={busy} type="button" onClick={()=>void run(()=>changeModule(module.id,module.enabled?'disable':'enable'))}>{module.enabled?'Disable':'Enable'}</button> <button disabled={busy} type="button" onClick={()=>void run(()=>changeModule(module.id,'remove'))}>Remove module</button></li>)}</ul>
        <label>Approved module package <input type="file" accept=".smmodule" onChange={event=>{setPackageFile(event.target.files?.[0]);setInspection(undefined);}}/></label><button disabled={busy||!packageFile} type="button" onClick={()=>void run(()=>uploadPackage())}>Inspect package</button>
        {inspection&&<section><h3>{inspection.name} · {inspection.version}</h3><p>Publisher: {inspection.publisher}. Trusted extensions run with this installation’s access. External programs and models are installed separately.</p><ul>{Object.entries(inspection.application?.requirements||{}).map(([id,value])=>{const detail=value as any;return <li key={id}><a href={detail.website} target="_blank" rel="noreferrer">{id}</a> — {detail.description} <a href={detail.licenseUrl} target="_blank" rel="noreferrer">{detail.license}</a></li>;})}</ul><button disabled={busy} type="button" onClick={()=>void run(()=>uploadPackage(true))}>Install this verified package</button></section>}
      </>}
      {view==='logs'&&<><h2>Technical Logs</h2><ol>{logs.map((entry,index)=><li key={index}>{entry.time} · {entry.message}</li>)}</ol></>}
    </main>
    {loaded.map(app=>{const Workspace=app.contribution.Workspace;return <div key={app.module.id} hidden={view!=='module:'+app.module.id}><ApplicationBoundary name={app.module.name}><Workspace/></ApplicationBoundary></div>;})}
  </div>;
}
