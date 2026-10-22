/* Estambul Delivery: Supabase Auth and PostgREST, staff/rider access via SQL RLS. */
(function(){"use strict";
const cfg=window.ESTAMBUL_SUPABASE||{},base=(cfg.url||"").replace(/\/+$/,""),key=cfg.anonKey||"";
const ready=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)&&key.length>20;
const el=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const labels={pendiente:"Pendiente",asignado:"Asignado",recogido:"Recogido",en_ruta:"En reparto",entregado:"Entregado",cancelado:"Cancelado"};
const next={asignado:"recogido",recogido:"en_ruta",en_ruta:"entregado"};
const chan={test:"Prueba",lastapp:"Last.app",uber:"Uber Eats",justeat:"Just Eat"};
let session=null,member=null,account=null,orders=[],riders=[],busy=false;
let operationsEpoch=null,operationsResetReady=false;
let shiftClosures=[],shiftClosureItems=[],locationShares=new Map(),archivedOrderIds=new Set(),showArchivedOrders=false;
let brandDetails=null,customerFeedback=[];
let riderPositions=[],lastReloadAt=0;
let opsQuery="",opsFocus="all",opsChannel="all";
const normalizeOps=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es-ES").trim();
function matchOperations(o){
 if(opsChannel!=="all"&&o.channel!==opsChannel)return false;
 if(opsQuery){
  const text=[o.reference,o.customer_name,o.customer_phone,o.destination,o.notes,o.channel,chan[o.channel]]
    .map(normalizeOps).join(" ");
  if(!text.includes(opsQuery))return false;
 }
 const isActive=!["entregado","cancelado"].includes(o.status);
 switch(opsFocus){
  case "active":return isActive;
  case "unassigned":return isActive&&!o.rider_id&&o.channel!=="test";
  case "route":return o.status==="en_ruta";
  case "delivered":return o.status==="entregado";
  case "payment_missing":return o.status==="entregado"&&!["efectivo","tarjeta"].includes(o.payment_method);
  case "sms_off":return Boolean(o.customer_phone)&&(!o.notifications_consent||o.notification_channel!=="sms");
  case "gps_shared":return locationShares.get(o.id)===true;
  default:return true;
 }
}
const storage="estambul-secure-test-session";
// Keep live operations above training tools. This only rearranges existing DOM
// cards; it never changes their IDs, security checks, handlers, or data sources.
const proStaffView=el("staffView"),proTrainingCard=el("inviteCard");
for(const id of ["ordersArea","riderDirectory","gpsAdminCard","shiftHistoryCard"]){
 const section=el(id);
 if(proStaffView&&proTrainingCard&&section)proStaffView.insertBefore(section,proTrainingCard);
}
function destinationCoords(prefix){
 const la=el(prefix+"Lat").value.trim().replace(",",".");
 const lo=el(prefix+"Lng").value.trim().replace(",",".");
 if(!la&&!lo)return {lat:null,lng:null};
 if(!la||!lo)throw Error("Escribe latitud y longitud del destino, o deja ambas vacías");
 const lat=Number(la),lng=Number(lo);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat >90||lng < -180||lng >180)
  throw Error("Coordenadas inválidas. Latitud: -90 a 90; longitud: -180 a 180");
 return {lat,lng};
}
document.addEventListener("click",event=>{
 const btn=event.target.closest("button[data-maps-address]");
 if(!btn)return;
 const target=el(btn.dataset.mapsAddress)?.value.trim();
 if(!target){message(Error("Introduce primero una dirección de entrega"));return;}
 window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(target),"_blank","noopener,noreferrer");
});
try{session=JSON.parse(sessionStorage.getItem(storage)||"null")}catch{}
function persist(){if(session)sessionStorage.setItem(storage,JSON.stringify(session));else sessionStorage.removeItem(storage)}
function message(e,login=false){const box=el(login?"loginError":"errorBox");box.textContent=e.message||String(e);box.hidden=false;}
function clearError(){el("loginError").hidden=true;el("errorBox").hidden=true;el("resendSignupEmail").hidden=true;el("resendSignupStatus").hidden=true}
async function parsed(r){
 const raw=await r.text();let o=null;try{o=JSON.parse(raw)}catch{o=raw}
 if(!r.ok){
   // GoTrue frequently returns {code,msg,error_code}, not {message}.
   // Do not collapse useful auth diagnostics into an opaque "HTTP 400".
   const code=String(o?.error_code||o?.code||"");
   const detail=String(o?.message||o?.error_description||o?.msg||o?.error||"").trim();
   const err=new Error(/email_not_confirmed|email not confirmed/i.test(code+" "+detail)
     ?"Correo sin confirmar. Revisa el correo de confirmación o solicita reenviarlo. Para entrar como administrador utiliza exclusivamente tu cuenta autorizada."
     :/invalid_credentials|invalid login credentials/i.test(code+" "+detail)
       ?"Correo o contraseña incorrectos. Comprueba el correo de administrador autorizado o utiliza Recuperar contraseña."
       :detail||"No se pudo completar la solicitud (HTTP "+r.status+").");
   err.code=code;throw err;
 }
 return o;
}
function headers(){return {"apikey":key,"Content-Type":"application/json"}}
async function newToken(){
 if(!session?.refresh_token)throw Error("Sesión caducada");
 const o=await parsed(await fetch(base+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:headers(),body:JSON.stringify({refresh_token:session.refresh_token})}));
 session={access_token:o.access_token,refresh_token:o.refresh_token,expires:Date.now()+o.expires_in*1000};persist();
}
async function query(path,options={}){
 if(!session?.access_token)throw Error("Inicia sesión");
 if(!session.expires||Date.now()>session.expires-60000)await newToken();
 const hdr={...headers(),Authorization:"Bearer "+session.access_token,...(options.headers||{})};
 let r=await fetch(base+path,{...options,headers:hdr});
 if(r.status===401){await newToken();hdr.Authorization="Bearer "+session.access_token;r=await fetch(base+path,{...options,headers:hdr});}
 return parsed(r);
}

