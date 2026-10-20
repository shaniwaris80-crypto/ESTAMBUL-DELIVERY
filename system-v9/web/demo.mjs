// Explicit, in-memory DEMONSTRATION. Never sends SMS, calls Last.app or writes remote data.
import {nextTransition,shiftPreview} from './domain.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function createDemo(role='admin',slot=1){
 const riders=Array.from({length:6},(_,i)=>({id:id(i+1),label:'Rider '+(i+1),slot:i+1,role:'rider',active:true,online:i<3,position:i<3?{lat:42.340+i*.002,lng:-3.7+i*.004}:null,last_gps_at:new Date().toISOString()}));
 const admin={id:id(100),role:'admin',label:'Demo Admin',online:false};
 const addresses=['Calle de prueba 12','Avenida de ejemplo 8','Plaza ficticia 3','Calle Demo 21'];
 const orders=addresses.map((address,i)=>({id:id(200+i),reference:'DEMO-'+(120+i),rider_id:riders[i%3].id,state:['pending','accepted','on_delivery','delivered'][i],version:1,generation:1,synthetic:true,source:{customer:{name:'Test Customer '+(i+1),phone:null},destination:{address,lat:42.34+i*.003,lng:-3.696+i*.002,details:'Synthetic data — not a real address'},courier:{external_id:'demo-courier-'+(i%3+1),name:riders[i%3].label},source:['LAST.APP','GLORIAFOOD','UBER EATS','JUST EAT'][i],products:[{id:'kebab',name:'Kebab menu',quantity:1},{id:'drink',name:'Soft drink',quantity:1}],recorded_payments:[],preferred_payment_method:'card'},created_at:new Date(Date.now()-(24-i*5)*60000).toISOString(),total_cents:[1850,2400,1575,2200][i],due_cents:[1850,2400,1575,2200][i],paid_cents:i===3?2200:null,payment_method:i===3?'cash':null,financial_review:false,share_location:i===1||i===2,checklist:[],notification:{status:i?'blocked':'not_requested',last_error:'demo_never_sends_sms'}}));
 const data={me:role==='admin'?admin:riders[Math.max(1,Math.min(6,slot))-1],riders,orders,closures:[],settings:{generation:1,restaurant_phone:null,tracking_origin:null,sms_enabled:false},environment:'demo',live_last_verified:false};
 const messages=new Map(),operations=new Map();let rating=null;
 const clone=x=>structuredClone(x);
 async function call(action,body={}){
  if(action==='state')return clone({...data,orders:data.me.role==='admin'?orders:orders.filter(o=>o.rider_id===data.me.id)});
  if(action==='chat')return clone(messages.get(body.order_id)||[]);
  if(action==='notification'||action==='sms')return {status:'blocked',sent:false,reason:'demo_never_sends_sms',tracking_url:null};
  if(action==='sync')return {demo:true,created:0,updated:0};
  if(action==='tracking'){
   const o=orders.find(o=>o.state==='on_delivery')||orders[0],r=riders.find(r=>r.id===o.rider_id);
   if(body.action==='chat'){const list=messages.get(o.id)||[];list.push({id:crypto.randomUUID(),sender:'customer',body:body.data.body,created_at:new Date().toISOString()});messages.set(o.id,list);}
   if(body.action==='feedback'&&o.state==='delivered')rating=body.data.rating;
   return clone({reference:o.reference,state:o.state,rider_name:r?.label,position:o.share_location?r?.position:null,gps_at:r?.last_gps_at,destination:o.source.destination,chat:messages.get(o.id)||[],rating,restaurant_phone:null,environment:'demo'});
  }
  if(action!=='command')throw Error('unknown_action');
  const {action:cmd,data:d,key}=body;const fingerprint=JSON.stringify([cmd,d]);
  if(operations.has(key)){const old=operations.get(key);if(old.fingerprint!==fingerprint)throw Error('idempotency_conflict');return clone(old.result);}
  const me=data.me;const o=orders.find(o=>o.id===d.order_id);
  if(o&&me.role!=='admin'&&o.rider_id!==me.id)throw Error('forbidden');
  if(o&&cmd!=='chat'&&d.version!==o.version)throw Error('version_conflict');
  if(cmd==='online'){me.online=!!d.online;}
  else if(cmd==='close_shift'){
   const p=shiftPreview(orders,me.id);if(!p.canClose)throw Error('unresolved_payments');if(d.declared_cents!==p.cash&&!d.notes?.trim())throw Error('explain_cash_difference');
   const close={id:crypto.randomUUID(),rider_id:me.id,cash_cents:p.cash,card_cents:p.card,online_cents:p.online,declared_cents:d.declared_cents,difference_cents:d.declared_cents-p.cash,order_count:p.count,closed_at:new Date().toISOString(),notes:d.notes};data.closures.unshift(close);orders.filter(o=>o.rider_id===me.id&&o.state==='delivered'&&!o.closure_id).forEach(o=>o.closure_id=close.id);me.online=false;
  }else if(cmd==='settings'){if(me.role!=='admin')throw Error('forbidden');Object.assign(data.settings,d,{sms_enabled:false});}
  else if(cmd==='reset_day'){if(me.role!=='admin'||d.confirmation!=='ARCHIVAR JORNADA')throw Error('forbidden');if(orders.some(o=>!['delivered','cancelled'].includes(o.state)||(o.state==='delivered'&&!o.closure_id)))throw Error('close_all_orders_first');orders.splice(0);data.settings.generation++;}
  else if(cmd==='map_courier'){if(me.role!=='admin')throw Error('forbidden');orders.filter(o=>o.source.courier.external_id===d.courier_id).forEach(o=>{o.rider_id=d.rider_id;o.version++;});}
  else if(!o)throw Error('order_not_accessible');
  else if(['accept','start','deliver'].includes(cmd)){if(me.role!=='rider'||!me.online)throw Error('rider_offline');o.state=nextTransition(o,cmd);o.share_location=o.state!=='delivered';o.version++;}
  else if(cmd==='payment'){if(o.payment_method)throw Error('payment_locked');if(!['cash','card'].includes(d.method)||d.amount_cents!==o.due_cents)throw Error('amount_not_confirmed');o.paid_cents=d.amount_cents;o.payment_method=d.method;o.version++;}
  else if(cmd==='due'){if(me.role!=='admin'||o.payment_method)throw Error('forbidden');o.due_cents=d.amount_cents;o.version++;}
  else if(cmd==='share'){o.share_location=!!d.enabled;o.version++;}
  else if(cmd==='checklist'){o.checklist=d.items;o.version++;}
  else if(cmd==='chat'){const list=messages.get(o.id)||[];list.push({id:key,sender:me.role,body:d.body,created_at:new Date().toISOString()});messages.set(o.id,list);}
  else throw Error('unknown_action');
  const result={ok:true,demo:true,sms:{sent:false,status:'blocked'}};operations.set(key,{fingerprint,result});return clone(result);
 }
 return {call,connected:true,demo:true};
}
