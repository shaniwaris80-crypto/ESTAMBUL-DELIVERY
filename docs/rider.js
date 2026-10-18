/* ESTAMBUL DELIVERY Rider · PWA conectada a Supabase y sincronizada con Last.app.
 * La asignación de pedidos reales se realiza exclusivamente desde LastPOS.
 * No almacena datos de pedidos en el navegador entre sesiones. */
(function () {
"use strict";

const cfg = window.ESTAMBUL_SUPABASE || {};
const base = String(cfg.url || "").replace(/\/+$/, "");
const publicKey = String(cfg.anonKey || "");
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) && publicKey.length >= 20;
const $ = id => document.getElementById(id);
const escapeText = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const euros = value => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const statusNames = { pendiente: "Pendiente", asignado: "Asignado", recogido: "Recogido", en_ruta: "En ruta", entregado: "Entregado", cancelado: "Cancelado" };
const channelNames = { test: "Prueba", lastapp: "Last.app", uber: "Uber Eats", justeat: "Just Eat" };
const allowedNext = { asignado: "recogido", recogido: "en_ruta", en_ruta: "entregado" };
const nextNames = { recogido: "Confirmar recogida", en_ruta: "Iniciar reparto", entregado: "Confirmar entrega" };
function displayOrderCode(order){
 const found=String(order?.notes||"").match(/(?:^|\s|\|)Last\.app\s*#\s*([A-Za-z0-9_-]{1,32})/i);
 return found?found[1]:String(order?.reference||"");
}
const storageKey = "estambul-rider-pwa-session";
let session = null, identity = null, rider = null, accountName = "";
let orders = [], busy = false, inFlight = false, showHistory = false, lastSync = 0;
const paymentDrafts=new Map(); // Rider's transient payment selection, never persisted.
const smsOutcomes=new Map(); // Ephemeral per-order provider result; never store customer SMS data.
let paymentInteractionUntil=0;
function capturePaymentDrafts(){
 document.querySelectorAll('#orders select[data-payment-for]').forEach(select=>{
  const id=select.dataset.paymentFor;
  if(!id)return;
  if(["efectivo","tarjeta"].includes(select.value))paymentDrafts.set(id,select.value);
  else paymentDrafts.delete(id);
 });
}
const itemFeature=window.ESTAMBUL_RIDER_ITEMS_ENABLED===true&&Boolean(window.ESTAMBUL_ORDER_ITEMS);
const itemController=window.ESTAMBUL_ORDER_ITEMS?.createController(escapeText,itemFeature);
// Only unclosed deliveries belong to the current rider workday; the server keeps all settled orders.
let unsettledIds=null, locationShares=new Map(), locationSharingAvailable=false;
let deferredInstall = null;
let mustChangePassword=false;
let selectedRiderSlot=null;
const riderProfiles=window.ESTAMBUL_RIDER_PROFILES;
function setRiderSlot(slot){
 if(!riderProfiles||!Number.isInteger(slot)||slot<1||slot>5)return;
 selectedRiderSlot=slot;
 const remembered=riderProfiles.readEmail(slot);
 $("email").value=remembered;
 $("riderEmailGroup").hidden=Boolean(remembered);
 $("email").required=!remembered;
 $("password").disabled=false;
 $("forgetRiderDevice").hidden=!remembered;
 $("riderProfileHint").textContent=remembered
  ?"RIDER "+String(slot).padStart(2,"0")+" · Introduce tu contraseña para acceder."
  :"RIDER "+String(slot).padStart(2,"0")+" · Primer acceso: introduce el correo autorizado y tu contraseña.";
 document.querySelectorAll("[data-rider-slot]").forEach(button=>{
  const chosen=Number(button.dataset.riderSlot)===slot;
  button.setAttribute("aria-pressed",String(chosen));
  button.classList.toggle("selected",chosen);
 });
 (remembered?$("password"):$("email")).focus();
}
function updateRiderProfileTiles(){
 if(!riderProfiles)return;
 document.querySelectorAll("[data-rider-slot]").forEach(button=>{
  const slot=Number(button.dataset.riderSlot);
  const small=button.querySelector("small");
  if(small)small.textContent=riderProfiles.readEmail(slot)?"Acceso recordado":"Primer acceso";
 });
}
if(riderProfiles){
 $("riderProfiles").addEventListener("click",event=>{
  const button=event.target.closest("[data-rider-slot]");
  if(button&&!busy){setRiderSlot(Number(button.dataset.riderSlot));clearError();}
 });
 $("forgetRiderDevice").addEventListener("click",()=>{
  if(selectedRiderSlot){riderProfiles.forgetEmail(selectedRiderSlot);updateRiderProfileTiles();setRiderSlot(selectedRiderSlot);}
 });
 updateRiderProfileTiles();
}
const followupPhone=(raw)=>{
 const s=String(raw||"").trim(),d=s.replace(/\D/g,"");
 if(s.startsWith("+")&&/^[1-9]\d{7,14}$/.test(d))return d;
 if(/^00[1-9]\d{7,14}$/.test(d))return d.slice(2);
 if(/^[6789]\d{8}$/.test(d))return "34"+d;
 return "";
};
const canShareFollowup=(order)=>Boolean(order.notifications_consent&&order.notification_channel==="whatsapp"&&followupPhone(order.customer_phone));
function getTrackLink(token){
 const url=new URL("track.html",window.location.href);
 url.hash="token="+token;
 return url.href;
}
function shareTrackingByWhatsApp(order,link,tab){
 const phone=followupPhone(order.customer_phone);
 const msg="Hola, sigue tu pedido #"+displayOrderCode(order)+
   " de ESTAMBUL DELIVERY desde este enlace privado:\n"+
   link+"\nPuedes consultar su progreso, hablar o llamar al repartidor mientras esté disponible.";
 const wa="https://api.whatsapp.com/send?phone="+encodeURIComponent(phone)+
    "&text="+encodeURIComponent(msg);
 if(tab&&!tab.closed){tab.location.replace(wa);}
 else if(navigator.clipboard?.writeText){
  void navigator.clipboard.writeText(link).catch(()=>{window.prompt("Copia el enlace de seguimiento:",link);});
 }else window.prompt("Copia el enlace de seguimiento:",link);
 $("riderShareNotice").hidden=false;
 $("riderShareNotice").textContent=tab?
  "✓ Seguimiento preparado en WhatsApp para #"+displayOrderCode(order)+". Revisa el mensaje y pulsa ENVIAR en WhatsApp."
  :"✓ Pedido aceptado. WhatsApp fue bloqueado: copia y comparte el enlace privado.";
}
async function riderAcceptance(order,resend,tab){
 let output;
 try{
  output=await withAuth("/functions/v1/ed-rider-accept-sms",{
   method:"POST",body:JSON.stringify({order_id:order.id,resend:false})
  });
 }catch(error){
  smsOutcomes.set(order.id,{ok:false,message:"No se ha podido comprobar el SMS. El pedido puede haberse aceptado, pero el envío no está confirmado. Comprueba el aviso con administración; no se reintentará automáticamente."});
  throw error;
 }
 if(!output?.accepted)throw Error("El pedido no se pudo aceptar");
 const link=typeof output.link==="string"&&/^https:\/\/shaniwaris80-crypto\.github\.io\/ESTAMBUL-DELIVERY\/track\.html#token=[a-f0-9]{64}$/.test(output.link)
  ?output.link:null;
 $("riderTrackingFallback").hidden=!link;
 if(link){$("riderTrackingLink").href=link;$("riderTrackingLink").textContent="Abrir seguimiento";$("copyRiderTracking").dataset.link=link;}
 if(output.already_accepted){
  if(tab&&!tab.closed)tab.close();
  $("riderShareNotice").hidden=false;
  smsOutcomes.set(order.id,{ok:false,message:"Pedido aceptado anteriormente. No se ha solicitado otro SMS; el envío inicial no se puede confirmar desde aquí."});
  $("riderShareNotice").textContent="Pedido aceptado anteriormente. No se envía otro SMS. Comprueba con administración el estado del primer intento.";
  return output;
 }
 if(!link){
  if(tab&&!tab.closed)tab.close();
  $("riderShareNotice").hidden=false;
  smsOutcomes.set(order.id,{ok:false,message:"Pedido aceptado sin enlace devuelto. No se puede confirmar el SMS; solicita ayuda al administrador."});
  $("riderShareNotice").textContent="Pedido aceptado, pero no se recibió enlace. Consulta con el administrador.";
  return output;
 }
 if(output.sms_status==="provider_accepted"){
  if(tab&&!tab.closed)tab.close();
  $("riderShareNotice").hidden=false;
  smsOutcomes.set(order.id,{ok:true,message:"Twilio ha aceptado el SMS de seguimiento. Aún no se ha confirmado su recepción en el teléfono."});
  $("riderShareNotice").textContent="✓ Pedido aceptado. El proveedor ha aceptado el SMS con el enlace para el cliente. La entrega del SMS aún no está confirmada.";
 }else if(order.notification_channel==="whatsapp"&&canShareFollowup(order)){
  shareTrackingByWhatsApp(order,link,tab);
 }else{
  if(tab&&!tab.closed)tab.close();
  const reasons={
   provider_disabled:"El envío automático está pendiente de activar con Twilio.",
   provider_not_configured:"Faltan datos del proveedor SMS para enviar automáticamente.",
   provider_rejected:"El proveedor SMS ha rechazado el intento de envío.",
   invalid_phone:"El teléfono del cliente no es válido para SMS.",
   sms_not_authorized:"El cliente no tiene SMS autorizado para este pedido.",
   permission_or_order_error:"No se ha podido verificar el destinatario del SMS.",
   link_error:"No se pudo generar un enlace válido.",
   dispatch_unavailable:"Control de SMS único no disponible. No se ha enviado SMS.",
   already_sent_or_attempted:"Ya existe un intento para este pedido. No se enviará otro SMS."
  };
  $("riderShareNotice").hidden=false;
  smsOutcomes.set(order.id,{ok:false,message:"SMS NO ENVIADO: "+(reasons[output.sms_status]||"Motivo no identificado; revisar configuración.")});
  $("riderShareNotice").textContent="✓ Pedido aceptado. NO se ha enviado ningún SMS. "+
    (reasons[output.sms_status]||"Comprueba la configuración del aviso.")+
    " Puedes copiar el enlace para enviarlo manualmente.";
 }
 return output;
}


let gpsWatchId=null,gpsLastSend=0,gpsBusy=false;
async function stopGps(){
 if(gpsWatchId!==null){navigator.geolocation?.clearWatch(gpsWatchId);gpsWatchId=null;}
 $("toggleGps").textContent="Activar GPS";
 $("gpsStatus").textContent="Ubicación detenida. No estás compartiendo GPS.";
 try{
  if(session&&rider){
   await withAuth("/rest/v1/rpc/ed_stop_rider_position",{method:"POST",body:"{}"});
   const previouslyShared=[...locationShares].filter(([,enabled])=>enabled).map(([id])=>id);
   await Promise.all(previouslyShared.map(id=>withAuth("/rest/v1/rpc/ed_set_customer_location_share",{
    method:"POST",body:JSON.stringify({p_order_id:id,p_enabled:false})
   }).catch(()=>{})));
   for(const id of previouslyShared)locationShares.set(id,false);
   if(identity)draw();
  }
 }catch{}
}
function hasInProgressOrder(){return orders.some(o=>["recogido","en_ruta"].includes(o.status));}
async function shareGps(position){
 if(!session||!rider||!rider.online||!hasInProgressOrder()||document.hidden){
  if(gpsWatchId!==null)void stopGps();
  return;
 }
 const now=Date.now();if(gpsBusy||now-gpsLastSend<14000)return;
 gpsBusy=true;
 try{
  await withAuth("/rest/v1/rpc/ed_update_rider_position",{method:"POST",body:JSON.stringify({
   p_lat:position.coords.latitude,p_lng:position.coords.longitude,
   p_accuracy:Math.round(position.coords.accuracy||0),
   p_speed_kmh:Number.isFinite(position.coords.speed)&&position.coords.speed>=0
     ?Math.min(120,Math.round(position.coords.speed*36)/10):null
  })});
  gpsLastSend=Date.now();
  $("gpsStatus").textContent="Posición compartida con el administrador · "+new Date().toLocaleTimeString("es-ES");
 }catch(error){$("gpsStatus").textContent="GPS no enviado: "+(error.message||String(error));}
 finally{gpsBusy=false;}
}
async function toggleGps(){
 if(gpsWatchId!==null){await stopGps();return;}
 if(!navigator.geolocation){$("gpsStatus").textContent="Este navegador no ofrece geolocalización.";return false;}
 if(!rider?.online||!hasInProgressOrder()){
  $("gpsStatus").textContent="Primero conéctate y recoge un pedido; el GPS solo se comparte durante repartos.";return false;
 }
 $("gpsStatus").textContent="Solicitando permiso de ubicación…";
 gpsWatchId=navigator.geolocation.watchPosition(pos=>void shareGps(pos),
  err=>{void stopGps();$("gpsStatus").textContent="No se pudo obtener ubicación: "+(err.message||"Revisa el permiso de GPS.");},
  {enableHighAccuracy:true,maximumAge:8000,timeout:15000});
 $("toggleGps").textContent="Detener GPS";
 return true;
}
let openChatOrderId=null,chatPolling=false;
function chatText(value){return escapeText(value);}
function showRiderChatMessages(lines){
 const container=$("riderChatMessages");
 container.innerHTML=(lines||[]).length?(lines||[]).map(m=>
 '<div class="chat-bubble '+(m.sender_role==="rider"?"mine":"theirs")+'"><small>'+ (m.sender_role==="rider"?"Tú":"Cliente")+'</small>'+
 '<p>'+chatText(m.body)+'</p><time>'+new Date(m.created_at).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})+'</time></div>').join("")
  :'<p class="chat-blank">Todavía no hay mensajes.</p>';
 container.scrollTop=container.scrollHeight;
}
async function refreshRiderChat(){
 if(!openChatOrderId||chatPolling||document.hidden||!session)return;
 chatPolling=true;
 try{
  const q="/rest/v1/ed_order_chat?select=id,sender_role,body,created_at&order_id=eq."+
   encodeURIComponent(openChatOrderId)+"&order=created_at.asc&limit=50";
  showRiderChatMessages(await withAuth(q));
  $("riderChatError").hidden=true;
 }catch(e){$("riderChatError").textContent=e.message||"Chat no disponible";$("riderChatError").hidden=false;}
 finally{chatPolling=false;}
}
function closeRiderChat(){
 openChatOrderId=null;$("riderChatPanel").hidden=true;$("riderChatText").value="";
}
async function openRiderChat(id){
 const o=orders.find(x=>x.id===id&&["asignado","recogido","en_ruta"].includes(x.status));
 if(!o)return;
 openChatOrderId=o.id;
 $("riderChatTitle").textContent="Pedido #"+o.reference;
 $("riderChatPanel").hidden=false;
 $("riderChatError").hidden=true;
 await refreshRiderChat();
 $("riderChatPanel").scrollIntoView({behavior:"smooth",block:"start"});
}