let lastHealthCheckedAt=0;
async function updateLastHealth(){
 const chip=el("edLastHealth");
 if(!chip||!member||member.role==="rider"||Date.now()-lastHealthCheckedAt<30000)return;
 lastHealthCheckedAt=Date.now();
 chip.classList.remove("is-good","is-error");
 try{
  const h=await query("/rest/v1/rpc/ed_staff_last_health",{method:"POST",body:"{}"});
  const locations=Number(h?.approved_locations)||0;
  const received=Number(h?.new_events)||0;
  const processed=Number(h?.processed_events)||0;
  const failures=Number(h?.failed_events)||0;
  if(locations===0){chip.textContent="Last.app · ubicación sin autorizar";chip.classList.add("is-error");}
  else if(failures>0){chip.textContent="Last.app · "+failures+" eventos con error";chip.classList.add("is-error");}
  else if(received===0){chip.textContent="Last.app · autorizado · sin pedido nuevo verificado";}
  else if(processed===0){chip.textContent="Last.app · "+received+" eventos pendientes de completar";}
  else{chip.textContent="Last.app · "+processed+" eventos procesados";chip.classList.add("is-good");}
  chip.title="Eventos recibidos después de autorizar la ubicación: "+received+
   ". Procesados: "+processed+". Fallidos: "+failures+
   ". Los webhooks pueden estar disponibles aunque todavía no haya un pedido importado.";
 }catch(e){
  chip.textContent="Last.app · estado no disponible";
  chip.title="Comprueba el estado en Supabase; no se han alterado pedidos.";
  chip.classList.add("is-error");
 }
}

async function identity(){
 const user=await query("/auth/v1/user");
 const m=await query("/rest/v1/ed_members?select=account_id,role,active&user_id=eq."+encodeURIComponent(user.id)+"&active=eq.true");
 if(!m?.length){
  // An email-verified, pre-authorized owner may claim the initial admin account.
  // The RPC validates the email server-side and is safe to call for other users.
  await query("/rest/v1/rpc/ed_activate_admin",{method:"POST",body:"{}"});
  const claimed=await query("/rest/v1/ed_members?select=account_id,role,active&user_id=eq."+encodeURIComponent(user.id)+"&active=eq.true");
  if(!claimed?.length)throw Error("No hay organización asignada a este usuario.");
  m.push(...claimed);
 }
 member=m.find(x=>x.role==="admin"||x.role==="dispatcher")||m[0];
 const a=await query("/rest/v1/ed_accounts?select=id,name&id=eq."+encodeURIComponent(member.account_id));
 if(!a?.length)throw Error("Organización no encontrada");account=a[0];
}
function logged(){
 el("loginSection").hidden=true;el("appSection").hidden=false;el("logout").hidden=false;el("noConfig").hidden=true;
 const staff=member.role!=="rider";
 const staffView=el("staffView"),riderView=el("riderView");
 if(!staffView||!riderView)throw Error("No se pudieron cargar las vistas del panel. Actualiza la página para obtener la versión nueva.");
 staffView.hidden=!staff;riderView.hidden=staff;
 // Optional admin cards may be absent in a partially cached/migrated layout.
 // Never abort an authenticated admin session over an optional UI section.
 const inviteCard=el("inviteCard");
 if(inviteCard)inviteCard.hidden=member.role!=="admin";
 const operationsResetCard=el("operationsResetCard");
 if(operationsResetCard)operationsResetCard.hidden=member.role!=="admin";
 el("accountLabel").textContent=account.name+" · "+member.role.toUpperCase();
 el("viewTitle").textContent=staff?"Centro de reparto":"Mis entregas";
 el("viewSub").textContent="Sincronizado con Last.app y Supabase · actualización cada 5 segundos";
 el("connection").textContent="Conectado";
}
async function reload(){
 const q=encodeURIComponent(member.account_id);
 operationsResetReady=false;operationsEpoch=null;
 try{
  const epochs=await query("/rest/v1/ed_operations_epoch?select=started_at,previous_started_at,revision&account_id=eq."+q+"&limit=1");
  if(Array.isArray(epochs)){
   operationsResetReady=true;
   operationsEpoch=epochs[0]||null;
  }
 }catch{/* Migration not installed: keep the old order view and disable reset. */}
 const since=operationsEpoch?.started_at;
 const epochFilter=since?"&or=(created_at.gte."+encodeURIComponent(since)+",and(rider_id.not.is.null,status.in.(asignado,recogido,en_ruta)))":"";
 if(member.role==="admin"){
  el("resetOperationsButton").disabled=!operationsResetReady;
  el("restoreOperationsButton").disabled=!operationsResetReady||!operationsEpoch?.previous_started_at;
  el("resetOperationsStatus").textContent=!operationsResetReady
   ?"Reinicio desactivado: falta instalar y verificar la función segura en Supabase."
   :since?"Panel iniciado desde "+new Date(since).toLocaleString("es-ES")+". Historial completo conservado.":"Vista completa actual. No se ha reiniciado.";
 }
 const [rs,os]=await Promise.all([
  query("/rest/v1/ed_riders?select=id,user_id,display_name,online,active,phone,customer_call_enabled&account_id=eq."+q+"&order=display_name.asc"),
  query("/rest/v1/ed_orders?select=id,reference,channel,customer_name,customer_phone,destination,notes,lat,lng,amount,payment_method,notifications_consent,notification_channel,status,rider_id,created_at&account_id=eq."+q+epochFilter+"&order=created_at.desc&limit=100")
 ]);
 riders=rs||[];orders=os||[];
 if(member.role!=="rider"){
   try{riderPositions=await query("/rest/v1/ed_rider_positions?select=rider_id,latitude,longitude,accuracy_m,updated_at&account_id=eq."+q);}
   catch(error){riderPositions=[];message(error);}
 }

 if(member.role!=="rider"){
  try{
   const [brands,feedback]=await Promise.all([
    query("/rest/v1/ed_brand_settings?select=display_name,primary_color,logo_url,google_review_url&account_id=eq."+q),
    query("/rest/v1/ed_customer_feedback?select=id,order_id,rating,comment,followup_status,created_at&account_id=eq."+q+"&order=created_at.desc&limit=100")
   ]);
   brandDetails=(brands||[])[0]||null;customerFeedback=feedback||[];
  }catch(error){brandDetails=null;customerFeedback=[];message(error);}
 }
 if(member.role!=="rider"){
  try{
   shiftClosures=await query("/rest/v1/ed_shift_closures?select=id,account_id,rider_id,shift_day,completed_count,cash_expected,card_total,unknown_total,cash_declared,cash_difference,notes,closed_at,legacy_count,is_provisional&account_id=eq."+q+"&order=closed_at.desc&limit=30");
   const ids=(shiftClosures||[]).map(c=>c.id);
   shiftClosureItems=ids.length?await query("/rest/v1/ed_shift_closure_items?select=close_id,order_id,reference,customer_name,payment_method,amount,legacy_timestamp&close_id=in.("+ids.join(",")+")"):[];
  }catch(error){shiftClosures=[];shiftClosureItems=[];message(error);}
  try{
   const ids=await query("/rest/v1/rpc/ed_staff_archived_order_ids",{
    method:"POST",body:JSON.stringify({p_order_ids:orders.map(o=>o.id)})
   });
   archivedOrderIds=new Set(Array.isArray(ids)?ids:[]);
  }catch{archivedOrderIds=new Set(shiftClosureItems.map(li=>li.order_id).filter(Boolean));}
  try{
   const rows=await query("/rest/v1/ed_order_location_shares?select=order_id,enabled");
   locationShares=new Map((Array.isArray(rows)?rows:[]).map(x=>[x.order_id,Boolean(x.enabled)]));
  }catch{locationShares=new Map();}
 }
 lastReloadAt=Date.now();
 el("connection").textContent="Sincronizado";
 render();
 if(member.role!=="rider")void updateLastHealth();
}
function mapsLink(o){
 const target=(o.lat!=null&&o.lng!=null)?String(o.lat)+","+String(o.lng):String(o.destination||"").trim();
 if(!target)return null;
 const location=(o.lat!=null&&o.lng!=null)?target:(/burgos|españa|spain/i.test(target)?target:target+", Burgos, España");
 return "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(location)+"&travelmode=driving";
}

