import test from 'node:test';
import assert from 'node:assert/strict';
import {drainBatch,createDrainHandler,createQueueRpc} from '../drain.mjs';
const loc='11111111-1111-4111-8111-111111111111',tab='22222222-2222-4222-8222-222222222222',lease='33333333-3333-4333-8333-333333333333';
function setup(count=3,{kind='synthetic',failFirst=false}={}) {
 let remaining=count,clock=0,claims=0,finished=0,failed=0,providerCalls=0;
 const sample={id:tab,locationId:loc,pickupType:'ownDelivery',delivery:{address:'Synthetic'},products:[]};
 const store={complete:async()=>{finished++;return 'processed';},fail:async()=>{failed++;return 'retry';}};
 const rpc=async(name)=>{
  if(name==='edv9_last_queue_claim'){claims++;return remaining-->0?{event_id:'test',tab_id:tab,location_id:loc,lease_token:lease}:null;}
  if(name==='edv9_last_queue_fixture')return{tab:sample,fail_first:failFirst,attempt:1};
  throw Error('Unexpected RPC');
 };
 const deps={routes:[{location_id:loc,source_kind:kind}],rpc,store,last:{getTab:async()=>{providerCalls++;return sample;}},now:()=>clock,sleep:async ms=>{clock+=ms;}};
 return {deps,stats:()=>({remaining,claims,finished,failed,providerCalls,clock})};
}
test('drains multiple queued events without a new webhook',async()=>{const x=setup();const r=await drainBatch(x.deps);assert.equal(r.processed,3);assert.equal(r.synthetic_reads,3);assert.equal(r.sandbox_reads,0);assert.equal(x.stats().providerCalls,0);assert.ok(x.stats().clock>=1200);});
test('caps work and leaves remainder for the next durable invocation',async()=>{const x=setup(30);const r=await drainBatch(x.deps);assert.equal(r.attempted,20);assert.equal(x.stats().remaining,10);});
test('transient failure stops this location rather than busy retrying',async()=>{const x=setup(3,{failFirst:true});const r=await drainBatch(x.deps);assert.equal(r.retry,1);assert.equal(r.attempted,1);assert.equal(x.stats().remaining,2);});
test('unconfigured sandbox does not claim jobs or burn attempts',async()=>{const x=setup(2,{kind:'sandbox'});const r=await drainBatch(x.deps);assert.equal(r.attempted,0);assert.equal(x.stats().claims,0);});
test('configured sandbox uses the Last reader, never fixtures',async()=>{const x=setup(2,{kind:'sandbox'});const r=await drainBatch({...x.deps,sandboxEnabled:true,sandboxTokenPresent:true});assert.equal(r.processed,2);assert.equal(r.sandbox_reads,2);assert.equal(r.synthetic_reads,0);});
test('lost lease cannot be counted as a completed order',async()=>{const x=setup();x.deps.store.complete=async()=> 'lost_lease';const r=await drainBatch(x.deps);assert.equal(r.lost_lease,1);assert.equal(r.processed,0);});
test('storage failures are sanitized and leave other work durable',async()=>{const x=setup();x.deps.rpc=async()=>{throw Error('sensitive provider detail');};const r=await drainBatch(x.deps);assert.equal(r.storage_errors,1);assert.ok(!JSON.stringify(r).includes('sensitive'));});
test('elapsed-time budget prevents starting another long operation',async()=>{const x=setup();let clock=0;x.deps.now=()=>clock;x.deps.store.complete=async()=>{clock=16000;return 'processed';};const r=await drainBatch(x.deps);assert.equal(r.processed,1);});
test('reports never return normalized customer or payment data',async()=>{const x=setup();const r=await drainBatch(x.deps);assert.ok(!JSON.stringify(r).includes('Synthetic'));assert.ok(!JSON.stringify(r).includes(tab));});
test('invalid modes cannot trigger an alternative reader',async()=>{const x=setup();await assert.rejects(()=>drainBatch({...x.deps,routes:[{location_id:loc,source_kind:'production'}]}));});
test('missing or malformed auth rejected before any database request',async()=>{let calls=0;const h=createDrainHandler({rpc:async()=>{calls++;}});for(const value of ['', 'Bearer guess']){const r=await h(new Request('https://example.test/drain',{method:'POST',headers:{Authorization:value}}));assert.equal(r.status,401);}assert.equal(calls,0);});
test('unknown or already consumed ticket is rejected',async()=>{const h=createDrainHandler({rpc:async()=>null});const r=await h(new Request('https://example.test/drain',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64)}}));assert.equal(r.status,401);});
test('one-use ticket is hashed and run report persisted',async()=>{let consumed=false;let saved;const x=setup(1);const original=x.deps.rpc;x.deps.rpc=async(name,args)=>{if(name==='edv9_last_queue_begin'){assert.notEqual(args.p_hash,'a'.repeat(64));if(consumed)return null;consumed=true;return{run_id:lease,routes:x.deps.routes,queue_enabled:true};}if(name==='edv9_last_queue_finish'){saved=args.p_report;return true;}return original(name,args);};const h=createDrainHandler(x.deps);const req=()=>new Request('https://example.test/drain',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64)}});assert.equal((await h(req())).status,200);assert.equal(saved.processed,1);assert.equal((await h(req())).status,401);});
test('unfinished reporting is not presented as successful invocation',async()=>{const h=createDrainHandler({rpc:async name=>name==='edv9_last_queue_begin'?{run_id:lease,routes:[]}:false});assert.equal((await h(new Request('https://example.test/drain',{method:'POST',headers:{Authorization:'Bearer '+'b'.repeat(64)}}))).status,503);});
test('queue RPC pins origin and procedure allowlist',async()=>{assert.throws(()=>createQueueRpc({supabaseUrl:'https://example.test',serviceKey:'test'}));let calls=0;const rpc=createQueueRpc({supabaseUrl:'https://rknxqlijcgpbecoophva.supabase.co',serviceKey:'synthetic',fetchImpl:async()=>{calls++;return new Response('null',{headers:{'content-type':'application/json'}});}});await assert.rejects(()=>rpc('delete_everything',{}));assert.equal(calls,0);});
