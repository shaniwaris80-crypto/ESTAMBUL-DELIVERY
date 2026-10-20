import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const [target,out]=process.argv.slice(2);
if(target!=='rknxqlijcgpbecoophva'||!out)throw Error('Explicit staging ref and empty workdir required');
const dir=dirname(fileURLToPath(import.meta.url)),work=resolve(out),migrations=join(work,'supabase/migrations');
mkdirSync(migrations,{recursive:true});if(readdirSync(migrations).length)throw Error('Workspace not empty');
for(const [name,source,marker] of [['edv9_last_durable_queue','schema.sql','migration-path.txt'],['edv9_last_queue_cron','cron.sql','cron-migration-path.txt']]) {
 const result=spawnSync('npx',['--yes','supabase@2.121.0','migration','new',name],{cwd:work,stdio:'inherit'});
 if(result.status!==0)throw Error('CLI generation failed');
 const files=readdirSync(migrations).filter(f=>f.endsWith('_'+name+'.sql'));if(files.length!==1)throw Error('Expected one CLI migration');
 const sql=readFileSync(join(dir,source),'utf8');
 const path=join(migrations,files[0]);writeFileSync(path,sql);writeFileSync(join(work,marker),path+'\n');
 console.log('GENERATED_MIGRATION='+files[0]);console.log('MIGRATION_SHA256='+createHash('sha256').update(sql).digest('hex'));
}
