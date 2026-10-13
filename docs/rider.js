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
let orders = [], busy = false, inFlight = false, showDone = true, lastSync = 0;
let deferredInstall = null;
let mustChangePassword=false;

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
 $("shiftWarning").textContent=warnings.join(". ");
 $("shiftWarning").hidden=!warnings.length;
 const provisional=Number(data.unknown_count)>0;
 $("provisionalAcknowledgement").hidden=!provisional||!!data.closed;
 $("finalizeDay").textContent=provisional?"Terminar día provisional y ponerme offline ✓":"Terminar día y ponerme offline ✓";
 $("finalizeDay").disabled=!!data.closed||Number(data.pending_count)>0;
 $("dayCloseInputs").hidden=Boolean(data.closed);
 $("dayCloseDone").hidden=!data.closed;
 if(data.closed){
  $("dayCloseDone").textContent=(data.is_provisional?"⚠ Jornada cerrada provisionalmente. Los pagos sin clasificar requieren conciliación. ":"✓ Jornada cerrada. ")+"Rider offline. Efectivo contado: "+cashLabel(data.cash_declared)+
    " · Diferencia: "+cashLabel(data.cash_difference)+".";
  rider.online=false;
  $("onlineLabel").textContent="Jornada cerrada";
  $("onlineLight").classList.toggle("active",false);
  $("availabilityButton").disabled=true;
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

let soundContext=null, soundEnabled=false, knownActiveOrders=new Set(), orderBaselineReady=false, toastTimer=null;
function playBell(){
 if(!soundEnabled||!soundContext)return;
 try{
  if(soundContext.state==="suspended")void soundContext.resume();
  const baseTime=soundContext.currentTime+0.035;
  // Two short notes, Web Audio API. No remote media or notification keys required.
  [0,0.19,0.38].forEach((offset,i)=>{
   const oscillator=soundContext.createOscillator();
   const gain=soundContext.createGain();
   oscillator.type="sine";
   oscillator.frequency.setValueAtTime([740,880,988][i],baseTime+offset);
   gain.gain.setValueAtTime(0.0001,baseTime+offset);
   gain.gain.exponentialRampToValueAtTime(0.18,baseTime+offset+0.025);
   gain.gain.exponentialRampToValueAtTime(0.0001,baseTime+offset+0.16);
   oscillator.connect(gain).connect(soundContext.destination);
   oscillator.start(baseTime+offset);
   oscillator.stop(baseTime+offset+0.18);
  });
 }catch{}
}
function alertNewOrders(count){
 if(!count)return;
 playBell();
 if("vibrate" in navigator)try{navigator.vibrate([180,80,180]);}catch{}
 const box=$("newOrderAlert");
 box.textContent="🔔 "+count+(count===1?" nuevo pedido asignado":" nuevos pedidos asignados")+". ¡Revisa tus entregas!";
 box.hidden=false;
 if(toastTimer)clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{box.hidden=true;},14000);
 if(typeof Notification!=="undefined" && Notification.permission==="granted" && document.visibilityState!=="hidden"){
  try{new Notification("ESTAMBUL RIDER",{body:"Tienes "+count+" entrega(s) asignada(s).",icon:"./docs/rider-icon.png",tag:"estambul-new-assignment"});}catch{}
 }
}
function detectAssigned(current){
 const active=current.filter(o=>!["entregado","cancelado"].includes(o.status)&&o.rider_id===rider?.id);
 const incoming=active.filter(o=>!knownActiveOrders.has(o.id));
 if(orderBaselineReady && incoming.length)alertNewOrders(incoming.length);
 knownActiveOrders=new Set(active.map(o=>o.id));
 orderBaselineReady=true;
}
async function enableSound(){
 try{
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)throw new Error("Este navegador no admite audio.");
  if(!soundContext)soundContext=new Audio();
  await soundContext.resume();
  soundEnabled=true;
  $("enableSound").textContent="✓ Sonido activo";
  $("enableSound").classList.add("enabled");
  $("soundStatus").textContent="Aviso activado: sonará al recibir un pedido nuevo con esta app abierta.";
  playBell();
  if(typeof Notification!=="undefined"&&Notification.permission==="default"){
   try{await Notification.requestPermission();}catch{}
  }
 }catch(err){$("soundStatus").textContent="No se pudo activar: "+(err.message||"abre la app desde el navegador.");}
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
function draw() {
  if (!rider) return;
  $("riderName").textContent = rider.display_name;
  $("accountName").textContent = accountName + " · Cuenta individual";
  $("onlineLight").classList.toggle("active", Boolean(rider.online));
  $("onlineLabel").textContent = rider.online ? "Estoy disponible" : "No disponible";
  $("availabilityButton").setAttribute("aria-pressed", rider.online ? "true" : "false");
  const open = orders.filter(o => !["entregado", "cancelado"].includes(o.status));
  $("pendingCount").textContent = open.length;
  $("routeCount").textContent = open.filter(o => o.status === "en_ruta").length;
  $("doneCount").textContent = orders.filter(o => o.status === "entregado").length;
  const shown = showDone ? open.concat(orders.filter(o => o.status === "entregado")) : open;
  $("listCount").textContent = shown.length;
  $("orders").innerHTML = shown.length ? shown.map(renderOrder).join("") :
    '<div class="empty"><span class="empty-icon">📦</span><strong>Sin entregas asignadas</strong><p>No tienes entregas pendientes. Si ya has completado pedidos, activa «Entregados» para consultar el historial.</p></div>';
  $("syncStamp").textContent = "Actualizado a las " + new Date(lastSync).toLocaleTimeString("es-ES");
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
function renderOrder(order) {
  const nextStatus=allowedNext[order.status];
  const url=mapUrl(order);
  const phone=String(order.customer_phone||"").replace(/[^+0-9]/g,"");
  const tel=(phone.length>=6&&phone.length<=16)?"tel:"+phone:"";
  const status=escapeText(statusNames[order.status]||order.status);
  const actions=(url?'<a class="maps-action" href="'+escapeText(url)+'" target="_blank" rel="noopener noreferrer">📍 Google Maps ↗</a>':'')+
      (tel?'<a class="phone-action" href="'+escapeText(tel)+'">☎ Llamar</a>':'')+
      (nextStatus?'<button type="button" data-order="'+escapeText(order.id)+'" data-next="'+nextStatus+'">'+escapeText(nextNames[nextStatus])+' →</button>':'');
  return '<article class="order-card">'+
    '<div class="order-top"><div><span class="order-number">#'+escapeText(order.reference)+
    '</span><span class="channel">'+escapeText(channelNames[order.channel]||order.channel)+
    '</span></div><span class="status '+escapeText(order.status)+'">'+status+'</span></div>'+
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
  :"¿Terminar la jornada y dejar el rider fuera de servicio hasta mañana?";
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

$("availabilityButton").addEventListener("click", () => {
  if (!rider) return;
  const newOnline = !rider.online;
  void operation(async () => {
    const rows = await withAuth("/rest/v1/ed_riders?id=eq." + encodeURIComponent(rider.id), {
      method: "PATCH", headers: { "Prefer": "return=representation" }, body: JSON.stringify({ online: newOnline })
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("La disponibilidad no pudo actualizarse.");
    rider.online = Boolean(rows[0].online);
  });
});
$("refreshButton").addEventListener("click", () => void operation(async () => {}));
$("showDone").addEventListener("change", e => { showDone = Boolean(e.target.checked); draw(); });
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
  if (!document.hidden && identity) void updateOrders();
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