function formatArcheoEuro(n){return new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(n||0));}
function drawShiftHistory(){
 el("shiftHistoryCount").textContent=shiftClosures.length+" cierres";
 const target=el("shiftHistory");
 if(!shiftClosures.length){target.innerHTML='<p class="shift-empty">Aún no hay jornadas cerradas. Al terminar un Rider, su arqueo aparecerá aquí.</p>';return;}
 target.innerHTML=shiftClosures.map(s=>{
  const name=riders.find(r=>r.id===s.rider_id)?.display_name||"Repartidor";
  const list=shiftClosureItems.filter(li=>li.close_id===s.id);
  const amount=Number(s.cash_expected)+Number(s.card_total)+Number(s.unknown_total);
  const group=(method,title)=>{
   const current=list.filter(row=>row.payment_method===method);
   return '<h4>'+title+' · '+current.length+' pedidos</h4>'+
     (current.length?current.map(row=>
      '<div class="shift-admin-line"><span>#'+esc(row.reference)+' · '+esc(row.customer_name)+'</span><strong>'+formatArcheoEuro(row.amount)+'</strong></div>').join(""):'<p class="shift-empty">Sin pedidos.</p>');
  };
  return '<details class="shift-admin-report"><summary><strong>'+esc(name)+' · '+esc(s.shift_day)+(s.is_provisional?' · ⚠ PROVISIONAL':'')+'</strong><span>'+s.completed_count+' entregas · '+formatArcheoEuro(amount)+'</span></summary>'+
    '<div class="shift-admin-sums"><span>💶 Efectivo: <b>'+formatArcheoEuro(s.cash_expected)+'</b></span>'+
    '<span>💳 Tarjeta: <b>'+formatArcheoEuro(s.card_total)+'</b></span>'+
    '<span>⚠ Por clasificar: <b>'+formatArcheoEuro(s.unknown_total)+'</b></span>'+
    '<span>Total: <b>'+formatArcheoEuro(amount)+'</b></span>'+
    '<span>Contado: <b>'+formatArcheoEuro(s.cash_declared)+'</b></span>'+
    '<span>Diferencia: <b>'+formatArcheoEuro(s.cash_difference)+'</b></span></div>'+
    '<div class="shift-admin-lines">'+group("efectivo","Efectivo")+group("tarjeta","Tarjeta")+group(null,"Sin clasificar")+'</div>'+
    (s.notes?'<p class="shift-admin-notes">Observaciones: '+esc(s.notes)+'</p>':'')+
    (s.legacy_count?'<p class="shift-admin-notes">Incluye '+s.legacy_count+' entregas antiguas con fecha estimada.</p>':'')+
    '</details>';
 }).join("");
}


function renderBrand(){
 if(!brandDetails)return;
 if(document.activeElement?.closest?.("#brandForm"))return;
 el("brandName").value=brandDetails.display_name||account?.name||"ESTAMBUL DELIVERY";
 el("brandColor").value=brandDetails.primary_color||"#14263b";
 el("brandLogo").value=brandDetails.logo_url||"";
 el("brandReviewUrl").value=brandDetails.google_review_url||"";
}
function renderFeedback(){
 el("feedbackCount").textContent=customerFeedback.length+" valoraciones";
 if(!customerFeedback.length){
  el("feedbackList").innerHTML='<p class="small-note">Aún no hay valoraciones. Genera un enlace de seguimiento de un pedido de prueba y, al entregarlo, comprueba el formulario.</p>';
  return;
 }
 el("feedbackList").innerHTML=customerFeedback.map(f=>{
  const ref=orders.find(o=>o.id===f.order_id)?.reference||"Pedido";
  const isIssue=Number(f.rating)<=2;
  return '<article class="feedback-card '+(isIssue?"feedback-issue":"")+'">'+
   '<div class="feedback-meta"><strong>#'+esc(ref)+' · '+f.rating+' ★</strong><span>'+new Date(f.created_at).toLocaleDateString("es-ES")+'</span></div>'+
   '<p>'+esc(f.comment||"Sin comentario")+'</p>'+
   '<div class="feedback-controls"><span>'+(isIssue?"⚠ Prioridad: contactar en privado":"✓ Opinión recibida")+'</span>'+
   '<select data-feedback="'+esc(f.id)+'" aria-label="Seguimiento de la valoración">'+
   [['pending','Pendiente'],['contacted','Contactado'],['resolved','Resuelto']].map(([value,label])=>
    '<option value="'+value+'" '+(f.followup_status===value?"selected":"")+'>'+label+'</option>').join("")+
   '</select></div></article>';
 }).join("");
}