let shiftReport=null;
function cashLabel(v){return euros(Number(v||0));}
function shiftItems(list,kind){
 const items=list.filter(o=>kind==="unknown"?!o.payment_method:o.payment_method===kind);
 return items.length?items.map(o=>'<div class="shift-line"><div><strong>#'+escapeText(o.reference)+'</strong><small>'+escapeText(o.customer_name)+(o.legacy_timestamp?" · fecha estimada":"")+'</small></div><strong>'+cashLabel(o.amount)+'</strong></div>').join("")
  :'<p class="shift-none">Ningún pedido.</p>';
}
function cashDifference(){
 if(!shiftReport)return;
 const raw=$("declaredCash").value;
 if(raw===""){$("shiftDifference").textContent="Introduce el efectivo contado para calcular la diferencia.";return;}
 const val=Number(raw);
 if(!Number.isFinite(val)||val<0)return;
 const delta=Math.round((val-Number(shiftReport.cash_expected||0))*100)/100;
 $("shiftDifference").textContent="Diferencia: "+cashLabel(delta)+(delta===0?" · Cuadra":delta<0?" · Falta dinero":" · Sobra dinero");
}
function drawCashClose(data){
 shiftReport=data;
 $("shiftShareActions").hidden=false;
 const orders=Array.isArray(data.orders)?data.orders:[];
 $("shiftDateLabel").textContent="Día "+data.shift_day+" · "+data.completed_count+" entregas realizadas";
 const groups=[{type:"efectivo",name:"💶 EFECTIVO",count:data.cash_count,total:data.cash_expected},
   {type:"tarjeta",name:"💳 TARJETA",count:data.card_count,total:data.card_total},
   {type:"unknown",name:"⚠️ POR CLASIFICAR",count:data.unknown_count,total:data.unknown_total}];
 $("dayCloseTotals").innerHTML='<div><small>Efectivo esperado</small><strong>'+cashLabel(data.cash_expected)+'</strong></div>'+
   '<div><small>Tarjeta</small><strong>'+cashLabel(data.card_total)+'</strong></div>'+
   '<div><small>Sin clasificar</small><strong>'+cashLabel(data.unknown_total)+'</strong></div>'+
   '<div class="shift-grand"><small>TOTAL REPARTIDO</small><strong>'+cashLabel(data.grand_total)+'</strong></div>';
 $("dayCloseOrders").innerHTML=groups.map(g=>
  '<section class="shift-group"><h3>'+g.name+' <span>'+g.count+' pedidos · '+cashLabel(g.total)+'</span></h3>'+
   shiftItems(orders,g.type)+'</section>').join("");
 const warnings=[];
 if(Number(data.pending_count)>0)warnings.push(data.pending_count+" entregas sin terminar");
 if(Number(data.unknown_count)>0)warnings.push(data.unknown_count+" pedidos ("+cashLabel(data.unknown_total)+") sin forma de pago: puedes cerrar provisionalmente con explicación y confirmación, dejando esos importes pendientes de conciliación.");
 if(Number(data.legacy_count)>0)warnings.push(data.legacy_count+" entregas antiguas con fecha estimada (última modificación)");
 if(!data.closed&&Number(data.completed_count)===0)warnings.push("No hay entregas nuevas desde el último arqueo.");
 $("shiftWarning").textContent=warnings.join(". ");
 $("shiftWarning").hidden=!warnings.length;
 const provisional=Number(data.unknown_count)>0;
 $("provisionalAcknowledgement").hidden=!provisional||!!data.closed;
 $("finalizeDay").textContent=provisional?"Terminar día provisional y ponerme offline ✓":"Terminar día y ponerme offline ✓";
 $("finalizeDay").disabled=!!data.closed||Number(data.pending_count)>0||Number(data.completed_count)===0;
 $("startNewShift").hidden=!data.closed;
 $("dayCloseInputs").hidden=Boolean(data.closed);
 $("dayCloseDone").hidden=!data.closed;
 if(data.closed){
  $("dayCloseDone").textContent=(data.is_provisional?"⚠ Arqueo provisional guardado. Pagos pendientes de conciliar. ":"✓ Arqueo guardado. ")+"Puedes iniciar otro turno hoy poniéndote ONLINE. Efectivo contado: "+cashLabel(data.cash_declared)+
    " · Diferencia: "+cashLabel(data.cash_difference)+".";
  rider.online=false;
  $("onlineLabel").textContent="Jornada cerrada";
  $("onlineLight").classList.toggle("active",false);
  $("availabilityButton").disabled=false;
 }
 cashDifference();
}
async function previewCashClose(){
 const data=await withAuth("/rest/v1/rpc/ed_shift_preview",{method:"POST",body:"{}"});
 $("dayClosePanel").hidden=false;$("dayCloseError").hidden=true;
 drawCashClose(data);return data;
}
function archeoText(data){
 const line=["*ESTAMBUL DELIVERY · ARQUEO*","Fecha: "+data.shift_day,"Rider: "+(rider?.display_name||""),
  "Entregas: "+data.completed_count,""];
 for(const [title,type,total] of [["EFECTIVO","efectivo",data.cash_expected],["TARJETA","tarjeta",data.card_total],["SIN CLASIFICAR",null,data.unknown_total]]){
  line.push("*"+title+"*");
  for(const o of data.orders||[])if(o.payment_method===type)line.push("#"+o.reference+" - "+o.customer_name+" - "+cashLabel(o.amount));
  line.push("Subtotal: "+cashLabel(total),"");
 }
 line.push("*TOTAL REPARTIDO: "+cashLabel(data.grand_total)+"*");
 if(data.closed)line.push("Efectivo declarado: "+cashLabel(data.cash_declared),"Diferencia: "+cashLabel(data.cash_difference),"Cierre guardado");
 return line.join("\n");
}


