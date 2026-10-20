/** Single-use staging verification: real RPC store, synthetic Last Fetch transport. */
import {createGateway,createLastReader,sha256} from '../http.mjs';
export async function runProbe(request,store) {
 const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if (!token) return new Response(null,{status:401});
 const hash=await sha256(token);
 const scope=await store.rpc('edv9_last_probe_begin',{p_token_hash:hash});
 if (!scope) return new Response(null,{status:401});
 const checks={};
 try {
  const now=new Date().toISOString();
  const fixture={id:scope.tab_id,locationId:scope.location_id,pickupType:'ownDelivery',source:'EDV9_SYNTHETIC_TEST',code:'TEST',customerInfo:{name:'Synthetic test'},
   delivery:{address:'Synthetic address - NOT A DELIVERY',latitude:42.34,longitude:-3.70,courier:{id:'synthetic-courier',name:'Test rider'},statuses:[{status:'KITCHEN',creationTime:now}]},
   bills:[{id:'synthetic-bill',total:1200,preferredPaymentMethod:'cash',payments:[]}],products:[]};
  let fetches=0;
  const last=createLastReader({token:'synthetic-last-token',fetchImpl:async(url,init)=>{
   fetches++;checks.last_headers=url==='https://api.last.app/v2/tabs/'+scope.tab_id&&init.headers.LocationID===scope.location_id&&init.headers.Authorization==='Bearer synthetic-last-token'&&init.redirect==='error';
   return new Response(JSON.stringify(fixture),{headers:{'Content-Type':'application/json'}});
  }});
  const handler=createGateway({store,last,webhookToken:'synthetic-webhook-token',workerToken:'synthetic-worker-token',enabled:true});
  const event={id:'synthetic-'+scope.tab_id,type:'tab:created',created:now,data:{id:scope.tab_id,locationId:scope.location_id}};
  const req=(action,body,credential)=>new Request('https://synthetic.invalid/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential,LocationID:scope.location_id,OrganizationID:scope.organization_id},body:JSON.stringify(body)});
  checks.unauthorized=(await handler(req('webhook',event,'wrong'))).status===401;
  const first=await handler(req('webhook',event,'synthetic-webhook-token'));
  checks.empty_200=first.status===200&&(await first.text())==='';
  checks.duplicate_200=(await handler(req('webhook',event,'synthetic-webhook-token'))).status===200;
  checks.worker_unauthorized=(await handler(req('run',{location_id:scope.location_id},'wrong'))).status===401;
  const run=await handler(req('run',{location_id:scope.location_id},'synthetic-worker-token'));
  const data=await run.json();checks.processed=run.status===200&&data.state==='processed';
  checks.no_customer_in_response=!('normalized' in data)&&!JSON.stringify(data).includes('Synthetic test');
  checks.one_full_read=fetches===1;
 } catch { checks.execution_failed=false; }
 const report=await store.rpc('edv9_last_probe_finish',{p_token_hash:hash,p_checks:checks});
 return new Response(JSON.stringify(report),{status:report.passed?200:500,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
