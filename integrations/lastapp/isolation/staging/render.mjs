import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const project='rknxqlijcgpbecoophva';
export function renderStageSchema(target) {
 if(target!==project)throw Error('Only the inspected staging project is permitted');
 const source=readFileSync(join(here,'../schema.sql'));
 const sha=createHash('sha1').update(Buffer.from(`blob ${source.length}\0`)).update(source).digest('hex');
 if(sha!=='82a2b6d7302199b0b96162a7a9dd666cc1037b43')throw Error('Bootstrap source changed: review before deploying');
 const text=source.toString('utf8');
 const start=text.indexOf('CREATE SCHEMA ed_last_stage;');
 if(start<0||!text.endsWith('COMMIT;\n'))throw Error('Unexpected bootstrap structure');
 // Explicit additive staging deployment. Legacy tables may coexist but are never referenced.
 const core=text.slice(start,-'COMMIT;\n'.length);
 return `-- Additive EDV9 staging schema. Target: ${project}. Never deploy to production.\nBEGIN;\n`+core+readFileSync(join(here,'probe.sql'),'utf8')+'COMMIT;\n';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [target,output]=process.argv.slice(2);
 if(!output)throw Error('Usage: node render.mjs STAGING_REF EMPTY_WORKDIR');
 const workdir=resolve(output);mkdirSync(workdir,{recursive:true});
 mkdirSync(join(workdir,'supabase/migrations'),{recursive:true});
 if(readdirSync(join(workdir,'supabase/migrations')).length)throw Error('Migration workspace must be empty');
 const cli=spawnSync('npx',['--yes','supabase@2.121.0','migration','new','edv9_last_http_staging'],{cwd:workdir,stdio:'inherit'});
 if(cli.status!==0)throw Error('Supabase CLI migration generation failed');
 const names=readdirSync(join(workdir,'supabase/migrations'));
 if(names.length!==1||!/^\d+_edv9_last_http_staging\.sql$/.test(names[0]))throw Error('Unexpected CLI migration result');
 const sql=renderStageSchema(target);const path=join(workdir,'supabase/migrations',names[0]);writeFileSync(path,sql);
 console.log('GENERATED_MIGRATION='+names[0]);console.log('MIGRATION_SHA256='+createHash('sha256').update(sql).digest('hex'));
 writeFileSync(join(workdir,'migration-path.txt'),path+'\n');
}
