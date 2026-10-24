export class Problem extends Error { constructor(status, code) {super(code);this.status=status;} }
export const fail=(status,code)=>{throw new Problem(status,code)};
export const required=(value,max=200)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():fail(400,'invalid_input');
export const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'')?value:fail(400,'invalid_id');
export function position(input){
 const {latitude,longitude,accuracy}=input;
 if(![latitude,longitude,accuracy].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0||accuracy>200) fail(400,'invalid_position');
 return {latitude,longitude,accuracy};
}
export function transition(order,member,action){
 if(member.role!=='rider'||order.rider_id!==member.id)fail(403,'not_assigned');
 if(!member.online)fail(409,'rider_offline');
 if(action==='accept'&&order.status==='assigned')return 'accepted';
 if(action==='start'&&order.status==='accepted')return 'en_route';
 if(action==='deliver'&&order.status==='en_route')return 'delivered';
 fail(409,'invalid_transition');
}
export function normalizeTab(tab,locationId){
 uuid(tab.id);uuid(locationId);
 if(!tab.delivery)return null;
 const delivery=tab.delivery;
 const text=v=>typeof v==='string'?v.trim():'';
 const courier=delivery.courier||{};
 const customer=tab.customerInfo||{};
 const statuses=Array.isArray(delivery.statuses)?delivery.statuses:[];
 const cancelled=tab.cancelled===true||statuses.some(s=>s.status==='CANCELLED');
 const items=(tab.orders||[]).flatMap(o=>o.products||[]).map(p=>({name:text(p.name),quantity:Number(p.quantity)||1,notes:text(p.comments),modifiers:(p.modifiers||[]).map(m=>text(m.name))}));
 // API monetary contract must be configured explicitly; no heuristic conversion.
 const amount=typeof tab.total==='number'&&Number.isFinite(tab.total)?tab.total:null;
 return {last_tab_id:tab.id,last_location_id:locationId,code:text(tab.code)||text(tab.reference)||tab.id.slice(0,8),customer_name:[customer.name,customer.surname].filter(Boolean).join(' ')||'Cliente',phone:text(customer.phoneNumber),address:text(delivery.address),notes:text(delivery.details),latitude:typeof delivery.latitude==='number'?delivery.latitude:null,longitude:typeof delivery.longitude==='number'?delivery.longitude:null,courier_key:text(courier.id)||text(courier.name),items,source:text(tab.source)||'Last.app',source_amount:amount,cancelled};
}
export function safeTracking(order,member,point,now=Date.now()){
 const fresh=point&&now-Date.parse(point.updated_at)>=0&&now-Date.parse(point.updated_at)<90_000;
 return {code:order.code,status:order.status,rider_name:member?.display_name||null,position:order.status==='en_route'&&fresh?{latitude:point.latitude,longitude:point.longitude,updated_at:point.updated_at}:null,delivered_at:order.delivered_at||null};
}
export function constantTimeEqual(a,b){const e=new TextEncoder(),x=e.encode(a),y=e.encode(b);let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x[i]||0)^(y[i]||0);return d===0;}
export async function readBody(req,max=160000){
 const reader=req.body?.getReader();if(!reader)fail(400,'invalid_json');let size=0;const parts=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'body_too_large');}parts.push(value);}
 const raw=new Uint8Array(size);let i=0;for(const p of parts){raw.set(p,i);i+=p.length;}
 try {const data=JSON.parse(new TextDecoder().decode(raw));if(!data||Array.isArray(data)||typeof data!=='object')fail(400,'invalid_json');return data;}catch{fail(400,'invalid_json');}
}