function renderGpsPositions(){
 const now=Date.now();
 // Staff and customer tracking both use a strict 45-second live position cutoff.
 const active=riderPositions.filter(p=>{
  const age=now-Date.parse(p.updated_at);
  return Number.isFinite(age)&&age>=0&&age<=45000;
 });
 window.ESTAMBUL_VISUAL_MAP?.update(active,riders);
 el("gpsAdminCount").textContent=active.length+" compartiendo";
 el("gpsRiderList").innerHTML=riders.map(r=>{
  const p=active.find(x=>x.rider_id===r.id);
  const pos=p?String(p.latitude)+","+String(p.longitude):null;
  const g=pos?"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(pos):null;
  return '<div class="gps-admin-row"><div><strong>'+esc(r.display_name)+'</strong>'+
   '<small>'+(p?"📍 GPS actualizado "+new Date(p.updated_at).toLocaleTimeString("es-ES")+
     " · precisión aproximada "+Number(p.accuracy_m||0)+" m":"Sin ubicación compartida reciente")+
    '</small></div>'+(g?'<a href="'+g+'" target="_blank" rel="noopener noreferrer">Ver ubicación en Maps ↗</a>':'<span>—</span>')+'</div>';
 }).join("")||'<p class="small-note">Todavía no hay repartidores vinculados.</p>';
}

function whatsappNumber(value){
 const original=String(value||"").trim(),digits=original.replace(/\D/g,"");
 if(original.startsWith("+")&&/^[1-9]\d{7,14}$/.test(digits))return digits;
 if(/^00[1-9]\d{7,14}$/.test(digits))return digits.slice(2);
 if(/^[6789]\d{8}$/.test(digits))return "34"+digits;
 return "";
}
function trackingUrl(token){
 const link=new URL("track.html",location.href);
 link.hash="token="+token;
 return link.href;
}
function trackingMessage(order,link){
 const brand=brandDetails?.display_name||account?.name||"ESTAMBUL DELIVERY";
 return "Hola, puedes seguir tu pedido #"+order.reference+
   " de "+brand+" desde este enlace privado:\n"+
   link+"\n\nPodrás consultar el seguimiento y escribir al repartidor. Gracias.";
}
async function createTrackingLink(order){
 const token=await query("/rest/v1/rpc/ed_issue_tracking_token",{
  method:"POST",body:JSON.stringify({p_order_id:order.id})});
 if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token))throw Error("No se pudo generar el enlace");
 return trackingUrl(token);
}
function reserveWhatsAppTab(){
 let tab=null;
 try{tab=window.open("about:blank","_blank");if(tab)tab.opener=null;}catch{}
 return tab;
}
function showTrackingWhatsApp(tab,order,link){
 const phone=whatsappNumber(order.customer_phone);
 if(!phone)throw Error("Indica el teléfono del cliente en el pedido");
 const url="https://api.whatsapp.com/send?phone="+encodeURIComponent(phone)+
   "&text="+encodeURIComponent(trackingMessage(order,link));
 if(tab&&!tab.closed){tab.location.replace(url);}
 else window.prompt("El navegador ha bloqueado WhatsApp. Copia el enlace para compartirlo:",link);
 el("brandSaved").textContent="✓ Seguimiento preparado para WhatsApp. Revisa y pulsa Enviar dentro de WhatsApp; NO se envía automáticamente.";
 el("brandSaved").hidden=false;
}
document.addEventListener("click",event=>{
 const button=event.target.closest("button[data-wa]");
 if(!button||busy)return;
 const order=orders.find(o=>o.id===button.dataset.wa);
 if(!order||!order.notifications_consent||order.notification_channel!=="whatsapp")return;
 const phone=whatsappNumber(order.customer_phone);
 if(!phone){message(new Error("Revisa el teléfono del cliente en Editar"));return;}
 if(!window.confirm("Preparar un nuevo enlace privado de seguimiento para este cliente. Los enlaces anteriores seguirán funcionando. WhatsApp se abrirá para que pulses Enviar. ¿Continuar?"))return;
 const tab=reserveWhatsAppTab();
 void operation(async()=>{
  try{
   const link=await createTrackingLink(order);
   showTrackingWhatsApp(tab,order,link);
  }catch(err){if(tab&&!tab.closed)tab.close();throw err;}
 });
});

document.addEventListener("click",event=>{
 const btn=event.target.closest("button[data-rider-phone]");
 if(!btn||!member||member.role==="rider"||busy)return;
 const r=riders.find(x=>x.id===btn.dataset.riderPhone);
 if(!r)return;
 const input=window.prompt("Número de TRABAJO del repartidor, con prefijo (ej. +34…). Deja vacío para desactivar llamadas:",r.phone||"");
 if(input===null)return;
 const phone=input.trim();
 if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone)){message(new Error("Utiliza un teléfono internacional con prefijo, por ejemplo +34…"));return;}
 const publish=phone&&window.confirm("¿El repartidor ha autorizado mostrar este número de trabajo al cliente SOLO mientras tenga su pedido asignado y activo?");
 void operation(async()=>{
  const patch={phone:phone||null,customer_call_enabled:Boolean(publish)};
  const path="/rest/v1/ed_riders?id=eq."+encodeURIComponent(r.id)+"&account_id=eq."+encodeURIComponent(member.account_id);
  const rows=await query(path,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(patch)});
  if(!Array.isArray(rows)||rows.length!==1)throw Error("No se pudo configurar el número de llamadas");
 });
});

