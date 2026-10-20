import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePage,createTabListReader,recoverPage,createRecoveryRpc} from '../reconcile.mjs';
const L='11111111-1111-4111-8111-111111111111',T='22222222-2222-4222-8222-222222222222',K='33333333-3333-4333-8333-333333333333';
const claim={location_id:L,lease_token:K,start_date:'2026-10-18T10:00:00Z',end_date:'2026-10-20T10:00:00Z',offset:0,limit:100};
const row={id:T,locationId:L};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
test('empty page means no discoveries, not cancellations',()=>assert.deepEqual(validatePage([],L),{ids:[],row_count:0}));
test('page deduplicates identifiers but keeps vendor offset count',()=>assert.deepEqual(validatePage([row,row],L),{ids:[T],row_count:2}));
test('foreign location rejects the whole page',()=>assert.throws(()=>validatePage([row,{...row,locationId:K}],L),/invalid_tab/));
test('malformed identity rejects the whole page',()=>assert.throws(()=>validatePage([{id:'../secrets',locationId:L}],L),/invalid_tab/));
test('oversized page rejected',()=>assert.throws(()=>validatePage(Array(101).fill(row),L),/invalid_tab/));
test('non-array vendor response rejected',()=>assert.throws(()=>validatePage({data:[row]},L),/invalid_tab/));
test('list uses documented filters, offset and GET only',async()=>{
 const reader=createTabListReader({token:'fixture-secret',fetchImpl:async(url,init)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.last.app');assert.equal(u.pathname,'/v2/tabs');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  assert.equal(init.headers.LocationID,L);assert.equal(u.searchParams.get('locationId'),L);assert.equal(u.searchParams.get('limit'),'100');assert.equal(u.searchParams.get('offset'),'0');
  assert.equal(u.searchParams.get('startDate'),'2026-10-18T10:00:00.000Z');assert.equal(u.searchParams.has('open'),false);assert.ok(init.signal);return json([row]);
 }});assert.deepEqual(await reader.listPage(claim),[row]);
});
test('arbitrary base URLs cannot be supplied through a claim',async()=>{
 const reader=createTabListReader({token:'fixture-secret',fetchImpl:async(url)=>{assert.ok(url.startsWith('https://api.last.app/v2/tabs?'));return json([]);}});
 await reader.listPage({...claim,url:'https://evil.invalid/'});
});
test('out of bounds offset and date range rejected before HTTP',async()=>{
 let calls=0;const r=createTabListReader({token:'fixture-secret',fetchImpl:async()=>{calls++;return json([]);}});
 await assert.rejects(r.listPage({...claim,offset:1000}),/invalid_tab/);await assert.rejects(r.listPage({...claim,start_date:'2026-01-01'}),/invalid_tab/);assert.equal(calls,0);
});
test('429 preserves bounded Retry-After',async()=>{
 const r=createTabListReader({token:'fixture-secret',fetchImpl:async()=>json({secret:'never returned'},429,{'Retry-After':'120'})});
 await assert.rejects(r.listPage(claim),e=>e.code==='last_rate_limited'&&e.retryAfterSeconds===120&&!e.message.includes('never returned'));
});
test('unauthorized upstream is sanitized',async()=>{
 const r=createTabListReader({token:'fixture-secret',fetchImpl:async()=>json({message:'private provider detail'},401)});
 await assert.rejects(r.listPage(claim),e=>e.code==='last_unauthorized'&&!e.message.includes('private'));
});
test('malformed upstream JSON cannot enqueue orders',async()=>{
 const r=createTabListReader({token:'fixture-secret',fetchImpl:async()=>new Response('{broken',{headers:{'Content-Type':'application/json'}})});
 await assert.rejects(r.listPage(claim),/invalid_tab/);
});
test('missing sandbox opt-in performs no RPC and no API read',async()=>{
 let calls=0;const r=await recoverPage({rpc:async()=>calls++,list:{listPage:async()=>calls++},ready:false},L);assert.equal(r.state,'disabled');assert.equal(calls,0);
});
test('discovery forwards identifiers only, not list customer data',async()=>{
 const calls=[];const result=await recoverPage({ready:true,rpc:async(n,a)=>{calls.push([n,a]);return n.endsWith('_begin')?claim:{state:'completed',queued:1};},list:{listPage:async()=>[{...row,customerPhone:'synthetic-private'}]}},L);
 assert.equal(result.queued,1);assert.deepEqual(calls[1][1].p_ids,[T]);assert.ok(!JSON.stringify(calls).includes('synthetic-private'));
});
test('lost page lease is not a recovered order',async()=>{
 const r=await recoverPage({ready:true,rpc:async n=>n.endsWith('_begin')?claim:{state:'lost_lease',queued:0},list:{listPage:async()=>[row]}},L);assert.deepEqual(r,{state:'lost_lease',queued:0});
});
test('transient list error leaves durable retry with safe code',async()=>{
 const calls=[];const r=await recoverPage({ready:true,rpc:async(n,a)=>{calls.push([n,a]);return n.endsWith('_begin')?claim:true;},list:{listPage:async()=>{throw Object.assign(Error('do not leak'),{code:'last_rate_limited',retryAfterSeconds:90});}}},L);
 assert.equal(r.state,'error');assert.equal(calls[1][1].p_delay,90);assert.ok(!JSON.stringify(r).includes('do not leak'));
});
test('recovery RPC refuses other projects and unknown procedures',async()=>{
 assert.throws(()=>createRecoveryRpc({supabaseUrl:'https://wfrloqblbflltrjwdfmd.supabase.co',serviceKey:'fake'}),/staging_required/);
 const rpc=createRecoveryRpc({supabaseUrl:'https://rknxqlijcgpbecoophva.supabase.co',serviceKey:'fake'});await assert.rejects(rpc('delete_everything',{}),/invalid_rpc/);
});