// Reordering is a recommendation only: courier assignment stays in Last.app.
const routeState={ids:[],coordsOptimized:false,manualOrder:false};
function waitMinutes(order){
 const created=Date.parse(String(order.created_at||""));
 return Number.isFinite(created)?Math.max(0,Math.min(1440,Math.floor((Date.now()-created)/60000))):0;
}
function waitLabel(order){
 const mins=waitMinutes(order);
 return mins>=60?Math.floor(mins/60)+" h "+(mins%60)+" min esperando":mins+" min esperando";
}
function agePriority(a,b){
 const aIn=a.status==="en_ruta"?0:1,bIn=b.status==="en_ruta"?0:1;
 return aIn-bIn || waitMinutes(b)-waitMinutes(a) || String(a.reference).localeCompare(String(b.reference));
}
function routeStopsOrdered(){
 const active=orders.filter(o=>["asignado","recogido","en_ruta"].includes(o.status));
 const validIds=new Set(active.map(o=>o.id));
 routeState.ids=routeState.ids.filter(id=>validIds.has(id));
 const recent=active.slice().sort(agePriority);
 if(!routeState.manualOrder)routeState.ids=recent.map(o=>o.id);
 else for(const o of recent)if(!routeState.ids.includes(o.id))routeState.ids.push(o.id);
 return routeState.ids.map(id=>active.find(o=>o.id===id)).filter(Boolean);
}
function routeTarget(o){
 if(o.lat!=null&&o.lng!=null)return o.lat+","+o.lng;
 const s=String(o.destination||"").trim();
 return /burgos|españa|spain/i.test(s)?s:s+", Burgos, España";
}
function multiMapsLegs(stops){
 const legs=[];let offset=0,previous=null;
 while(offset<stops.length){
  // Mobile Google Maps URLs: up to three waypoints plus a final destination.
  const selection=stops.slice(offset,offset+(previous?3:4));
  const last=selection[selection.length-1];
  const params=["api=1","destination="+encodeURIComponent(routeTarget(last)),"travelmode=driving"];
  if(previous)params.push("origin="+encodeURIComponent(routeTarget(previous)));
  const waypoints=selection.slice(0,-1).map(routeTarget);
  if(waypoints.length)params.push("waypoints="+encodeURIComponent(waypoints.join("|")));
  legs.push({start:offset+1,end:offset+selection.length,url:"https://www.google.com/maps/dir/?"+params.join("&")});
  previous=last;offset+=selection.length;
 }
 return legs;
}
function renderRoute(){
 const stops=routeStopsOrdered();
 $("multiRoutePanel").hidden=stops.length<2;
 if(stops.length<2)return;
 $("routeCountBadge").textContent=String(stops.length);
 const allGps=stops.every(o=>o.lat!=null&&o.lng!=null&&Number.isFinite(Number(o.lat))&&Number.isFinite(Number(o.lng)));
 $("optimizeRoute").disabled=false;
 $("routeHint").textContent=routeState.coordsOptimized
  ?(allGps?"Ruta sugerida combinando espera y distancia en línea recta. Sin datos de tráfico.":"Ruta sugerida por antigüedad: faltan coordenadas para calcular distancias.")
  :(allGps?"Prioridad por tiempo esperando. Optimiza para combinar urgencia y cercanía.":"Optimizar ordenará por antigüedad si faltan coordenadas. Puedes ajustar manualmente.");
 $("routeStops").innerHTML=stops.map((o,i)=>
  '<div class="route-stop"><span class="route-number">'+(i+1)+'</span><div class="route-info"><strong>'+escapeText(o.customer_name)+'</strong><small>#'+escapeText(o.reference)+' · '+escapeText(o.destination)+'</small><small class="'+(waitMinutes(o)>=30?"route-wait-urgent":waitMinutes(o)>=15?"route-wait-warning":"")+'">◷ '+escapeText(waitLabel(o))+(waitMinutes(o)>=30?" · PRIORIDAD POR ESPERA":"")+'</small></div>'+
  '<div class="route-move"><button type="button" data-route="up" data-index="'+i+'" '+(i===0?"disabled":"")+' aria-label="Subir parada">↑</button><button type="button" data-route="down" data-index="'+i+'" '+(i===stops.length-1?"disabled":"")+' aria-label="Bajar parada">↓</button></div></div>').join("");
 $("routeMapLinks").innerHTML=multiMapsLegs(stops).map((leg,i)=>
  '<a class="route-map-link" href="'+escapeText(leg.url)+'" target="_blank" rel="noopener noreferrer">'+
  (stops.length<=4?"🗺️ Ver todas las paradas en Google Maps ↗":"🗺️ Tramo "+(i+1)+": paradas "+leg.start+"–"+leg.end+" ↗")+'</a>').join("");
}
function routeDistance(a,b){
 const r=Math.PI/180,dlat=(a.lat-b.lat)*r,dlng=(a.lng-b.lng)*r;
 const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;
 return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function recommendAgeAwareRoute(stops,origin){
 const pool=stops.slice(),selected=[];let current=origin,travelled=0;
 while(pool.length){
  let bestIndex=0,bestScore=Infinity;
  pool.forEach((order,i)=>{
   const km=routeDistance(current,order);
   const minutes=km/18*60;
   const wait=waitMinutes(order)+travelled+minutes;
   const delay=Math.max(0,wait-18)*1.3 + Math.max(0,wait-30)*3.5;
   const score=minutes+delay;
   if(score<bestScore){bestScore=score;bestIndex=i;}
  });
  const next=pool.splice(bestIndex,1)[0];
  travelled+=routeDistance(current,next)/18*60+2;
  selected.push(next);current=next;
 }
 return selected;
}
function optimizeRouteByAge(stops){return stops.slice().sort(agePriority);}

let soundContext=null, soundEnabled=false, knownActiveOrders=new Set(), orderBaselineReady=false;
let alertRepeatTimer=null, alertIsOpen=false, alertRingCount=0;
function playBell(){
 if(!soundEnabled||!soundContext)return;
 try{
  if(soundContext.state==="suspended")void soundContext.resume();
  const t=soundContext.currentTime+0.03;
  // Distinct four-tone alert followed by a double-chime, louder than the previous three-note signal.
  // Moderate gain, to avoid audio clipping/headphone discomfort.
  const notes=[{at:0,hz:780,dur:.16},{at:.20,hz:1046,dur:.16},{at:.40,hz:780,dur:.16},
    {at:.60,hz:1175,dur:.27},{at:1.04,hz:940,dur:.18},{at:1.24,hz:1175,dur:.31}];
  for(const note of notes){
   const osc=soundContext.createOscillator(),gain=soundContext.createGain();
   osc.type="square";osc.frequency.setValueAtTime(note.hz,t+note.at);
   gain.gain.setValueAtTime(.0001,t+note.at);
   gain.gain.exponentialRampToValueAtTime(.11,t+note.at+.018);
   gain.gain.exponentialRampToValueAtTime(.0001,t+note.at+note.dur);
   osc.connect(gain).connect(soundContext.destination);
   osc.start(t+note.at);osc.stop(t+note.at+note.dur+.02);
  }
 }catch{}
}
function stopRepeatAlerts(){
 if(alertRepeatTimer!==null){clearTimeout(alertRepeatTimer);alertRepeatTimer=null;}
 alertRingCount=0;
 try{if(navigator.vibrate)navigator.vibrate(0);}catch{}
}
function acknowledgeNewOrders(){
 alertIsOpen=false;
 $("newOrderAlert").hidden=true;
 stopRepeatAlerts();
}
function ringForAssignment(){
 if(!alertIsOpen||!soundEnabled||document.visibilityState!=="visible")return;
 playBell();
 if(navigator.vibrate)try{navigator.vibrate([350,110,300,110,600]);}catch{}
 alertRingCount++;
 // At most 3 strong alert sequences, 6 seconds apart, until the rider confirms.
 if(alertRingCount<3){
  alertRepeatTimer=setTimeout(()=>{alertRepeatTimer=null;ringForAssignment();},6000);
 }
}
function alertNewOrders(count){
 if(!count)return;
 stopRepeatAlerts();
 alertIsOpen=true;
 $("alertHeadline").textContent=count===1?"NUEVO PEDIDO ASIGNADO":count+" NUEVOS PEDIDOS";
 $("alertDetail").textContent=count===1?"Tienes 1 entrega nueva. Consulta su tarjeta para empezar.":"Tienes "+count+" entregas nuevas. Revísalas antes de salir.";
 $("newOrderAlert").hidden=false;
 ringForAssignment();
 if(typeof Notification!=="undefined"&&Notification.permission==="granted"){
  try{new Notification("🚨 ESTAMBUL DELIVERY",{body:count+" nueva(s) entrega(s) asignada(s)",icon:"./docs/rider-icon.png",tag:"rider-new-orders",requireInteraction:true});}catch{}
 }
}
function detectAssigned(current){
 const active=current.filter(o=>!["entregado","cancelado"].includes(o.status)&&o.rider_id===rider?.id);
 const incoming=active.filter(o=>!knownActiveOrders.has(o.id));
 if(orderBaselineReady&&incoming.length)alertNewOrders(incoming.length);
 knownActiveOrders=new Set(active.map(o=>o.id));
 orderBaselineReady=true;
}
async function enableSound(){
 try{
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)throw Error("El dispositivo no admite audio web.");
  if(!soundContext)soundContext=new Audio();
  await soundContext.resume();
  soundEnabled=true;
  $("enableSound").textContent="✓ Alertas activas";
  $("enableSound").classList.add("enabled");
  $("soundStatus").textContent="Sonido fuerte activado. La alarma se repite hasta 3 veces si no confirmas.";
  playBell();
  if(typeof Notification!=="undefined"&&Notification.permission==="default"){
   try{await Notification.requestPermission();}catch{}
  }
 }catch(e){$("soundStatus").textContent="No se pudo activar el sonido: "+(e.message||String(e));}
}

