import * as React from 'react';
import * as ReactDOM from 'react-dom';
import type {ApplicationBrowserContribution} from '../../packages/sdk/applications';

export interface InstalledApplication {id:string;name:string;apiVersion:number;active:boolean;browser?:string;styles:string[];enabled:boolean;version:string;error?:string;restartRequired?:boolean}
export interface LoadedApplication {module:InstalledApplication;contribution:ApplicationBrowserContribution;dispose:()=>void}

/** Trusted packages run with the same browser privileges as Core, using one React runtime. */
export async function loadApplication(module:InstalledApplication,openPreferences:()=>void):Promise<LoadedApplication>{
  if(module.apiVersion!==2||!module.active||!module.browser)throw new Error('This application is not active.');
  Object.assign(globalThis,{__SWISSMOUSE_MODULE_REACT__:React,__SWISSMOUSE_MODULE_REACT_DOM__:ReactDOM});
  const styles=module.styles.map(url=>{const link=document.createElement('link');link.rel='stylesheet';link.href=url;document.head.append(link);return link;});
  try{
    const entry=await import(/* @vite-ignore */ module.browser);
    if(typeof entry.activate!=='function')throw new Error('The module has no application entry point.');
    const contribution:ApplicationBrowserContribution=await entry.activate({apiVersion:2,React,openPreferences});
    if(typeof contribution?.Workspace!=='function'){contribution?.dispose?.();throw new Error('The module did not supply a workspace.');}
    let disposed=false;
    return {module,contribution,dispose:()=>{if(disposed)return;disposed=true;try{contribution.dispose?.();}finally{styles.forEach(link=>link.remove());}}};
  }catch(error){styles.forEach(link=>link.remove());throw error;}
}

export class ApplicationBoundary extends React.Component<{children:React.ReactNode;name:string},{error?:string}>{
  state:{error?:string}={};
  static getDerivedStateFromError(error:Error){return {error:error.message};}
  render(){return this.state.error?<section role="alert"><h2>{this.props.name} could not display this screen</h2><p>{this.state.error}</p><p>Core tools remain available. Open Modules to disable the extension.</p></section>:this.props.children;}
}