function render(){
 const staff=member.role!=="rider",open=orders.filter(o=>!["entregado","cancelado"].includes(o.status));
 const archivedIds=archivedOrderIds;
 const allVisibleOrders=showArchivedOrders?orders:orders.filter(o=>!archivedIds.has(o.id));
 const visibleOrders=staff?allVisibleOrders.filter(matchOperations):allVisibleOrders;
 const stats=[["Pedidos visibles",staff?visibleOrders.length:orders.length],["Sin asignar",open.filter(o=>!o.rider_id).length],["En ruta",open.filter(o=>o.status==="en_ruta").length],[staff?"Riders":"Mis pendientes",staff?riders.filter(r=>r.active).length:open.length]];
 el("stats").innerHTML=stats.map(x=>'<div class="stat"><small>'+esc(x[0])+'</small><b>'+x[1]+'</b><small>En esta cuenta</small></div>').join("");
 el("lastSync").textContent=lastReloadAt?"Datos recibidos a las "+new Date(lastReloadAt).toLocaleTimeString("es-ES")+" · Acceso limitado por usuario (RLS)":"Esperando sincronización…";
 if(staff){
  // Read-only operational summary: NEVER assigns Last.app couriers.
  el("proAvailableRiders").textContent=String(riders.filter(r=>r.active&&r.online&&r.user_id).length);
  el("proWaitingOrders").textContent=String(open.filter(o=>o.channel!=="test"&&o.status!=="en_ruta").length);
  el("proSyncLabel").textContent=lastReloadAt?new Date(lastReloadAt).toLocaleTimeString("es-ES"):"Esperando…";
  const spotlight=open.filter(o=>o.channel!=="test").slice(0,5);
  el("opsSpotlightOrders").innerHTML=spotlight.length?spotlight.map(o=>{
   const riderLabel=riders.find(r=>r.id===o.rider_id)?.display_name||"Sin Rider · asignar desde LastPOS";
   const pay=Number(o.amount)>0?Number(o.amount).toLocaleString("es-ES",{style:"currency",currency:"EUR"}):"Importe pendiente";
   return '<article class="ed-spotlight-order"><div class="ed-spotlight-icon" aria-hidden="true">🥙</div>'+
    '<div class="ed-spotlight-info"><span class="ed-spotlight-code">#'+esc(o.reference)+
    ' <small>'+esc(chan[o.channel]||o.channel)+'</small></span><strong>'+esc(o.customer_name||"Cliente")+
    '</strong><p>'+esc(o.destination||"Dirección no indicada")+'</p>'+
    '<small class="ed-spotlight-rider">🛵 '+esc(riderLabel)+'</small></div>'+
    '<div class="ed-spotlight-end"><span class="pill state-'+esc(o.status)+'">'+esc(labels[o.status]||o.status)+
    '</span><strong>'+esc(pay)+'</strong><button type="button" data-spotlight="'+esc(o.id)+'" aria-label="Buscar este pedido en la tabla">Ver detalle ↗</button></div></article>';
  }).join(""):'<p class="ed-spotlight-empty">No hay pedidos reales activos. Las entregas anteriores siguen en su historial.</p>';
  const rosterSlots=Array.from({length:5},(_,i)=>{
   const n=i+1;
   const rider=riders.find(r=>new RegExp("^rider[\\s_-]*0?"+n+"$","i").test(String(r.display_name||"").trim()));
   return {n,rider,ready:Boolean(rider?.active&&rider?.user_id)};
  });
  el("riderCount").textContent=rosterSlots.filter(s=>s.ready).length+" de 5 listos";
  el("riderCapacity").innerHTML=rosterSlots.map(s=>
   '<div class="rider-slot '+(s.ready?'ready':'waiting')+'"><span class="rider-slot-number">'+String(s.n).padStart(2,"0")+'</span>'+
   '<strong>RIDER '+String(s.n).padStart(2,"0")+'</strong>'+
   '<small>'+(s.ready?(s.rider.online?'● Cuenta activa · Online':'● Cuenta activa · Offline'):
    s.rider?'Pendiente de activación':'Sin cuenta creada')+'</small></div>').join("");
  el("orderCount").textContent=visibleOrders.length+" de "+allVisibleOrders.length+" pedidos";
  el("opsResultCount").textContent=visibleOrders.length+" resultados de "+allVisibleOrders.length+
    (opsFocus!=="all"||opsQuery||opsChannel!=="all"?" · Filtros activos":"")+" · "+archivedIds.size+" en arqueos cerrados";
  const openOrders=allVisibleOrders.filter(o=>!["entregado","cancelado"].includes(o.status));
  el("opsUnassignedCount").textContent=openOrders.filter(o=>!o.rider_id&&o.channel!=="test").length;
  el("opsRouteCount").textContent=openOrders.filter(o=>o.status==="en_ruta").length;
  el("opsPaymentCount").textContent=allVisibleOrders.filter(o=>o.status==="entregado"&&!["efectivo","tarjeta"].includes(o.payment_method)).length;
  document.querySelectorAll("[data-ops-focus]").forEach(b=>{
    b.setAttribute("aria-pressed",String(b.dataset.opsFocus===opsFocus));
  });
  renderBrand();renderFeedback();renderGpsPositions();
  drawShiftHistory();
  el("riders").innerHTML=riders.map(r=>'<div class="rider-item"><span class="avatar">'+esc(r.display_name.slice(0,2).toUpperCase())+'</span><span class="rider-meta"><strong>'+esc(r.display_name)+'</strong><small>'+(r.active?(r.online?"● Online":"○ Desconectado"):"Inactivo")+' · '+open.filter(o=>o.rider_id===r.id).length+' pedidos</small><small>'+(r.customer_call_enabled&&r.phone?"☎ Clientes pueden llamar al número de trabajo":"Llamadas de clientes desactivadas")+'</small></span>'+
 '<button type="button" class="outline rider-call-config" data-rider-phone="'+esc(r.id)+'">Configurar llamadas</button></div>').join("")||"<p>Sin riders</p>";
  el("ordersTable").innerHTML=visibleOrders.map(o=>{
    const options='<option value="">Sin asignar</option>'+riders.filter(r=>r.active).map(r=>'<option value="'+esc(r.id)+'" '+(o.rider_id===r.id?"selected":"")+'>'+esc(r.display_name)+'</option>').join("");
    const gmaps=mapsLink(o);
    const foundCode=String(o.notes||"").match(/(?:^|\s|\|)Last\.app\s*#\s*([A-Za-z0-9_-]{1,32})/i);
    const visibleRef=foundCode?foundCode[1]:o.reference;
    return '<tr><td><strong>'+esc(visibleRef)+'</strong>'+(foundCode?'<small class="ops-full-ref">Last.app: '+esc(o.reference)+'</small>':'')+'<small>'+esc(Number(o.amount||0).toFixed(2))+' €</small></td>'+
      '<td><strong>'+esc(o.customer_name)+'</strong><small>'+esc(o.destination)+'</small>'+
      (o.customer_phone?'<small>☎ '+esc(o.customer_phone)+'</small>':'')+
      (o.customer_phone?'<small class="ops-sms '+(o.notifications_consent&&o.notification_channel==="sms"?"ready":"off")+'">'+
       (o.notifications_consent&&o.notification_channel==="sms"?"✉ SMS habilitado (entrega no confirmada)":"✉ SMS no habilitado")+'</small>':'')+
      (locationShares.get(o.id)?'<small class="ops-map-status">📍 Enlace GPS compartido (posición no verificada)</small>':'')+
      (o.notes?'<small>📝 '+esc(o.notes)+'</small>':'')+
      (gmaps?'<small><a href="'+gmaps+'" target="_blank" rel="noopener noreferrer">📍 Google Maps ↗</a></small>':'')+
      '</td><td>'+esc(chan[o.channel]||o.channel)+'</td><td><strong>'+esc(o.payment_method==='efectivo'?'💶 Efectivo':o.payment_method==='tarjeta'?'💳 Tarjeta':'Por indicar')+'</strong></td><td><span class="pill state-'+esc(o.status)+'">'+esc(labels[o.status])+
      '</span></td><td>'+(o.channel!=="test"
       ?'<strong class="last-manual">Gestionar en Last.app</strong><small>Asignación manual desde LastPOS</small>'
       :'<select data-assign="'+esc(o.id)+'" '+(["entregado","cancelado"].includes(o.status)?"disabled":"")+'>'+options+'</select>')+'</td><td><button class="outline" type="button" data-edit="'+esc(o.id)+'">Editar</button></td>'+
      '<td><div class="share-actions"><button class="outline" type="button" data-track="'+esc(o.id)+'">🔗 Enlace</button>'+
      '<button class="outline whatsapp-action" type="button" data-wa="'+esc(o.id)+'" '+((o.notifications_consent&&o.notification_channel==="whatsapp"&&whatsappNumber(o.customer_phone))?"":'disabled title="Indica teléfono y activa WhatsApp con consentimiento en Editar"')+'>💬 Enviar seguimiento</button>'+
      (locationShares.get(o.id)?'<button class="outline stop-public-gps" type="button" data-stop-public-gps="'+esc(o.id)+'">■ Ocultar GPS del cliente</button>':'')+
      '</div></td></tr>';
  }).join("")||'<tr class="ops-empty"><td colspan="8">No hay pedidos con esos filtros. Modifica la búsqueda o pulsa «Limpiar filtros».</td></tr>';
 }else{
  el("myOrders").innerHTML=orders.map(o=>{
    const n=next[o.status],map=mapsLink(o);
    return '<article class="my-order"><small>'+esc(chan[o.channel]||o.channel)+'</small><h3>'+esc(o.reference)+'</h3><p><strong>'+esc(o.customer_name)+'</strong></p><p>'+esc(o.destination)+'</p><p class="pill">'+esc(labels[o.status])+'</p><div class="actions">'+(map?'<a target="_blank" rel="noopener noreferrer" href="'+map+'">Google Maps ↗</a>':"")+(n?'<button class="btn" data-advance="'+esc(o.id)+'" data-next="'+n+'">'+esc({recogido:"Recogido",en_ruta:"Iniciar reparto",entregado:"Entregado"}[n])+'</button>':"")+'</div></article>';
  }).join("")||'<p>No hay pedidos asignados a este rider.</p>';
 }
}
async function operation(fn){
 if(busy)return;busy=true;clearError();
 try{await fn();await reload()}catch(e){message(e);el("connection").textContent="Revisar actualización"}
 finally{busy=false}
}
async function start(){
 if(!ready){el("noConfig").hidden=false;el("connection").textContent="Sin configurar";return}
 if(await window.ESTAMBUL_ADMIN_RECOVERY?.initialise?.())return;
 if(!session){el("loginSection").hidden=false;el("connection").textContent="Acceso requerido";return}
 try{await identity();logged();await reload()}catch(e){session=null;persist();member=null;el("loginSection").hidden=false;message(e,true)}
}
el("signUpButton").addEventListener("click",async()=>{
 if(busy)return;
 const email=el("email").value.trim(),password=el("password").value;
 if(!email||!password){message(Error("Introduce tu correo y una contraseña nueva para registrarte."),true);return;}
 if(password.length<8){message(Error("Utiliza una contraseña de al menos 8 caracteres."),true);return;}
 busy=true;clearError();el("signUpButton").disabled=true;el("signInButton").disabled=true;
 try{
  // Email confirmation is required by default on hosted Supabase.
  const redirect=encodeURIComponent("https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/live.html");
  const res=await parsed(await fetch(base+"/auth/v1/signup?redirect_to="+redirect,{
   method:"POST",headers:headers(),body:JSON.stringify({email,password})
  }));
  el("signUpInfo").textContent="Registro solicitado. Revisa tu correo y confirma la cuenta. Si la confirmación abre otra página, vuelve aquí y pulsa Entrar.";
  el("signUpInfo").hidden=false;
  el("password").value="";
 }catch(e){message(e,true);}
 finally{busy=false;el("signUpButton").disabled=false;el("signInButton").disabled=false;}
});
el("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();if(busy)return;busy=true;clearError();el("signInButton").disabled=true;
 try{
  const auth=await parsed(await fetch(base+"/auth/v1/token?grant_type=password",{method:"POST",headers:headers(),body:JSON.stringify({email:el("email").value.trim(),password:el("password").value})}));
  session={access_token:auth.access_token,refresh_token:auth.refresh_token,expires:Date.now()+auth.expires_in*1000};persist();
  await identity();logged();await reload();el("password").value="";
 }catch(err){
   session=null;persist();member=null;el("loginSection").hidden=false;
   if(err?.code==="email_not_confirmed"||/email not confirmed|correo sin confirmar/i.test(err?.message||""))
      el("resendSignupEmail").hidden=false;
   message(err,true);
 }
 finally{busy=false;el("signInButton").disabled=false}
});