function getSaved() {
  try {
    const s = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    return s && s.access && s.refresh ? s : null;
  } catch { return null; }
}
function setSaved(s) {
  session = s;
  if (s) sessionStorage.setItem(storageKey, JSON.stringify(s));
  else sessionStorage.removeItem(storageKey);
}
function heads() { return { "apikey": publicKey, "Content-Type": "application/json" }; }
async function jsonResponse(response) {
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    throw new Error(data && (data.msg || data.message || data.error_description || data.error) || "Error de conexión (" + response.status + ")");
  }
  return data;
}
async function refreshToken() {
  if (!session || !session.refresh) throw new Error("La sesión ha caducado. Inicia sesión de nuevo.");
  const data = await jsonResponse(await fetch(base + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST", headers: heads(), body: JSON.stringify({ refresh_token: session.refresh })
  }));
  setSaved({ access: data.access_token, refresh: data.refresh_token, expiry: Date.now() + data.expires_in * 1000 });
}
async function withAuth(path, options) {
  if (!session) throw new Error("Necesitas iniciar sesión.");
  if (!session.expiry || Date.now() >= session.expiry - 60000) await refreshToken();
  const headers = { ...heads(), "Authorization": "Bearer " + session.access, ...(options && options.headers || {}) };
  let resp = await fetch(base + path, { ...(options || {}), headers });
  if (resp.status === 401) {
    await refreshToken();
    headers.Authorization = "Bearer " + session.access;
    resp = await fetch(base + path, { ...(options || {}), headers });
  }
  return jsonResponse(resp);
}
function setVisible(view) {
  ["loading", "login", "dashboard", "setup", "setPassword"].forEach(id => { $(id).hidden = id !== view; });
}
function setError(message, loginError) {
  const el = $(loginError ? "loginError" : "connectionNotice");
  el.textContent = message;
  el.hidden = false;
}
function clearError() {
  $("loginError").hidden = true;
  $("connectionNotice").hidden = true;
}
function resetLocal() {
  setSaved(null);
  identity = null; rider = null; orders = []; accountName = "";
  paymentDrafts.clear();paymentInteractionUntil=0;
  itemController?.clear();
  routeState.ids=[];routeState.coordsOptimized=false;routeState.manualOrder=false;
  orderBaselineReady=false;knownActiveOrders.clear();
  showHistory=false;acknowledgeNewOrders();
  $("riderTrackingFallback").hidden=true;
  $("copyRiderTracking").dataset.link="";
  if(gpsWatchId!==null)void stopGps();closeRiderChat();
  $("password").value = "";
  clearError();
  setVisible("login");
}
async function authenticate() {
  const user = await withAuth("/auth/v1/user");
  mustChangePassword=Boolean(user.app_metadata?.estambul_delivery_demo && !user.user_metadata?.estambul_password_changed);
  let membership = await withAuth("/rest/v1/ed_members?select=account_id,role,active&user_id=eq." + encodeURIComponent(user.id) + "&active=eq.true");
  let assignment = Array.isArray(membership) ? membership.find(row => row.role === "rider") : null;
  if (!assignment) {
    // Supabase checks the verified email against a private, preauthorized invitation.
    await withAuth("/rest/v1/rpc/ed_activate_rider", { method: "POST", body: "{}" });
    membership = await withAuth("/rest/v1/ed_members?select=account_id,role,active&user_id=eq." + encodeURIComponent(user.id) + "&active=eq.true");
    assignment = Array.isArray(membership) ? membership.find(row => row.role === "rider") : null;
    if (!assignment) throw new Error("Esta cuenta no tiene una invitación de repartidor válida.");
  }
  const accountId = encodeURIComponent(assignment.account_id);
  const [myRiders, accounts] = await Promise.all([
    withAuth("/rest/v1/ed_riders?select=id,display_name,online,active,user_id&account_id=eq." + accountId),
    withAuth("/rest/v1/ed_accounts?select=id,name&id=eq." + accountId)
  ]);
  const current = myRiders.find(row => row.user_id === user.id && row.active);
  if (!current) throw new Error("Tu rider todavía no está activo en el sistema.");
  // The profile button is a UX shortcut, not an authentication bypass.
  // Reject a password that belongs to any different Rider identity.
  if(selectedRiderSlot!==null&&riderProfiles?.slotForName(current.display_name)!==selectedRiderSlot)
   throw new Error("Esta cuenta no corresponde a RIDER "+String(selectedRiderSlot).padStart(2,"0")+". Solicita al responsable la vinculación correcta.");
  identity = { userId: user.id, accountId: assignment.account_id };
  rider = current;
  accountName = accounts && accounts[0] ? accounts[0].name : "ESTAMBUL DELIVERY";
}
async function fetchOrders() {
  // When an admin starts a new operational period, older orders remain in the
  // database but disappear from the daily Rider workflow. If schema is absent,
  // use the existing orders view unchanged until coordinated rollout.
  const epochRows=await withAuth("/rest/v1/ed_operations_epoch?select=started_at&account_id=eq."+
   encodeURIComponent(identity.accountId)+"&limit=1").catch(()=>null);
  const epoch=Array.isArray(epochRows)&&epochRows[0]?.started_at?epochRows[0].started_at:null;
  const epochFilter=epoch?"&or=(created_at.gte."+encodeURIComponent(epoch)+",and(rider_id.not.is.null,status.in.(asignado,recogido,en_ruta)))":"";
  const endpoint = "/rest/v1/ed_orders?select=id,reference,channel,customer_name,customer_phone,destination,notes,amount,payment_method,accepted_at,notifications_consent,notification_channel,status,rider_id,lat,lng,created_at&account_id=eq." +
    encodeURIComponent(identity.accountId) + "&rider_id=eq." + encodeURIComponent(rider.id) + epochFilter + "&order=created_at.desc&limit=100";
  // Refresh auth token once on the primary query, before ancillary calls run together.
  const response=await withAuth(endpoint);
  const [openDone,shareRows]=await Promise.all([
    withAuth("/rest/v1/rpc/ed_rider_unclosed_completed_ids",{method:"POST",body:"{}"}).catch(()=>null),
    withAuth("/rest/v1/ed_order_location_shares?select=order_id,enabled").catch(()=>null)
  ]);
  const updated = Array.isArray(response) ? response : [];
  // Graceful fallback until migration 013 is installed; never delete completed orders.
  unsettledIds=Array.isArray(openDone)?new Set(openDone):null;
  locationSharingAvailable=Array.isArray(shareRows);
  locationShares=new Map(locationSharingAvailable?shareRows.map(row=>[row.order_id,Boolean(row.enabled)]):[]);
  detectAssigned(updated);
  orders=updated.filter(o=>o.status!=="entregado"||unsettledIds===null||unsettledIds.has(o.id));
  for(const id of paymentDrafts.keys())if(!orders.some(o=>o.id===id&&o.status==="en_ruta"))paymentDrafts.delete(id);
  if(gpsWatchId!==null&&(!rider?.online||!hasInProgressOrder()))void stopGps();
  if(openChatOrderId&&!orders.some(o=>o.id===openChatOrderId&&["asignado","recogido","en_ruta"].includes(o.status)))closeRiderChat();
  lastSync = Date.now();
  draw();
  if(itemFeature)void itemController.load(orders,withAuth,draw);
}
async function updateOrders() {
  if (inFlight || busy || !identity || document.visibilityState !== "visible") return;
  inFlight = true;
  try {
    await fetchOrders();
    $("connectionNotice").hidden = true;
  } catch (error) {
    setError("Sin conexión: " + (error.message || "Inténtalo de nuevo."), false);
    const health=$("riderSyncHealth");
    health.classList.add("stale");
    health.textContent="● Sin conexión";
  } finally { inFlight = false; }
}
function draw(){
 if(!rider)return;
 $("riderName").textContent=rider.display_name;
 $("accountName").textContent=accountName+" · Cuenta individual";
 $("onlineLight").classList.toggle("active",Boolean(rider.online));
 $("onlineLabel").textContent=rider.online?"Estoy disponible":"No disponible";
 $("availabilityButton").setAttribute("aria-pressed",rider.online?"true":"false");
 const active=orders.filter(o=>!["entregado","cancelado"].includes(o.status));
 const inRoute=active.filter(o=>o.status==="en_ruta").sort(agePriority);
 const toCollect=active.filter(o=>o.status!=="en_ruta");
 const done=orders.filter(o=>o.status==="entregado");
 const rank={en_ruta:0,recogido:1,asignado:2,pendiente:3};
 toCollect.sort((a,b)=>(rank[a.status]??4)-(rank[b.status]??4) || waitMinutes(b)-waitMinutes(a));
 $("pendingCount").textContent=active.length;
 $("routeCount").textContent=inRoute.length;
 $("doneCount").textContent=done.length;
 $("listCount").textContent=active.length;
 $("historyCount").textContent=done.length;
 capturePaymentDrafts();
 // Continue 5-second synchronization, but don't replace focused payment selector,
 // recent payment choice, or an ongoing swipe gesture.
 if(!document.activeElement?.matches('select[data-payment-for]')&&activeSwipe===null&&Date.now()>=paymentInteractionUntil)$("orders").innerHTML=active.length
  ? (inRoute.length?'<div class="group-title"><span class="group-dot route"></span>EN REPARTO <small>'+inRoute.length+'</small></div>'+inRoute.map(o=>renderOrder(o,true)).join(""):"")+
    (toCollect.length?'<div class="group-title"><span class="group-dot"></span>POR RECOGER / PREPARAR <small>'+toCollect.length+'</small></div>'+toCollect.map(o=>renderOrder(o,false)).join(""):"")
  :'<div class="empty active-empty"><span class="empty-icon">✓</span><strong>¡Todo al día!</strong><p>No quedan pedidos activos. Las entregas sin arqueo aparecen en el historial.</p></div>';
 $("toggleHistory").setAttribute("aria-expanded",showHistory?"true":"false");
 $("historyPanel").hidden=!showHistory;
 $("historyChevron").textContent=showHistory?"Ocultar ↑":"Mostrar ↓";
 $("historyOrders").innerHTML=showHistory?(done.length?done.map(renderHistoryOrder).join("")
   :'<div class="history-empty">Sin entregas pendientes de arqueo. Las jornadas cerradas siguen disponibles para administración.</div>'):"";
 $("syncStamp").textContent="Actualizado a las "+new Date(lastSync).toLocaleTimeString("es-ES");
 const health=$("riderSyncHealth");
 const recent=lastSync>0&&Date.now()-lastSync<20000;
 health.classList.toggle("stale",!recent);
 health.textContent=recent?"● Sincronizado":"● Sin conexión reciente";
 renderRoute();
}
function mapUrl(order) {
  let target="";
  if(order.lat!=null && order.lng!=null)target=String(order.lat)+","+String(order.lng);
  else{
    const destination=String(order.destination||"").trim();
    if(destination)target=/burgos|españa|spain/i.test(destination)?destination:destination+", Burgos, España";
  }
  return target?"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(target)+"&travelmode=driving":"";
}
function renderHistoryOrder(order){
 const pay=order.payment_method==="efectivo"?"💶 Efectivo":order.payment_method==="tarjeta"?"💳 Tarjeta":"Pago sin indicar";
 return '<article class="history-row">'+
  '<span class="history-row-status" aria-label="Entregado">✓</span>'+
  '<div class="history-row-main"><strong>#'+escapeText(displayOrderCode(order))+'</strong><span>'+escapeText(order.customer_name)+'</span>'+
  '<small>'+escapeText(pay)+'</small></div>'+
  '<div class="history-row-end"><strong>'+euros(order.amount)+'</strong><small>Entregado</small></div></article>';
}
function renderOrder(order,isPriority=false) {
  const nextStatus=allowedNext[order.status];
  const draftPayment=paymentDrafts.get(order.id)??order.payment_method??"";
  const paymentConfirmation=nextStatus==="entregado"
    ?'<label class="payment-confirmation" for="payment-'+escapeText(order.id)+'">'+
      '<span>CONFIRMA EL COBRO ANTES DE ENTREGAR</span>'+
      '<select id="payment-'+escapeText(order.id)+'" data-payment-for="'+escapeText(order.id)+'" required>'+
       '<option value="">Seleccionar método de pago</option>'+
       '<option value="efectivo" '+(draftPayment==="efectivo"?"selected":"")+
       '>💶 Efectivo cobrado</option>'+
       '<option value="tarjeta" '+(draftPayment==="tarjeta"?"selected":"")+
       '>💳 Tarjeta / pago digital confirmado</option></select>'+
      '<small>Verifica lo cobrado de verdad, aunque Last.app haya indicado una preferencia.</small>'+
     '</label>':"";
  const url=mapUrl(order);
  const phone=String(order.customer_phone||"").replace(/[^+0-9]/g,"");
  const tel=(phone.length>=6&&phone.length<=16)?"tel:"+phone:"";
  const status=escapeText(statusNames[order.status]||order.status);
  const guestSharing=Boolean(locationShares.get(order.id));
  const guestButton=locationSharingAvailable&&["recogido","en_ruta"].includes(order.status)
    ?'<button type="button" class="guest-share-action '+(guestSharing?'on':'')+'" data-public-gps="'+escapeText(order.id)+'" aria-pressed="'+guestSharing+'">'+
      (guestSharing?'● Detener mapa del cliente':'◎ Compartir GPS con este cliente')+'</button>'
    :'';
  const progressAction=nextStatus==="entregado"
    ?'<div class="swipe-finish" data-swipe-order="'+escapeText(order.id)+'" aria-label="Desliza para marcar entregado">'+
      '<span class="swipe-progress"></span><span class="swipe-prompt">Desliza para entregar →</span>'+
      '<button type="button" class="swipe-handle" aria-label="Desliza hacia la derecha para confirmar entrega">➜</button></div>'+
      '<button type="button" class="finish-accessible" data-order="'+escapeText(order.id)+'" data-next="entregado">Confirmar entrega con botón</button>'
    :nextStatus?'<button type="button" data-order="'+escapeText(order.id)+'" data-next="'+nextStatus+'">'+escapeText(nextNames[nextStatus])+' →</button>':'';
  const actions=(url?'<a class="maps-action" href="'+escapeText(url)+'" target="_blank" rel="noopener noreferrer">📍 Google Maps ↗</a>':'')+
      (tel?'<a class="phone-action" href="'+escapeText(tel)+'">☎ Llamar</a>':'')+
      (["asignado","recogido","en_ruta"].includes(order.status)?'<button type="button" class="chat-action" data-chat="'+escapeText(order.id)+'">💬 Chat cliente</button>':'')+
      (order.status==="asignado"&&!order.accepted_at
        ?'<button type="button" class="accept-action" data-accept="'+escapeText(order.id)+'">✅ Aceptar pedido'+
          (order.notifications_consent&&order.notification_channel==="sms"?" · SMS automático":
           canShareFollowup(order)?" · WhatsApp manual":"")+'</button>'
        :progressAction)+guestButton+
      (order.accepted_at&&["asignado","recogido","en_ruta"].includes(order.status)
        ?'<span class="one-link-note">Pedido aceptado · SMS no verificado · sin mensajes adicionales por estados</span>':'');
  return '<article class="order-card '+(isPriority?"priority-order":"active-order")+'">'+
    '<div class="order-top"><div><span class="order-number">#'+escapeText(displayOrderCode(order))+
    '</span><span class="channel">'+escapeText(channelNames[order.channel]||order.channel)+
    '</span></div><span class="status '+escapeText(order.status)+'">'+status+'</span></div>'+
    '<div class="order-wait '+(waitMinutes(order)>=30?"order-wait-urgent":waitMinutes(order)>=15?"order-wait-warning":"")+'">◷ '+escapeText(waitLabel(order))+(waitMinutes(order)>=30?" · ENTREGA PRIORITARIA":"")+'</div>'+
    (isPriority?'<span class="priority-tag">● REPARTO EN CURSO</span>':'')+
    '<div class="client-label">CLIENTE</div><h3 class="destination-head">'+escapeText(order.customer_name)+'</h3>'+
    (order.customer_phone?'<p class="client-phone">☎ '+escapeText(order.customer_phone)+'</p>':'<p class="missing-detail">Sin teléfono de cliente registrado</p>')+
    '<div class="client-label client-label-gap">DIRECCIÓN DE ENTREGA</div>'+
    '<p class="destination">📍 '+escapeText(order.destination)+'</p>'+
    (order.notes?'<div class="delivery-notes"><strong>📝 Instrucciones</strong><p>'+escapeText(order.notes)+'</p></div>':'')+
    (itemController?.render(order)||"")+
    '<div class="payment-panel '+(order.payment_method==="efectivo"?"cash":order.payment_method==="tarjeta"?"card":"unknown")+'">'+
    '<span class="payment-title">'+escapeText(order.payment_method==="efectivo"?"💶 COBRAR EN EFECTIVO":order.payment_method==="tarjeta"?"💳 PAGO CON TARJETA":"PAGO SIN INDICAR")+'</span>'+
    '<strong>'+(String(order.reference||"").startsWith("LA-")&&Number(order.amount)===0?
      "0,00 € · verificar importe en Last.app":euros(order.amount))+'</strong></div>'+
    paymentConfirmation+
    '<div class="actions">'+actions+'</div>'+
    (smsOutcomes.has(order.id)?'<div class="sms-delivery-notice '+(smsOutcomes.get(order.id).ok?'ok':'warn')+'" role="status">'+escapeText(smsOutcomes.get(order.id).message)+'</div>':'')+'</article>';
}

