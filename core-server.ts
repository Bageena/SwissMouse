import path from 'node:path';
import { createCoreHost } from './tools/core-host';

void (async()=>{
  const host=await createCoreHost({appRoot:process.env.APP_ROOT||process.cwd(),staticDirectory:path.resolve(process.env.SWISSMOUSE_CORE_ASSETS||'dist/core')});
  const server=host.app.listen(Number(process.env.PORT||3001),'127.0.0.1',()=>console.log('SwissMouse Core listening on http://127.0.0.1:'+((server.address() as {port:number}).port)));
  const close=()=>server.close(()=>{void host.close().finally(()=>process.exit(0));});process.once('SIGINT',close);process.once('SIGTERM',close);
})().catch(error=>{console.error(error);process.exitCode=1;});
