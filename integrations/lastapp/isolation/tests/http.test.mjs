import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorized,cleanToken,readJson,retryAfter,createLastReader,createRpcStore,createGateway,failure} from '../http.mjs';
const loc='11111111-1111-4111-8111-111111111111', tab='22222222-2222-4222-8222-222222222222', org='33333333-3333-4333-8333-333333333333';
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const payload={id:'test-event',type:'tab:created',created:'2026-10-20T10:00:00Z',data:{id:tab,locationId:loc}};
const request=(action='webhook',body=payload,auth='Bearer synthetic-webhook',headers={})=>new Request('https://example.invalid/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth,LocationID:loc,OrganizationID:org,...headers},body:JSON.stringify(body)});
function gateway(overrides={}) {
 const calls=[];
 const store={receive:async e=>{calls.push(['receive',e]);return 'received';},claim:async l=>{calls.push(['claim',l]);return null;}};
 return {calls,handle:createGateway({store,last:{},enabled:true,webhookToken:'synthetic-webhook',workerToken:'synthetic-worker',...overrides})};
}
test('Bearer auth required; raw compatibility must be explicit',async()=>{
 assert.equal(await authorized('Bearer test','test'),true);
 assert.equal(await authorized('test','test'),false);
 assert.equal(await authorized('test','test',true),true);
 assert.equal(await authorized('Bearer wrong','test'),false);
 assert.equal(await authorized('Bearer test',''),false);
 assert.equal(await authorized('Bearer test\nx','test'),false);
 assert.equal(cleanToken(' "Bearer test" '),'test');
});
test('request byte limit includes chunked UTF-8 data',async()=>{
 await assert.rejects(readJson(response('é'.repeat(40)),60),{code:'body_too_large'});
 await assert.rejects(readJson(new Response('x',{headers:{'Content-Type':'text/plain'}}),60),{code:'unsupported_media_type'});
 await assert.rejects(readJson(new Response('{',{headers:{'Content-Type':'application/json'}}),60),{code:'invalid_json'});
});
test('Retry-After seconds, dates and bounds',()=>{
 assert.equal(retryAfter('60'),60); assert.equal(retryAfter('999999'),86400); assert.equal(retryAfter('nonsense'),0);
 assert.equal(retryAfter('Tue, 20 Oct 2026 10:01:00 GMT',Date.parse('2026-10-20T10:00:00Z')),60);
});
test('Last HTTP reader uses exact origin, GET and required scoped headers',async()=>{
 const reader=createLastReader({token:'Bearer fake',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.last.app/v2/tabs/'+tab); assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer fake');assert.equal(options.headers.LocationID,loc);assert.ok(options.signal);
  return response({id:tab,locationId:loc});
 }});
 assert.equal((await reader.getTab(tab,loc)).id,tab);
 await assert.rejects(reader.getTab('../secrets',loc),{code:'invalid_tab'});
});
for (const [status,code] of [[401,'last_unauthorized'],[403,'last_unauthorized'],[404,'last_not_found'],[429,'last_rate_limited'],[500,'last_unavailable'],[400,'invalid_tab']]) {
 test('Last HTTP '+status+' is sanitized as '+code,async()=>{
  const reader=createLastReader({token:'fake',fetchImpl:async()=>response({secret:'DO_NOT_LEAK'},status,{'Retry-After':'42'})});
  await assert.rejects(reader.getTab(tab,loc),e=>e.code===code&&!e.message.includes('DO_NOT_LEAK')&&e.retryAfterSeconds===42);
 });
}
test('Last network failure does not expose error details',async()=>{
 await assert.rejects(createLastReader({token:'fake',fetchImpl:async()=>{throw Error('DO_NOT_LEAK');}}).getTab(tab,loc),{code:'last_unavailable'});
});
test('Last abort is a timeout',async()=>{
 await assert.rejects(createLastReader({token:'fake',fetchImpl:async()=>{throw new DOMException('DO_NOT_LEAK','AbortError');}}).getTab(tab,loc),{code:'last_timeout'});
});
test('Last malformed or excessive responses cannot become orders',async()=>{
 for(const fake of [()=>new Response('html'),()=>response('x'.repeat(1000001))]) {
  await assert.rejects(createLastReader({token:'fake',fetchImpl:async()=>fake()}).getTab(tab,loc),{code:'invalid_tab'});
 }
});
test('RPC uses privileged scoped server headers and fixed procedure allowlist',async()=>{
 const store=createRpcStore({supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'synthetic.jwt.key',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/edv9_last_claim');
  assert.equal(options.headers.apikey,'synthetic.jwt.key');assert.equal(options.headers.Authorization,'Bearer synthetic.jwt.key');
  assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{p_location_id:loc});return response(null);
 }});
 assert.equal(await store.claim(loc),null);await assert.rejects(store.rpc('../accounts',{}),{code:'invalid_rpc'});
});
test('modern RPC secret key is not sent as a user JWT',async()=>{
 const store=createRpcStore({supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'sb_secret_synthetic',fetchImpl:async(u,o)=>{assert.equal(o.headers.Authorization,undefined);return response(null);}});
 assert.equal(await store.claim(loc),null);
});
test('RPC errors are categorized without reflecting provider text',async()=>{
 for(const [message,expected] of [['location_not_approved','location_not_approved'],['DO_NOT_LEAK','storage_unavailable']]) {
  const store=createRpcStore({supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'fake',fetchImpl:async()=>response({message},400)});
  await assert.rejects(store.claim(loc),{code:expected});
 }
});
test('RPC backend cannot be redirected to an arbitrary origin',()=>{
 for(const url of ['http://example.com','https://evil.invalid','https://abcdefghijklmnopqrst.supabase.co@evil.invalid']) assert.throws(()=>createRpcStore({supabaseUrl:url,serviceKey:'fake'}),{code:'invalid_supabase_url'});
});
test('incorrect auth makes no database or Last calls',async()=>{
 const {handle,calls}=gateway();assert.equal((await handle(request('webhook',payload,'Bearer wrong'))).status,401);assert.equal(calls.length,0);
});
test('disabled gateway rejects all operational requests',async()=>{
 const {handle,calls}=gateway({enabled:false});assert.equal((await handle(request())).status,503);assert.equal(calls.length,0);
});
test('authenticated valid webhook returns exactly empty HTTP 200',async()=>{
 const {handle,calls}=gateway();const r=await handle(request());assert.equal(r.status,200);assert.equal(await r.text(),'');assert.equal(calls[0][1].location_id,loc);
});
test('malformed or wrong-scope webhook makes no database calls',async()=>{
 const {handle,calls}=gateway();assert.equal((await handle(request('webhook',{...payload,data:{id:tab,locationId:org}}))).status,400);assert.equal(calls.length,0);
});
test('unapproved location and duplicate ID collision fail explicitly',async()=>{
 for(const [code,status] of [['location_not_approved',403],['event_id_conflict',409],['storage_unavailable',503]]) {
  const {handle}=gateway({store:{receive:async()=>{throw failure(code);}}});assert.equal((await handle(request())).status,status);
 }
});
test('unsupported event acknowledged without pretending to import',async()=>{
 const {handle,calls}=gateway();const r=await handle(request('webhook',{...payload,type:'payment:created'}));assert.equal(r.status,200);assert.equal(r.headers.get('X-EDV9-Disposition'),'unsupported');assert.equal(calls.length,0);
});
test('duplicate webhook does not start a second wake-up',async()=>{
 let wakes=0; const {handle}=gateway({store:{receive:async()=> 'duplicate'},schedule:()=>wakes++});assert.equal((await handle(request())).status,200);assert.equal(wakes,0);
});
test('worker endpoint requires its own secret and never returns customer details',async()=>{
 const {handle}=gateway();assert.equal((await handle(request('run',{location_id:loc}))).status,401);
 const r=await handle(request('run',{location_id:loc},'Bearer synthetic-worker'));assert.deepEqual(await r.json(),{state:'idle'});
});
test('invalid HTTP methods and missing routes are rejected',async()=>{
 const {handle}=gateway();assert.equal((await handle(new Request('https://example.invalid/webhook'))).status,405);
 assert.equal((await handle(new Request('https://example.invalid/missing'))).status,404);
});