el("resendSignupEmail").addEventListener("click",async()=>{
 const input=el("email"),email=input.value.trim().toLowerCase();
 if(!email||!input.checkValidity()){input.reportValidity();return;}
 const button=el("resendSignupEmail");
 button.disabled=true;el("resendSignupStatus").hidden=false;
 el("resendSignupStatus").textContent="Solicitando confirmación…";
 try{
   const redirect=encodeURIComponent(window.location.origin+window.location.pathname);
   await parsed(await fetch(base+"/auth/v1/resend?redirect_to="+redirect,{
     method:"POST",headers:headers(),cache:"no-store",
     body:JSON.stringify({type:"signup",email})
   }));
   el("resendSignupStatus").textContent="Si el registro está pendiente de confirmar, recibirás un nuevo correo. Abre el enlace y vuelve a iniciar sesión.";
 }catch(error){
   el("resendSignupStatus").textContent=(error?.message||"No se pudo reenviar la confirmación.")+
     " Comprueba la bandeja de correo y los límites del proveedor.";
 }finally{button.disabled=false}
});
el("logout").addEventListener("click",()=>{session=null;persist();member=null;account=null;orders=[];riders=[];el("appSection").hidden=true;el("logout").hidden=true;el("loginSection").hidden=false;el("connection").textContent="Desconectado"});
el("sendInvitations").addEventListener("click",async()=>{
 if(busy||member?.role!=="admin")return;
 const rows=[1,2,3,4,5].map(n=>({number:n,email:el("riderInviteEmail"+n).value.trim().toLowerCase()}))
   .filter(row=>row.email);
 if(!rows.length){
  el("inviteResult").textContent="Introduce al menos un correo verificado para autorizar su Rider.";
  el("inviteResult").hidden=false;return;
 }
 if(rows.some(row=>!el("riderInviteEmail"+row.number).checkValidity())){
  el("inviteResult").textContent="Revisa el formato de los correos antes de guardarlos.";
  el("inviteResult").hidden=false;return;
 }
 if(!window.confirm("¿Autorizar estos "+rows.length+" correos de trabajadores para los Riders indicados? Los Riders deberán confirmar su propia cuenta."))return;
 busy=true;clearError();el("sendInvitations").disabled=true;
 const messages=[];let saved=0;
 try{
  for(const row of rows){
   try{
    const result=await query("/rest/v1/rpc/ed_admin_authorize_rider_email",{
      method:"POST",body:JSON.stringify({p_rider_number:row.number,p_email:row.email})
    });
    if(result?.saved===true){saved++;messages.push("Rider "+String(row.number).padStart(2,"0")+": correo autorizado");}
    else messages.push("Rider "+String(row.number).padStart(2,"0")+": autorización no confirmada");
   }catch(e){messages.push("Rider "+String(row.number).padStart(2,"0")+": "+String(e?.message||"No se pudo autorizar").slice(0,170));}
  }
  messages.push(saved+" de "+rows.length+" correos guardados. Cada Rider debe crear su cuenta y confirmar su correo desde la App Rider.");
  el("inviteResult").textContent=messages.join("\n");
  el("inviteResult").hidden=false;
 }finally{busy=false;el("sendInvitations").disabled=false;}
});

