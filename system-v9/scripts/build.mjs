import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.EDV9_OUTPUT||'dist-v9');
if(!output.endsWith('/dist-v9'))throw Error('Use a dedicated dist-v9 output directory');
await mkdir(output,{recursive:true});await cp('system-v9/web',output,{recursive:true});
await writeFile(output+'/build.json',JSON.stringify({application:'Estambul Delivery V9',environment:'staging',commit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||'local',operational_backend_connected:false,auth_verified:false,sms_verified:false,native_builds_available:false}));
console.log('Built web interfaces. This build does not deploy a backend or verify integrations.');
