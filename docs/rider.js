/* ESTAMBUL DELIVERY Rider · Aplicación web PWA: datos reales de backend de PRUEBAS.
 * Sin integración Last.app; autentica con Supabase y RLS.
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
const storageKey = "estambul-rider-pwa-session";
let session = null, identity = null, rider = null, accountName = "";
let orders = [], busy = false, inFlight = false, showHistory = false, lastSync = 0;
let deferredInstall = null;
let mustChangePassword=false;

let gpsWatchId=null,gpsLastSend=0,gpsBusy=false;
async function stopGps(){
 if(gpsWatchId!==null){navigator.geolocation?.clearWatch(gpsWatchId);gpsWatchId=null;}
 $("toggleGps").textContent="Activar GPS";
 $("gpsStatus").textContent="Ubicación detenida. No estás compartiendo GPS.";
 try{if(session&&rider)await withAuth("/rest/v1/rpc/ed_stop_rider_position",{method:"POST",body:"{}"});}catch{}
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
   p_accuracy:Math.round(position.coords.accuracy||0)
  })});
  gpsLastSend=Date.now();
  $("gpsStatus").textContent="Posición compartida con el administrador · "+new Date().toLocaleTimeString("es-ES");
 }catch(error){$("gpsStatus").textContent="GPS no enviado: "+(error.message||String(error));}
 finally{gpsBusy=false;}
}
async function toggleGps(){
 if(gpsWatchId!==null){await stopGps();return;}
 if(!navigator.geolocation){$("gpsStatus").textContent="Este navegador no ofrece geolocalización.";return;}
 if(!rider?.online||!hasInProgressOrder()){
  $("gpsStatus").textContent="Primero conéctate y recoge un pedido; el GPS solo se comparte durante repartos.";return;
 }
 $("gpsStatus").textContent="Solicitando permiso de ubicación…";
 gpsWatchId=navigator.geolocation.watchPosition(pos=>void shareGps(pos),
  err=>{void stopGps();$("gpsStatus").textContent="No se pudo obtener ubicación: "+(err.message||"Revisa el permiso de GPS.");},
  {enableHighAccuracy:true,maximumAge:8000,timeout:15000});
 $("toggleGps").textContent="Detener GPS";
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


const routeState={ids:[],coordsOptimized:false};
function routeStopsOrdered(){
 const active=orders.filter(o=>["asignado","recogido","en_ruta"].includes(o.status));
 const validIds=new Set(active.map(o=>o.id));
 routeState.ids=routeState.ids.filter(id=>validIds.has(id));
 const recent=active.slice().sort((a,b)=>(a.status==="en_ruta"?0:1)-(b.status==="en_ruta"?0:1)
  || String(a.created_at||"").localeCompare(String(b.created_at||"")));
 for(const o of recent)if(!routeState.ids.includes(o.id))routeState.ids.push(o.id);
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
 const allGps=stops.every(o=>o.lat!=null&&o.lng!=null);
 $("optimizeRoute").disabled=!allGps;
 $("routeHint").textContent=allGps
  ?(routeState.coordsOptimized?"Orden recomendado según distancias aproximadas en línea recta, no tráfico.":"Puedes optimizar por proximidad o reordenar manualmente.")
  :"Google Maps mostrará las direcciones. Sin coordenadas no podemos calcular el orden óptimo: utiliza las flechas para ordenar manualmente.";
 $("routeStops").innerHTML=stops.map((o,i)=>
  '<div class="route-stop"><span class="route-number">'+(i+1)+'</span><div class="route-info"><strong>'+escapeText(o.customer_name)+'</strong><small>#'+escapeText(o.reference)+' · '+escapeText(o.destination)+'</small></div>'+
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
function nearestOrder(stops,origin){
 const pool=stops.slice(),selected=[];let pos=origin;
 while(pool.length){
  let index=0,minimum=Infinity;
  pool.forEach((s,i)=>{const d=routeDistance(pos,s);if(d<minimum){index=i;minimum=d;}});
  const next=pool.splice(index,1)[0];selected.push(next);pos=next;
 }
 return selected;
}

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
  routeState.ids=[];routeState.coordsOptimized=false;
  orderBaselineReady=false;knownActiveOrders.clear();
  showHistory=false;acknowledgeNewOrders();
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
  identity = { userId: user.id, accountId: assignment.account_id };
  rider = current;
  accountName = accounts && accounts[0] ? accounts[0].name : "ESTAMBUL DELIVERY";
}
async function fetchOrders() {
  const endpoint = "/rest/v1/ed_orders?select=id,reference,channel,customer_name,customer_phone,destination,notes,amount,payment_method,status,rider_id,lat,lng,created_at&account_id=eq." +
    encodeURIComponent(identity.accountId) + "&rider_id=eq." + encodeURIComponent(rider.id) + "&order=created_at.desc&limit=100";
  const response = await withAuth(endpoint);
  const updated = Array.isArray(response) ? response : [];
  detectAssigned(updated);
  orders=updated;
  if(gpsWatchId!==null&&(!rider?.online||!hasInProgressOrder()))void stopGps();
  if(openChatOrderId&&!orders.some(o=>o.id===openChatOrderId&&["asignado","recogido","en_ruta"].includes(o.status)))closeRiderChat();
  lastSync = Date.now();
  draw();
}
async function updateOrders() {
  if (inFlight || busy || !identity || document.visibilityState !== "visible") return;
  inFlight = true;
  try {
    await fetchOrders();
    $("connectionNotice").hidden = true;
  } catch (error) {
    setError("Sin conexión: " + (error.message || "Inténtalo de nuevo."), false);
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
 const inRoute=active.filter(o=>o.status==="en_ruta");
 const toCollect=active.filter(o=>o.status!=="en_ruta");
 const done=orders.filter(o=>o.status==="entregado");
 const rank={en_ruta:0,recogido:1,asignado:2,pendiente:3};
 toCollect.sort((a,b)=>(rank[a.status]??4)-(rank[b.status]??4) || String(a.created_at||"").localeCompare(String(b.created_at||"")));
 $("pendingCount").textContent=active.length;
 $("routeCount").textContent=inRoute.length;
 $("doneCount").textContent=done.length;
 $("listCount").textContent=active.length;
 $("historyCount").textContent=done.length;
 $("orders").innerHTML=active.length
  ? (inRoute.length?'<div class="group-title"><span class="group-dot route"></span>EN REPARTO <small>'+inRoute.length+'</small></div>'+inRoute.map(o=>renderOrder(o,true)).join(""):"")+
    (toCollect.length?'<div class="group-title"><span class="group-dot"></span>POR RECOGER / PREPARAR <small>'+toCollect.length+'</small></div>'+toCollect.map(o=>renderOrder(o,false)).join(""):"")
  :'<div class="empty active-empty"><span class="empty-icon">✓</span><strong>¡Todo al día!</strong><p>No quedan pedidos pendientes ni en reparto. Las entregas realizadas están en el historial de abajo.</p></div>';
 $("toggleHistory").setAttribute("aria-expanded",showHistory?"true":"false");
 $("historyPanel").hidden=!showHistory;
 $("historyChevron").textContent=showHistory?"Ocultar ↑":"Mostrar ↓";
 $("historyOrders").innerHTML=showHistory?(done.length?done.map(renderHistoryOrder).join("")
   :'<div class="history-empty">Aún no tienes entregas completadas.</div>'):"";
 $("syncStamp").textContent="Actualizado a las "+new Date(lastSync).toLocaleTimeString("es-ES");
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
  '<div class="history-row-main"><strong>#'+escapeText(order.reference)+'</strong><span>'+escapeText(order.customer_name)+'</span>'+
  '<small>'+escapeText(pay)+'</small></div>'+
  '<div class="history-row-end"><strong>'+euros(order.amount)+'</strong><small>Entregado</small></div></article>';
}
function renderOrder(order,isPriority=false) {
  const nextStatus=allowedNext[order.status];
  const url=mapUrl(order);
  const phone=String(order.customer_phone||"").replace(/[^+0-9]/g,"");
  const tel=(phone.length>=6&&phone.length<=16)?"tel:"+phone:"";
  const status=escapeText(statusNames[order.status]||order.status);
  const actions=(url?'<a class="maps-action" href="'+escapeText(url)+'" target="_blank" rel="noopener noreferrer">📍 Google Maps ↗</a>':'')+
      (tel?'<a class="phone-action" href="'+escapeText(tel)+'">☎ Llamar</a>':'')+
      (["asignado","recogido","en_ruta"].includes(order.status)?'<button type="button" class="chat-action" data-chat="'+escapeText(order.id)+'">💬 Chat cliente</button>':'')+
      (nextStatus?'<button type="button" data-order="'+escapeText(order.id)+'" data-next="'+nextStatus+'">'+escapeText(nextNames[nextStatus])+' →</button>':'');
  return '<article class="order-card '+(isPriority?"priority-order":"active-order")+'">'+
    '<div class="order-top"><div><span class="order-number">#'+escapeText(order.reference)+
    '</span><span class="channel">'+escapeText(channelNames[order.channel]||order.channel)+
    '</span></div><span class="status '+escapeText(order.status)+'">'+status+'</span></div>'+
    (isPriority?'<span class="priority-tag">● REPARTO EN CURSO</span>':'')+
    '<div class="client-label">CLIENTE</div><h3 class="destination-head">'+escapeText(order.customer_name)+'</h3>'+
    (order.customer_phone?'<p class="client-phone">☎ '+escapeText(order.customer_phone)+'</p>':'<p class="missing-detail">Sin teléfono de cliente registrado</p>')+
    '<div class="client-label client-label-gap">DIRECCIÓN DE ENTREGA</div>'+
    '<p class="destination">📍 '+escapeText(order.destination)+'</p>'+
    (order.notes?'<div class="delivery-notes"><strong>📝 Instrucciones</strong><p>'+escapeText(order.notes)+'</p></div>':'')+
    '<div class="payment-panel '+(order.payment_method==="efectivo"?"cash":order.payment_method==="tarjeta"?"card":"unknown")+'">'+
    '<span class="payment-title">'+escapeText(order.payment_method==="efectivo"?"💶 COBRAR EN EFECTIVO":order.payment_method==="tarjeta"?"💳 PAGO CON TARJETA":"PAGO SIN INDICAR")+'</span>'+
    '<strong>'+euros(order.amount)+'</strong></div>'+
    '<div class="actions">'+actions+'</div></article>';
}

async function operation(fn) {
  if (busy) return;
  busy = true; clearError();
  $("availabilityButton").disabled = true; $("refreshButton").disabled = true;
  document.querySelectorAll("[data-order]").forEach(button => { button.disabled = true; });
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
  clearError(); setVisible(mustChangePassword ? "setPassword" : "dashboard"); $("password").value = "";
}
$("registerButton").addEventListener("click", async () => {
  if (busy) return;
  const email = $("email").value.trim(), password = $("password").value;
  clearError();
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
 routeState.coordsOptimized=false;renderRoute();
});
$("optimizeRoute").addEventListener("click",()=>{
 const stops=routeStopsOrdered();
 if(stops.length<2||!stops.every(o=>o.lat!=null&&o.lng!=null))return;
 if(!navigator.geolocation){$("routeHint").textContent="Este dispositivo no permite obtener la ubicación.";return;}
 $("optimizeRoute").disabled=true;
 navigator.geolocation.getCurrentPosition(position=>{
  routeState.ids=nearestOrder(stops,{lat:position.coords.latitude,lng:position.coords.longitude}).map(o=>o.id);
  routeState.coordsOptimized=true;renderRoute();
 },()=>{$("optimizeRoute").disabled=false;$("routeHint").textContent="Ubicación no disponible; ordena las paradas manualmente.";},
 {enableHighAccuracy:false,timeout:10000,maximumAge:60000});
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
$("orders").addEventListener("click", event => {
  const button = event.target.closest("button[data-order]");
  if (!button || !rider || busy) return;
  const order = orders.find(row => row.id === button.dataset.order);
  const status = button.dataset.next;
  if (!order || allowedNext[order.status] !== status) return;
  // Reserve a tab during the user gesture: mobile browsers may block it after await.
  // Navigate to Maps only after the status PATCH succeeds.
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
        method: "PATCH", headers: { "Prefer": "return=representation" }, body: JSON.stringify({ status })
      });
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new Error("El pedido ha sido reasignado o cambiado. Actualiza.");
      }
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