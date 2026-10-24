import {fail,required,uuid,position,readBody,safeTracking,constantTimeEqual,normalizeTab} from './core.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
export function createApi({db,env,saveSecrets,fetcher=fetch}){
 const query=async p=>{const {data,error}=await p;if(error)fail(409,error.message?.match(/not_assigned|invalid_transition|version_conflict|payment_required|pending_deliveries|empty_shift|rider_offline|not_authorized/)?.[0]||'database_error');return data;};
 const settings=()=>query(db.from('dm_settings').select('*').eq('singleton',true).single());
 async function sendSms(order,config){
  const sid=env('TWILIO_ACCOUNT_SID'),secret=env('TWILIO_AUTH_TOKEN'),from=env('TWILIO_SMS_FROM');
  if(!config.sms_enabled||!config.public_origin||!sid||!secret||!from)return 'unconfigured';
  if(!/^\+[1-9]\d{7,14}$/.test(order.phone)){await query(db.from('dm_sms').update({status:'blocked',error_code:'invalid_phone'}).eq('order_id',order.id).eq('status','pending'));return 'blocked';}
  // Claim is atomic. Ambiguous provider outcomes are NEVER resent automatically.
  const claim=await query(db.from('dm_sms').update({status:'sending',claimed_at:new Date().toISOString()}).eq('order_id',order.id).eq('status','pending').select());
  if(!claim.length)return 'already_claimed';
  let state='uncertain',provider=null,errorCode=null;
  try {
   const r=await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{method:'POST',headers:{'Authorization':'Basic '+btoa(sid+':'+secret),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:order.phone,From:from,Body:`Estambul Delivery: tu repartidor ha aceptado el pedido. Sigue la entrega: ${config.public_origin}/?track=${order.tracking_token}`}),signal:AbortSignal.timeout(12000)});
   const body=await r.json();
   if(r.ok&&body.sid){state='sent';provider=body.sid;}
   else if(r.status>=400&&r.status<500){state='failed';errorCode=String(body.code||r.status);}
   else errorCode='provider_ambiguous';
  }catch{errorCode='provider_ambiguous';}
  await query(db.from('dm_sms').update({status:state,provider_sid:provider,error_code:errorCode,sent_at:state==='sent'?new Date().toISOString():null}).eq('order_id',order.id));return state;
 }
 return async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  try{
   const url=new URL(req.url),action=url.searchParams.get('action')||'health';
   if(req.method==='GET'&&action==='health')return json(200,{service:'Estambul Delivery',environment:'staging',version:1});
   if(req.method!=='POST')return json(405,{error:'method_not_allowed'});
   const body=await readBody(req);
   if(action==='track'||action==='customer_message'){
    const token=uuid(body.token);
    const order=await query(db.from('dm_orders').select('*').eq('tracking_token',token).gt('tracking_expires',new Date().toISOString()).maybeSingle());
    if(!order)fail(404,'tracking_unavailable');
    const rider=order.rider_id?await query(db.from('dm_members').select('display_name').eq('id',order.rider_id).maybeSingle()):null;
    const point=order.rider_id?await query(db.from('dm_positions').select('*').eq('rider_id',order.rider_id).maybeSingle()):null;
    if(action==='customer_message'){
     if(!['accepted','en_route'].includes(order.status))fail(409,'chat_closed');
     const recent=await query(db.from('dm_messages').select('id').eq('order_id',order.id).eq('actor','customer').gte('created_at',new Date(Date.now()-60000).toISOString()));
     if(recent.length>=5)fail(429,'too_many_messages');
     await query(db.from('dm_messages').insert({order_id:order.id,actor:'customer',body:required(body.message,500)}));
    }
    const messages=await query(db.from('dm_messages').select('id,actor,body,created_at').eq('order_id',order.id).order('created_at',{ascending:false}).limit(50));
    const cfg=await settings();
    return json(200,{...safeTracking(order,rider,point),restaurant_phone:cfg.restaurant_phone,messages:messages.reverse(),destination:{latitude:order.latitude,longitude:order.longitude}});
   }
   const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
   if(!bearer)fail(401,'login_required');
   const {data:auth,error:authError}=await db.auth.getUser(bearer);
   if(authError||!auth.user)fail(401,'login_required');
   const member=await query(db.from('dm_members').select('*').eq('user_id',auth.user.id).eq('active',true).maybeSingle());
   if(!member)fail(403,'member_not_enabled');
   const admin=member.role==='admin';
   if(action==='state'){
    let oq=db.from('dm_orders').select('*').is('closure_id',null).order('created_at',{ascending:false}).limit(250);if(!admin)oq=oq.eq('rider_id',member.id);
    const orders=await query(oq);
    const riders=await query(admin?db.from('dm_members').select('id,display_name,role,online,courier_key,active').eq('role','rider'):db.from('dm_members').select('id,display_name,role,online').eq('id',member.id));
    const points=await query(admin?db.from('dm_positions').select('*'):db.from('dm_positions').select('*').eq('rider_id',member.id));
    const sms=orders.length?await query(db.from('dm_sms').select('order_id,status,error_code').in('order_id',orders.map(o=>o.id))):[];
    const closures=await query(admin?db.from('dm_closures').select('*').order('created_at',{ascending:false}).limit(30):db.from('dm_closures').select('*').eq('rider_id',member.id).order('created_at',{ascending:false}).limit(10));
    let integration=null;if(admin){const c=await settings();integration={last_location_id:c.last_location_id,last_amount_unit:c.last_amount_unit,last_key:!!env('LAST_APP_INTEGRATOR_TOKEN'),sms_key:!!(env('TWILIO_ACCOUNT_SID')&&env('TWILIO_AUTH_TOKEN')&&env('TWILIO_SMS_FROM')),sms_enabled:c.sms_enabled,public_origin:c.public_origin,restaurant_phone:c.restaurant_phone};}
    return json(200,{member,orders,riders,positions:points,sms,closures,integration});
   }
   if(action==='online'){
    if(typeof body.online!=='boolean')fail(400,'invalid_input');
    await query(db.rpc('dm_set_online',{p_user:auth.user.id,p_online:body.online}));return json(200,{ok:true});
   }
   if(action==='position'){
    if(member.role!=='rider'||!member.online)fail(409,'rider_offline');
    await query(db.from('dm_positions').upsert({rider_id:member.id,...position(body),updated_at:new Date().toISOString()}));return json(200,{ok:true});
   }
   if(['accept','start','deliver'].includes(action)){
    if(!Number.isInteger(body.version))fail(400,'invalid_version');
    const order=await query(db.rpc('dm_transition',{p_user:auth.user.id,p_order:uuid(body.order_id),p_action:action,p_version:body.version,p_payment:body.payment||null,p_amount:body.amount_cents??null}));
    const sms=action==='accept'?await sendSms(order,await settings()):null;return json(200,{order,sms});
   }
   if(action==='close_shift')return json(200,{closure:await query(db.rpc('dm_close_shift',{p_user:auth.user.id}))});
   if(action==='messages'||action==='message'){
    let oq=db.from('dm_orders').select('id,status').eq('id',uuid(body.order_id));if(!admin)oq=oq.eq('rider_id',member.id);
    const order=await query(oq.maybeSingle());if(!order)fail(404,'order_not_found');
    if(action==='message'){
     if(!['accepted','en_route'].includes(order.status))fail(409,'chat_closed');
     await query(db.from('dm_messages').insert({order_id:order.id,actor:member.role,body:required(body.message,500)}));
    }
    return json(200,{messages:await query(db.from('dm_messages').select('id,actor,body,created_at').eq('order_id',order.id).order('created_at').limit(50))});
   }
   if(action==='sync_tab'){
    if(!admin)fail(403,'not_authorized');const cfg=await settings(),token=env('LAST_APP_INTEGRATOR_TOKEN');
    if(!token||!cfg.last_location_id)fail(409,'last_not_configured');const tabId=uuid(body.tab_id);
    const r=await fetcher('https://api.last.app/v2/tabs/'+encodeURIComponent(tabId),{headers:{Authorization:'Bearer '+token,LocationID:cfg.last_location_id,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(!r.ok)fail(502,'last_request_failed');const raw=await r.json();if(raw.id!==tabId)fail(502,'invalid_last_order');
    const normalized=normalizeTab(raw,cfg.last_location_id);if(!normalized)fail(400,'not_delivery');
    const amount=cfg.last_amount_unit&&normalized.source_amount!==null?Math.round(normalized.source_amount*(cfg.last_amount_unit==='euros'?100:1)):null;
    await query(db.rpc('dm_ingest',{p_tab:normalized,p_amount:amount}));return json(200,{imported:true});
   }
   if(action==='send_pending'){
    let oq=db.from('dm_orders').select('*').in('status',['accepted','en_route']);if(!admin)oq=oq.eq('rider_id',member.id);
    const orders=await query(oq.limit(250));const ids=orders.map(o=>o.id);
    if(!ids.length)return json(200,{status:'empty'});
    const rows=await query(db.from('dm_sms').select('order_id').eq('status','pending').in('order_id',ids).limit(1));
    if(!rows.length)return json(200,{status:'empty'});
    const order=orders.find(o=>o.id===rows[0].order_id);return json(200,{status:await sendSms(order,await settings())});
   }
   if(action==='credentials'){
    if(!admin||!saveSecrets)fail(403,'not_authorized');
    const entries={};
    if(body.last_token)entries.LAST_APP_INTEGRATOR_TOKEN=required(body.last_token,2000).replace(/^Bearer\s+/i,'');
    if(body.twilio_sid||body.twilio_token||body.twilio_from){
     if(!/^AC[0-9a-f]{32}$/i.test(body.twilio_sid||''))fail(400,'invalid_twilio_sid');
     entries.TWILIO_ACCOUNT_SID=body.twilio_sid;entries.TWILIO_AUTH_TOKEN=required(body.twilio_token,200);
     if(!/^\+[1-9]\d{7,14}$/.test(body.twilio_from||''))fail(400,'invalid_phone');entries.TWILIO_SMS_FROM=body.twilio_from;
    }
    if(!Object.keys(entries).length)fail(400,'invalid_input');await saveSecrets(entries);return json(200,{saved:true});
   }
   if(action==='mapping'){
    if(!admin)fail(403,'not_authorized');
    await query(db.from('dm_members').update({courier_key:required(body.courier_key,128)}).eq('id',uuid(body.rider_id)).eq('role','rider'));return json(200,{ok:true});
   }
   if(action==='settings'){
    if(!admin)fail(403,'not_authorized');
    const location=uuid(body.last_location_id);if(!['cents','euros'].includes(body.last_amount_unit))fail(400,'amount_unit_required');
    const origin=new URL(required(body.public_origin));if(origin.protocol!=='https:')fail(400,'https_required');
    if(!/^\+[1-9]\d{7,14}$/.test(body.restaurant_phone||''))fail(400,'invalid_phone');
    await query(db.from('dm_settings').update({last_location_id:location,last_amount_unit:body.last_amount_unit,public_origin:origin.origin,restaurant_phone:body.restaurant_phone,sms_enabled:body.sms_enabled===true}).eq('singleton',true));return json(200,{ok:true});
   }
   fail(404,'unknown_action');
  }catch(e){return json(e.status||500,{error:e.status?e.message:'internal_error'});}
 };
}