el("brandForm").addEventListener("submit",e=>{
 e.preventDefault();
 if(member?.role==="rider")return;
 void operation(async()=>{
  const name=el("brandName").value.trim(),color=el("brandColor").value;
  const logo=el("brandLogo").value.trim()||null;
  const google=el("brandReviewUrl").value.trim()||null;
  if(!name||name.length>80||!/^[#][a-fA-F0-9]{6}$/.test(color))throw Error("Marca no válida");
  if(logo&&!/^https:\/\//.test(logo))throw Error("Usa una URL HTTPS para el logotipo");
  if(google&&!/^https:\/\/(www\.)?(google\.(com|es|co\.uk)|g\.page|maps\.app\.goo\.gl)\//i.test(google))
   throw Error("El enlace de reseñas debe pertenecer a Google");
  const body={account_id:member.account_id,display_name:name,primary_color:color,logo_url:logo,google_review_url:google};
  await query("/rest/v1/ed_brand_settings?on_conflict=account_id",{
   method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(body)});
  el("brandSaved").hidden=false;el("brandSaved").textContent="✓ Marca guardada para el seguimiento de pedidos.";
 });
});
el("opsSpotlightOrders").addEventListener("click",event=>{
 const btn=event.target.closest("button[data-spotlight]");
 if(!btn||!member||member.role==="rider")return;
 const selected=orders.find(o=>o.id===btn.dataset.spotlight);
 if(!selected)return;
 opsQuery=normalizeOps(selected.reference);opsFocus="all";opsChannel="all";
 el("opsSearch").value=selected.reference;el("opsFocus").value="all";el("opsChannel").value="all";
 render();el("ordersArea").scrollIntoView({behavior:"smooth",block:"start"});
});
el("opsSearch").addEventListener("input",event=>{opsQuery=normalizeOps(event.target.value);if(member)render();});
el("opsFocus").addEventListener("change",event=>{opsFocus=event.target.value;if(member)render();});
el("opsChannel").addEventListener("change",event=>{opsChannel=event.target.value;if(member)render();});
el("opsOverview").addEventListener("click",event=>{
 const button=event.target.closest("button[data-ops-focus]");
 if(!button||!member)return;
 opsFocus=opsFocus===button.dataset.opsFocus?"all":button.dataset.opsFocus;
 el("opsFocus").value=opsFocus;
 render();
});
el("opsReset").addEventListener("click",()=>{
 opsQuery="";opsFocus="all";opsChannel="all";
 el("opsSearch").value="";el("opsFocus").value="all";el("opsChannel").value="all";
 if(member)render();
});
el("showArchivedOrders").addEventListener("change",event=>{
 showArchivedOrders=Boolean(event.target.checked);
 if(member)render();
});
document.addEventListener("click",event=>{
 const b=event.target.closest("button[data-stop-public-gps]");
 if(!b||!member||member.role==="rider")return;
 void operation(async()=>{
  await query("/rest/v1/rpc/ed_set_customer_location_share",{
    method:"POST",body:JSON.stringify({p_order_id:b.dataset.stopPublicGps,p_enabled:false})
  });
 });
});
document.addEventListener("click",event=>{
 const b=event.target.closest("button[data-track]");
 if(!b||!member||member.role==="rider")return;
 const id=b.dataset.track;
 if(!orders.some(o=>o.id===id))return;
 if(!window.confirm("Crear un enlace privado de seguimiento para este pedido. Los enlaces anteriores seguirán funcionando. ¿Continuar?"))return;
 void operation(async()=>{
  const token=await query("/rest/v1/rpc/ed_issue_tracking_token",{method:"POST",body:JSON.stringify({p_order_id:id})});
  if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token))throw Error("Enlace no generado");
  const link=new URL("track.html",location.href);link.hash="token="+token;
  if(navigator.clipboard?.writeText){
   try{await navigator.clipboard.writeText(link.href);
    el("brandSaved").textContent="✓ Enlace copiado. Puedes enviarlo manualmente por WhatsApp o SMS al cliente de prueba.";
    el("brandSaved").hidden=false;
   }catch{window.prompt("Copia este enlace privado:",link.href);}
  }else window.prompt("Copia este enlace privado:",link.href);
 });
});
document.addEventListener("change",event=>{
 const select=event.target.closest("select[data-feedback]");
 if(!select||!member||member.role==="rider")return;
 const id=select.dataset.feedback,status=select.value;
 if(!["pending","contacted","resolved"].includes(status))return;
 void operation(async()=>{
  await query("/rest/v1/ed_customer_feedback?id=eq."+encodeURIComponent(id)+"&account_id=eq."+encodeURIComponent(member.account_id),{
   method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({followup_status:status})});
 });
});

el("cancelEdit").addEventListener("click",()=>{el("editCard").hidden=true;});
document.addEventListener("click",e=>{
 const btn=e.target.closest("[data-edit]");
 if(!btn)return;
 const o=orders.find(x=>x.id===btn.dataset.edit);
 if(!o)return;
 el("editOrderId").value=o.id;
 el("editOrderLabel").textContent=o.reference;
 el("editCustomer").value=o.customer_name||"";
 el("editPhone").value=o.customer_phone||"";
 el("editAmount").value=String(o.amount||0);
 el("editPayment").value=o.payment_method||"";
 el("editNoticeChannel").value=o.notification_channel||"none";
 el("editNoticeConsent").checked=!!o.notifications_consent;
 el("editAddress").value=o.destination||"";
 el("editNotes").value=o.notes||"";
 el("editLat").value=o.lat==null?"":String(o.lat);
 el("editLng").value=o.lng==null?"":String(o.lng);
 el("editCard").hidden=false;
 el("editCard").scrollIntoView({behavior:"smooth",block:"start"});
});
el("editForm").addEventListener("submit",e=>{
 e.preventDefault();
 const id=el("editOrderId").value;
 if(!orders.some(o=>o.id===id))return;
 void operation(async()=>{
  const amount=Number(el("editAmount").value||0);
  if(!Number.isFinite(amount)||amount<0||amount>999999)throw Error("Importe inválido");
  if(el("editNoticeChannel").value!=="none"&&(!el("editNoticeConsent").checked||!el("editPhone").value.trim()))
    throw Error("Para activar avisos necesitas teléfono y permiso del cliente");
  const old=orders.find(o=>o.id===id);
  const coordinates=destinationCoords("edit");
  if(old&&old.destination!==el("editAddress").value.trim()
    && coordinates.lat===old.lat&&coordinates.lng===old.lng){
     coordinates.lat=null;coordinates.lng=null;
  }
  const item={...coordinates,customer_name:el("editCustomer").value.trim(),
   customer_phone:el("editPhone").value.trim()||null,
   destination:el("editAddress").value.trim(),notes:el("editNotes").value.trim(),payment_method:el("editPayment").value||null,amount,
   notifications_consent:el("editNoticeConsent").checked,
   notification_channel:el("editNoticeChannel").value};
  const path="/rest/v1/ed_orders?id=eq."+encodeURIComponent(id)+"&account_id=eq."+encodeURIComponent(member.account_id);
  const rows=await query(path,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(item)});
  if(!rows?.length)throw Error("No se pudo actualizar el pedido");
  el("editCard").hidden=true;
 });
});
el("resetOperationsButton").addEventListener("click",()=>{
 if(busy||member?.role!=="admin"||!operationsResetReady)return;
 const active=orders.filter(o=>o.rider_id&&["asignado","recogido","en_ruta"].includes(o.status));
 if(active.length){message(Error("Hay "+active.length+" entregas asignadas en curso. Finalízalas antes del reinicio."));return;}
 if(!window.confirm("Se ocultarán los pedidos anteriores en Rider y gerencia. NO se eliminarán de Supabase ni del historial. ¿Continuar?"))return;
 if(window.prompt("Para confirmar el reinicio de la vista de operaciones escribe REINICIAR:")!=="REINICIAR")return;
 void operation(async()=>{
  const result=await query("/rest/v1/rpc/ed_reset_operations_view",{
   method:"POST",body:JSON.stringify({p_account_id:member.account_id,p_confirmation:"REINICIAR"})
  });
  el("resetOperationsStatus").textContent=result?.message||"Vista reiniciada. Los pedidos históricos siguen guardados.";
 });
});
el("restoreOperationsButton").addEventListener("click",()=>{
 if(busy||member?.role!=="admin"||!operationsResetReady||!operationsEpoch?.previous_started_at)return;
 if(window.prompt("Para recuperar los pedidos anteriores en las pantallas escribe RESTAURAR:")!=="RESTAURAR")return;
 void operation(async()=>{
  const result=await query("/rest/v1/rpc/ed_restore_operations_view",{
   method:"POST",body:JSON.stringify({p_account_id:member.account_id,p_confirmation:"RESTAURAR"})
  });
  el("resetOperationsStatus").textContent=result?.message||"Vista anterior restaurada.";
 });
});
el("refresh").addEventListener("click",()=>void operation(async()=>{}));
el("createForm").addEventListener("submit",e=>{
 e.preventDefault();void operation(async()=>{
  const phone=el("newPhone").value.trim();
  const amount=Number(el("newAmount").value||"0");
  if(!Number.isFinite(amount)||amount<0||amount>999999)throw Error("Importe no válido");
  if(el("newNoticeChannel").value!=="none"&&(!el("newNoticeConsent").checked||!phone))throw Error("Necesitas teléfono y autorización para avisos de servicio");
  const coordinates=destinationCoords("new");
  const item={...coordinates,account_id:member.account_id,reference:el("newReference").value.trim(),channel:"test",
    customer_name:el("newCustomer").value.trim(),customer_phone:phone||null,
    destination:el("newAddress").value.trim(),notes:el("newNotes").value.trim(),
    amount,payment_method:el("newPayment").value,status:"pendiente",
    notifications_consent:el("newNoticeConsent").checked,
    notification_channel:el("newNoticeChannel").value};
  await query("/rest/v1/ed_orders",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify(item)});
  el("createForm").reset();
 });
});
document.addEventListener("change",e=>{
 const sel=e.target;if(!sel.dataset.assign)return;
 const o=orders.find(x=>x.id===sel.dataset.assign);if(!o||busy||o.channel!=="test")return;
 const rid=sel.value||null;
 void operation(async()=>{
  const params="?id=eq."+encodeURIComponent(o.id)+"&account_id=eq."+encodeURIComponent(member.account_id);
  const rows=await query("/rest/v1/ed_orders"+params,{
   method:"PATCH",headers:{"Prefer":"return=representation"},
   body:JSON.stringify({rider_id:rid,status:rid?"asignado":"pendiente"})});
  if(!Array.isArray(rows)||rows.length!==1)throw Error("No se pudo asignar el pedido");
 });
});
document.addEventListener("click",e=>{
 const b=e.target.closest("[data-advance]");if(!b)return;
 const o=orders.find(x=>x.id===b.dataset.advance);
 if(!o||next[o.status]!==b.dataset.next)return;
 void operation(async()=>{
  const params="?id=eq."+encodeURIComponent(o.id)+"&rider_id=eq."+encodeURIComponent(o.rider_id)+"&status=eq."+encodeURIComponent(o.status);
  const result=await query("/rest/v1/ed_orders"+params,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:b.dataset.next})});
  if(!result?.length)throw Error("Este pedido cambió de asignación. Actualiza.");
 });
});
setInterval(()=>{if(member&&!busy)void operation(async()=>{});},5000);
start();
})();