async function operation(fn) {
  if (busy) return;
  busy = true; clearError();
  $("availabilityButton").disabled = true; $("refreshButton").disabled = true;
  document.querySelectorAll("[data-order],[data-accept],[data-share],[data-public-gps]").forEach(button => { button.disabled = true; });
  try {
    await fn();
    await fetchOrders();
  } catch (error) {
    setError(error.message || "No se ha podido completar la operación.", false);
    await updateOrders();
  } finally {
    busy = false;
    $("availabilityButton").disabled = false; $("refreshButton").disabled = false;
  }
}
async function signIn(email, password) {
  const response = await jsonResponse(await fetch(base + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: heads(), body: JSON.stringify({ email, password })
  }));
  setSaved({ access: response.access_token, refresh: response.refresh_token, expiry: Date.now() + response.expires_in * 1000 });
  await authenticate();
  await fetchOrders();
  if(selectedRiderSlot!==null&&riderProfiles){
   riderProfiles.rememberEmail(selectedRiderSlot,email);
   updateRiderProfileTiles();
  }
  clearError(); setVisible(mustChangePassword ? "setPassword" : "dashboard"); $("password").value = "";
}
$("registerButton").addEventListener("click", async () => {
  if (busy) return;
  const email = $("email").value.trim(), password = $("password").value;
  clearError();
  if(selectedRiderSlot===null){setError("Selecciona tu perfil Rider 01–05.",true);return;}
  if (!email || password.length < 8) {
    setError("Escribe tu correo autorizado y una contraseña nueva de al menos 8 caracteres.", true);
    return;
  }
  busy = true; $("registerButton").disabled = true; $("loginButton").disabled = true;
  try {
    const redirect = encodeURIComponent("https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/rider.html");
    await jsonResponse(await fetch(base + "/auth/v1/signup?redirect_to=" + redirect, {
      method: "POST", headers: heads(), body: JSON.stringify({ email, password })
    }));
    $("registerInfo").textContent = "Registro solicitado. Confirma tu correo electrónico. Después vuelve aquí e inicia sesión para activar tu cuenta Rider. Revisa spam si no recibes el mensaje.";
    $("registerInfo").hidden = false;
    $("password").value = "";
  } catch (error) {
    setError(error.message || "No se ha podido solicitar el registro.", true);
  } finally {
    busy = false; $("registerButton").disabled = false; $("loginButton").disabled = false;
  }
});
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); if (busy) return;
  if(selectedRiderSlot===null){setError("Primero elige tu RIDER 01–05.",true);return;}
  busy = true; clearError(); $("loginButton").disabled = true;
  try { await signIn($("email").value.trim(), $("password").value); }
  catch (error) {
    // Fail-closed: never keep a session that is not an authorized rider.
    setSaved(null); identity = null; rider = null; orders = [];
    const details = String(error.message || "");
    if (/invalid login credentials|invalid_credentials/i.test(details)) {
      setError("Este correo todavía no ha creado una cuenta, o la contraseña no coincide. Si es tu primer acceso, pulsa «Crear cuenta Rider», elige una contraseña y confirma tu correo antes de entrar.", true);
    } else if (/email not confirmed/i.test(details)) {
      setError("Tu correo todavía no está confirmado. Revisa el mensaje de Supabase en la bandeja de entrada y spam; después vuelve a iniciar sesión.", true);
    } else {
      setError(details || "No se ha podido iniciar sesión.", true);
    }
  } finally { busy = false; $("loginButton").disabled = false; }
});
$("enableSound").addEventListener("click",()=>void enableSound());
$("testSound").addEventListener("click",async()=>{
 if(!soundEnabled)await enableSound();else playBell();
});

