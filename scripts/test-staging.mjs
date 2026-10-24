// Integration test against the isolated staging environment. Credentials stay outside the repository.
import fs from 'node:fs';import assert from 'node:assert/strict';
const credentials=JSON.parse(fs.readFileSync(process.env.ED_TEST_CREDENTIALS||'/workspace/scratch/233ade063641/qa-access.json'));
const config={url:'https://rknxqlijcgpbecoophva.supabase.co',key:'sb_publishable_WGb4eO7lzvq8UjcQDuypQQ_yZQVU-jK'};
const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options={})=>nativeFetch(url,{...options,signal:AbortSignal.timeout(20000)});
const sessions=[];
for(const a of credentials.accounts){const r=await fetch(config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({email:a.email,password:a.password})});assert.equal(r.status,200,'account login: '+a.name);sessions.push(await r.json());console.log('login_ok',a.name);}
async function api(n,action,body={}){const r=await fetch(config.url+'/functions/v1/dm-api?action='+action,{method:'POST',headers:{'Content-Type':'application/json',...(n===null?{}:{Authorization:'Bearer '+sessions[n].access_token})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
assert.equal((await api(null,'state')).status,401);
assert.equal((await api(1,'mapping',{rider_id:crypto.randomUUID(),courier_key:'attack'})).status,403);
const admin=(await api(0,'state')).data;assert.equal(admin.riders.length,5);assert.equal(admin.member.role,'admin');
for(let i=1;i<=5;i++){const s=await api(i,'state');assert.equal(s.status,200);assert.equal(s.data.riders.length,1);assert.equal(s.data.member.role,'rider');assert.equal(s.data.integration,null);}
const direct=await fetch(config.url+'/rest/v1/dm_orders?select=*',{headers:{apikey:config.key,Authorization:'Bearer '+sessions[1].access_token}});assert.ok([401,403].includes(direct.status));
assert.equal((await api(null,'track',{token:crypto.randomUUID()})).status,404);
const blocked=await fetch(config.url+'/functions/v1/dm-last',{method:'POST',headers:{Authorization:'Bearer invalid','Content-Type':'application/json'},body:'{}'});assert.ok([401,503].includes(blocked.status));
// Fixture is inserted explicitly through the SQL test setup, never through a public bypass endpoint.
const order=admin.orders.find(o=>o.code==='QA-FLOW');
if(order){
 assert.equal((await api(1,'online',{online:true})).status,200);
 assert.equal((await api(2,'accept',{order_id:order.id,version:order.version})).status,409);
 let accepted=await api(1,'accept',{order_id:order.id,version:order.version});assert.equal(accepted.status,200);assert.equal(accepted.data.order.status,'accepted');
 assert.equal((await api(1,'accept',{order_id:order.id,version:order.version})).status,409);
 assert.equal((await api(1,'close_shift')).status,409);
 let tracked=await api(null,'track',{token:order.tracking_token});assert.equal(tracked.data.position,null);assert.equal(tracked.data.phone,undefined);
 assert.equal((await api(1,'position',{latitude:42.345,longitude:-3.68,accuracy:10})).status,200);
 let started=await api(1,'start',{order_id:order.id,version:accepted.data.order.version});assert.equal(started.status,200);
 tracked=await api(null,'track',{token:order.tracking_token});assert.ok(tracked.data.position);assert.equal(tracked.data.position.latitude,42.345);
 assert.equal((await api(2,'messages',{order_id:order.id})).status,404);
 assert.equal((await api(null,'customer_message',{token:order.tracking_token,message:'Mensaje de prueba'})).status,200);
 assert.equal((await api(1,'deliver',{order_id:order.id,version:started.data.order.version})).status,409);
 let delivered=await api(1,'deliver',{order_id:order.id,version:started.data.order.version,payment:'cash',amount_cents:2450});assert.equal(delivered.status,200);
 tracked=await api(null,'track',{token:order.tracking_token});assert.equal(tracked.data.position,null);assert.equal(tracked.data.status,'delivered');
 assert.equal((await api(null,'customer_message',{token:order.tracking_token,message:'No debe enviarse'})).status,409);
 const closure=await api(1,'close_shift');assert.equal(closure.status,200);assert.equal(closure.data.closure.cash_cents,2450);
 assert.equal((await api(1,'close_shift')).status,409);
 assert.equal((await api(1,'state')).data.member.online,false);
}
console.log(JSON.stringify({logins:6,roleIsolation:'passed',privateTables:'passed',tracking:'passed',fullFlow:!!order,realSMS:'not_sent',realLastOrder:'not_received'}));