$("routeStops").addEventListener("click",e=>{
 const b=e.target.closest("button[data-route]");if(!b)return;
 const index=Number(b.dataset.index),other=index+(b.dataset.route==="up"?-1:1);
 if(!Number.isInteger(index)||index<0||other<0||other>=routeState.ids.length)return;
 [routeState.ids[index],routeState.ids[other]]=[routeState.ids[other],routeState.ids[index]];
 routeState.coordsOptimized=false;routeState.manualOrder=true;renderRoute();
});
$("optimizeRoute").addEventListener("click",()=>{
 const stops=routeStopsOrdered();if(stops.length<2)return;
 const allGps=stops.every(o=>o.lat!=null&&o.lng!=null&&Number.isFinite(Number(o.lat))&&Number.isFinite(Number(o.lng)));
 const ageOnly=()=>{
  routeState.ids=optimizeRouteByAge(stops).map(o=>o.id);
  routeState.coordsOptimized=true;routeState.manualOrder=true;renderRoute();
 };
 if(!allGps||!navigator.geolocation){ageOnly();return;}
 $("optimizeRoute").disabled=true;
 navigator.geolocation.getCurrentPosition(position=>{
  routeState.ids=recommendAgeAwareRoute(stops,{lat:position.coords.latitude,lng:position.coords.longitude}).map(o=>o.id);
  routeState.coordsOptimized=true;routeState.manualOrder=true;renderRoute();
 },()=>{
  ageOnly();
  $("routeHint").textContent="GPS no disponible: ruta por los pedidos que más llevan esperando.";
 },{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
});


$("reviewDay").addEventListener("click",async()=>{
 if(!$("dayClosePanel").hidden){$("dayClosePanel").hidden=true;return;}
 $("reviewDay").disabled=true;
 try{await previewCashClose();}
 catch(e){$("dayClosePanel").hidden=false;$("dayCloseError").hidden=false;$("dayCloseError").textContent=e.message||String(e);}
 finally{$("reviewDay").disabled=false;}
});
$("declaredCash").addEventListener("input",cashDifference);
$("copyReconciliation").addEventListener("click",()=>{
 if(!shiftReport)return;
 const contents=archeoText(shiftReport);
 if(navigator.clipboard?.writeText){
  void navigator.clipboard.writeText(contents).then(()=>{$("copyReconciliation").textContent="✓ Arqueo copiado";})
    .catch(()=>{window.prompt("Copia el arqueo:",contents);});
 } else window.prompt("Copia el arqueo:",contents);
});
$("finalizeDay").addEventListener("click",async()=>{
 if(busy||!shiftReport||shiftReport.closed)return;
 const raw=$("declaredCash").value,declared=Number(raw);
 if(raw===""||!Number.isFinite(declared)||declared<0||declared>999999||Math.abs(declared*100-Math.round(declared*100))>1e-6){
  $("dayCloseError").hidden=false;$("dayCloseError").textContent="Introduce el efectivo real contado (dos decimales como máximo).";return;
 }
 if(Number(shiftReport.pending_count)>0){
  $("dayCloseError").hidden=false;$("dayCloseError").textContent="Debes terminar o reasignar todas las entregas pendientes antes de cerrar.";return;
 }
 const provisional=Number(shiftReport.unknown_count)>0;
 const notes=$("shiftNotes").value.trim();
 if(provisional&&(!$("acknowledgeUnclassified").checked||notes.length<8)){
  $("dayCloseError").hidden=false;
  $("dayCloseError").textContent="Para cerrar provisionalmente, marca la confirmación y escribe una observación de al menos 8 caracteres sobre los pagos pendientes.";return;
 }
 const confirmation=provisional
  ?"¿Terminar jornada provisionalmente dejando "+shiftReport.unknown_count+" pedidos ("+cashLabel(shiftReport.unknown_total)+") pendientes de conciliar? Quedarán registrados como sin clasificar."
  :"¿Cerrar este turno y ponerme offline? Podrás comenzar otro turno hoy.";
 if(!window.confirm(confirmation))return;
 busy=true;$("finalizeDay").disabled=true;$("dayCloseError").hidden=true;
 try{
  const rpc=provisional?"ed_shift_close_provisional":"ed_shift_close";
  const request=provisional?{p_declared_cash:declared,p_notes:notes,p_acknowledge_unknown:true}
    :{p_declared_cash:declared,p_notes:notes};
  await withAuth("/rest/v1/rpc/"+rpc,{method:"POST",body:JSON.stringify(request)});
  await previewCashClose();await fetchOrders();
 }catch(e){
  $("dayCloseError").hidden=false;
  $("dayCloseError").textContent=e.message||"No se pudo guardar el cierre";
  $("finalizeDay").disabled=false;
 }finally{busy=false;}
});

async function setAvailability(nextOnline){
 if(!rider)return;
 const rows=await withAuth("/rest/v1/ed_riders?id=eq."+encodeURIComponent(rider.id),{
  method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({online:nextOnline})
 });
 if(!Array.isArray(rows)||rows.length!==1)throw Error("No se pudo cambiar la disponibilidad");
 rider.online=Boolean(rows[0].online);
 if(nextOnline){
  shiftReport=null;
  $("dayClosePanel").hidden=true;
  $("startNewShift").hidden=true;
  $("declaredCash").value="";
  $("shiftNotes").value="";
  $("acknowledgeUnclassified").checked=false;
 }
}
$("availabilityButton").addEventListener("click",()=>{
 if(!rider)return;
 void operation(async()=>{await setAvailability(!rider.online);});
});
$("startNewShift").addEventListener("click",()=>{
 if(!rider||rider.online)return;
 void operation(async()=>{await setAvailability(true);});
});
$("shareReconciliationWhatsApp").addEventListener("click",()=>{
 if(!shiftReport)return;
 const report=archeoText(shiftReport)+(shiftReport.closed?"":"\n*BORRADOR · NO CERRADO*");
 const url="https://api.whatsapp.com/send?text="+encodeURIComponent(report);
 const w=window.open(url,"_blank","noopener,noreferrer");
 if(!w)window.location.assign(url);
});
$("refreshButton").addEventListener("click", () => void operation(async () => {}));
$("copyRiderTracking").addEventListener("click",()=>{
 const link=$("copyRiderTracking").dataset.link;
 if(!link)return;
 if(navigator.clipboard?.writeText){
  void navigator.clipboard.writeText(link).then(()=>{
   $("riderShareNotice").hidden=false;$("riderShareNotice").textContent="✓ Enlace de seguimiento copiado.";
  }).catch(()=>window.prompt("Copia el enlace:",link));
 }else window.prompt("Copia el enlace:",link);
});
// Si el rider permanece quieto, algunos navegadores dejan de disparar watchPosition.
 // Actualización puntual mientras la web esté visible, sin compartir con clientes sin opt-in.
setInterval(()=>{
 if(gpsWatchId===null||document.hidden||!session||!rider?.online||!hasInProgressOrder())return;
 if(Date.now()-gpsLastSend<17000||gpsBusy)return;
 navigator.geolocation?.getCurrentPosition(
  pos=>void shareGps(pos),
  ()=>{$("gpsStatus").textContent="Esperando señal GPS reciente. Revisa los permisos de ubicación.";},
  {enableHighAccuracy:true,maximumAge:8000,timeout:12000}
 );
},20000);
$("toggleGps").addEventListener("click",()=>void toggleGps());
$("closeRiderChat").addEventListener("click",closeRiderChat);
$("orders").addEventListener("click",e=>{
 const button=e.target.closest("[data-chat]");if(button)void openRiderChat(button.dataset.chat);
});
$("riderChatForm").addEventListener("submit",async e=>{
 e.preventDefault();if(!openChatOrderId)return;
 const value=$("riderChatText").value.trim();if(!value)return;
 $("riderChatText").disabled=true;
 try{
  await withAuth("/rest/v1/rpc/ed_rider_chat_send",{method:"POST",
   body:JSON.stringify({p_order_id:openChatOrderId,p_body:value})});
  $("riderChatText").value="";await refreshRiderChat();
 }catch(err){$("riderChatError").textContent=err.message||"No se pudo enviar";$("riderChatError").hidden=false;}
 finally{$("riderChatText").disabled=false;}
});
setInterval(()=>{if(openChatOrderId)void refreshRiderChat();},7000);
document.addEventListener("visibilitychange",()=>{if(document.hidden&&gpsWatchId!==null)void stopGps();});
window.addEventListener("pagehide",()=>{if(gpsWatchId!==null)void stopGps();});
$("toggleHistory").addEventListener("click",()=>{showHistory=!showHistory;draw();});
$("acknowledgeAlert").addEventListener("click",acknowledgeNewOrders);
$("orders").addEventListener("click",event=>{
 const action=event.target.closest("button[data-accept],button[data-share]");
 if(!action||busy||!rider)return;
 const order=orders.find(o=>o.id===(action.dataset.accept||action.dataset.share));
 const resend=Boolean(action.dataset.share);
 if(!order||!rider.online||!["asignado","recogido","en_ruta"].includes(order.status))return;
 if(!resend&&order.accepted_at)return;
 if(resend)return; // Rider cannot re-issue a tracking token.
 // A direct click reserves WhatsApp before asynchronous RPC (mobile popup protection).
 let tab=null;
 if(canShareFollowup(order)){
  try{tab=window.open("about:blank","_blank");if(tab)tab.opener=null;}catch{}
 }
 void operation(async()=>{
  try{await riderAcceptance(order,resend,tab);}
  catch(err){if(tab&&!tab.closed)tab.close();throw err;}
 });
});
// Customer location is opt-in per delivery. GPS must be enabled first by the rider.
$("orders").addEventListener("click",async event=>{
 const button=event.target.closest("button[data-public-gps]");
 if(!button||busy||!locationSharingAvailable)return;
 const order=orders.find(o=>o.id===button.dataset.publicGps);
 if(!order||!["recogido","en_ruta"].includes(order.status))return;
 const enabled=!Boolean(locationShares.get(order.id));
 if(enabled&&gpsWatchId===null){
  const started=await toggleGps();
  if(!started){
   setError("Necesitas autorizar el GPS con el móvil desbloqueado para compartir tu posición.",false);
   return;
  }
 }
 void operation(async()=>{
  await withAuth("/rest/v1/rpc/ed_set_customer_location_share",{
   method:"POST",body:JSON.stringify({p_order_id:order.id,p_enabled:enabled})
  });
 });
});

// Pointer swipe completion: touch, mouse and pen. Keyboard users have the ordinary button.
let activeSwipe=null;
function resetSwipe(bar){
 bar.style.removeProperty("--swipe-distance");
 bar.style.removeProperty("--swipe-fill");
 bar.classList.remove("dragging");
}
$("orders").addEventListener("pointerdown",event=>{
 const knob=event.target.closest(".swipe-handle");
 if(!knob||busy||!rider?.online)return;
 const bar=knob.closest(".swipe-finish");
 if(!bar)return;
 activeSwipe={id:event.pointerId,bar,knob,startX:event.clientX,travel:Math.max(1,bar.clientWidth-knob.offsetWidth-10),distance:0};
 bar.classList.add("dragging");
 knob.setPointerCapture?.(event.pointerId);
 event.preventDefault();
});
$("orders").addEventListener("pointermove",event=>{
 const a=activeSwipe;if(!a||event.pointerId!==a.id)return;
 a.distance=Math.min(a.travel,Math.max(0,event.clientX-a.startX));
 a.bar.style.setProperty("--swipe-distance",a.distance+"px");
 a.bar.style.setProperty("--swipe-fill",Math.round(a.distance/a.travel*100)+"%");
});
function endSwipe(event){
 const a=activeSwipe;if(!a||event.pointerId!==a.id)return;
 activeSwipe=null;
 const completed=event.type!=="pointercancel"&&a.distance>=a.travel*0.8;
 resetSwipe(a.bar);
 if(completed){
  const fallback=a.bar.parentElement?.querySelector('button[data-next="entregado"]');
  if(fallback&&!fallback.disabled)fallback.click();
 }
}
$("orders").addEventListener("pointerup",endSwipe);
$("orders").addEventListener("pointercancel",endSwipe);
$("orders").addEventListener("keydown",event=>{
 if((event.key==="Enter"||event.key===" ")&&event.target.matches(".swipe-handle")){
  event.preventDefault();
  event.target.closest(".swipe-finish")?.parentElement?.querySelector('button[data-next="entregado"]')?.click();
 }
});

$("orders").addEventListener("change",event=>{
 itemController?.onChange(event);
 if(event.target.matches('select[data-payment-for]')){
  capturePaymentDrafts();paymentInteractionUntil=Date.now()+20000;
 }
});
$("orders").addEventListener("click", event => {
  const button = event.target.closest("button[data-order]");
  if (!button || !rider || busy) return;
  const order = orders.find(row => row.id === button.dataset.order);
  capturePaymentDrafts();
  const status = button.dataset.next;
  if (!order || allowedNext[order.status] !== status) return;
  // Checking pizzas/drinks is an optional aide-mémoire, never a route gate.
  // Reserve a tab during the user gesture: mobile browsers may block it after await.
  // Navigate to Maps only after the status PATCH succeeds.
  // Cash-up requires the Rider to confirm how money was actually collected.
  // The Last.app bill preference is only an initial suggestion.
  let confirmedPayment=null;
  if(status==="entregado"){
    const selector=button.closest(".order-card")?.querySelector("select[data-payment-for]");
    confirmedPayment=selector?.value||"";
    if(!["efectivo","tarjeta"].includes(confirmedPayment)){
      setError("Selecciona y confirma si cobraste en efectivo o por tarjeta antes de entregar.",false);
      selector?.focus();
      return;
    }
  }
  const mapsDestination = status === "en_ruta" ? mapUrl(order) : "";
  let mapsTab = null;
  if (mapsDestination) {
    try { mapsTab = window.open("about:blank", "_blank"); }
    catch {}
    if (mapsTab) mapsTab.opener = null;
  }
  void operation(async () => {
    try {
      const filter = "?id=eq." + encodeURIComponent(order.id) +
        "&rider_id=eq." + encodeURIComponent(rider.id) +
        "&status=eq." + encodeURIComponent(order.status);
      const rows = await withAuth("/rest/v1/ed_orders" + filter, {
        method: "PATCH", headers: { "Prefer": "return=representation" },
        body: JSON.stringify(status==="entregado"?{status,payment_method:confirmedPayment}:{status})
      });
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new Error("El pedido ha sido reasignado o cambiado. Actualiza.");
      }
      if(status==="entregado"){
       itemController?.completed(order.id);paymentDrafts.delete(order.id);paymentInteractionUntil=0;
      }
      // No status-change SMS: customer refreshes the original private link.
      if (mapsDestination) {
        if (mapsTab && !mapsTab.closed) mapsTab.location.replace(mapsDestination);
        else window.location.assign(mapsDestination);
      }
    } catch (error) {
      if (mapsTab && !mapsTab.closed) mapsTab.close();
      throw error;
    }
  });
});
$("logoutButton").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  try {
    if (session) await withAuth("/auth/v1/logout", { method: "POST" });
  } catch {} finally { busy = false; resetLocal(); }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    if (alertIsOpen && soundEnabled && alertRingCount<3 && alertRepeatTimer===null) ringForAssignment();
    if (identity) void updateOrders();
  } else if(alertRepeatTimer!==null){
    clearTimeout(alertRepeatTimer);alertRepeatTimer=null;
  }
});
setInterval(() => { if (identity) void updateOrders(); }, 5000);
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstall = event; $("installButton").hidden = false;
});
$("installButton").addEventListener("click", async () => {
  if (!deferredInstall) return;
  const prompt = deferredInstall; deferredInstall = null; $("installButton").hidden = true;
  await prompt.prompt();
});
window.addEventListener("appinstalled", () => { $("installButton").hidden = true; });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./rider-sw.js").catch(() => {});
  });
}
$("changePassword").addEventListener("click",()=>{ $("setupError").hidden=true;setVisible("setPassword"); });
$("passwordSetupForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const password = $("setupPassword").value;
  if (password.length < 10 || password !== $("setupPasswordConfirm").value) {
    $("setupError").hidden = false;
    $("setupError").textContent = "Las contraseñas deben coincidir y tener al menos 10 caracteres.";
    return;
  }
  busy = true;
  $("savePasswordButton").disabled = true;
  $("setupError").hidden = true;
  try {
    // Supabase Auth validates the invitation JWT; password is never stored by this app.
    await withAuth("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password, data:{estambul_password_changed:true} }) });
    mustChangePassword=false;
    $("setupPassword").value = ""; $("setupPasswordConfirm").value = "";
    await fetchOrders();
    setVisible("dashboard");
  } catch (error) {
    $("setupError").textContent = error.message || "No se pudo actualizar la contraseña.";
    $("setupError").hidden = false;
  } finally {
    busy = false;
    $("savePasswordButton").disabled = false;
  }
});
async function start() {
  if (!configured) { setVisible("setup"); return; }
  const hash=new URLSearchParams(window.location.hash.slice(1));
  let invited=false;
  if (hash.get("access_token") && hash.get("refresh_token") && ["invite", "recovery", "signup"].includes(hash.get("type"))) {
    setSaved({
      access:hash.get("access_token"),
      refresh:hash.get("refresh_token"),
      expiry:Date.now()+Number(hash.get("expires_in")||3600)*1000
    });
    invited=hash.get("type")==="invite" || hash.get("type")==="recovery";
    // Remove credentials from the browser address bar as soon as they are read.
    window.history.replaceState(null,"",window.location.pathname+window.location.search);
  } else if (new URLSearchParams(window.location.search).get("token_hash")) {
    const q=new URLSearchParams(window.location.search);
    const type=q.get("type");
    try {
      const data=await jsonResponse(await fetch(base+"/auth/v1/verify", {
        method:"POST",headers:heads(),body:JSON.stringify({token_hash:q.get("token_hash"),type})
      }));
      if (data.access_token && data.refresh_token) {
        setSaved({access:data.access_token,refresh:data.refresh_token,expiry:Date.now()+data.expires_in*1000});
        invited=type==="invite" || type==="recovery";
      }
      window.history.replaceState(null,"",window.location.pathname);
    } catch (error) {
      window.history.replaceState(null,"",window.location.pathname);
      setVisible("login");setError("No fue posible confirmar la invitación: "+(error.message||"Error"),true);return;
    }
  } else session = getSaved();
  if (!session) { setVisible("login"); return; }
  try {
    await authenticate();
    await fetchOrders();
    setVisible(invited || mustChangePassword ? "setPassword" : "dashboard");
  } catch (error) {
    resetLocal();
    if (invited) setError("La invitación no pudo activarse: "+(error.message||"Error"),true);
  }
}
void start();
})();