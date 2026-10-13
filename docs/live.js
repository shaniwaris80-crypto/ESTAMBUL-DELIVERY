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
let shiftClosures=[],shiftClosureItems=[];
const storage="estambul-secure-test-session";
try{session=JSON.parse(sessionStorage.getItem(storage)||"null")}catch{}
function persist(){if(session)sessionStorage.setItem(storage,JSON.stringify(session));else sessionStorage.removeItem(storage)}
function message(e,login=false){const box=el(login?"loginError":"errorBox");box.textContent=e.message||String(e);box.hidden=false;}
function clearError(){el("loginError").hidden=true;el("errorBox").hidden=true}
async function parsed(r){const raw=await r.text();let o=null;try{o=JSON.parse(raw)}catch{o=raw}if(!r.ok)throw Error(o?.message||o?.error_description||o?.error||"HTTP "+r.status);return o}
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
 el("staffView").hidden=!staff;el("riderView").hidden=staff;el("inviteCard").hidden=member.role!=="admin";
 el("accountLabel").textContent=account.name+" · "+member.role.toUpperCase();
 el("viewTitle").textContent=staff?"Centro de reparto":"Mis entregas";
 el("viewSub").textContent="Sincronizado entre dispositivos · actualización cada 5 segundos · solo datos de prueba";
 el("connection").textContent="Conectado";
}
async function reload(){
 const q=encodeURIComponent(member.account_id);
 const [rs,os]=await Promise.all([
  query("/rest/v1/ed_riders?select=id,user_id,display_name,online,active&account_id=eq."+q+"&order=display_name.asc"),
  query("/rest/v1/ed_orders?select=id,reference,channel,customer_name,customer_phone,destination,notes,lat,lng,amount,payment_method,status,rider_id,created_at&account_id=eq."+q+"&order=created_at.desc&limit=100")
 ]);
 riders=rs||[];orders=os||[];
 if(member.role!=="rider"){
  try{
   shiftClosures=await query("/rest/v1/ed_shift_closures?select=id,account_id,rider_id,shift_day,completed_count,cash_expected,card_total,unknown_total,cash_declared,cash_difference,notes,closed_at,legacy_count&account_id=eq."+q+"&order=closed_at.desc&limit=30");
   const ids=(shiftClosures||[]).map(c=>c.id);
   shiftClosureItems=ids.length?await query("/rest/v1/ed_shift_closure_items?select=close_id,reference,customer_name,payment_method,amount,legacy_timestamp&close_id=in.("+ids.join(",")+")"):[];
  }catch(error){shiftClosures=[];shiftClosureItems=[];message(error);}
 }
 render();
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
  return '<details class="shift-admin-report"><summary><strong>'+esc(name)+' · '+esc(s.shift_day)+'</strong><span>'+s.completed_count+' entregas · '+formatArcheoEuro(amount)+'</span></summary>'+
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

function render(){
 const staff=member.role!=="rider",open=orders.filter(o=>!["entregado","cancelado"].includes(o.status));
 const stats=[["Pedidos",orders.length],["Sin asignar",open.filter(o=>!o.rider_id).length],["En ruta",open.filter(o=>o.status==="en_ruta").length],[staff?"Riders":"Mis pendientes",staff?riders.filter(r=>r.active).length:open.length]];
 el("stats").innerHTML=stats.map(x=>'<div class="stat"><small>'+esc(x[0])+'</small><b>'+x[1]+'</b><small>En esta cuenta</small></div>').join("");
 el("lastSync").textContent="Actualizado a las "+new Date().toLocaleTimeString("es-ES")+" · Acceso limitado por usuario (RLS)";
 if(staff){
  el("riderCount").textContent=riders.filter(r=>r.active).length+" activos";
  el("orderCount").textContent=orders.length+" pedidos";
  drawShiftHistory();
  el("riders").innerHTML=riders.map(r=>'<div class="rider-item"><span class="avatar">'+esc(r.display_name.slice(0,2).toUpperCase())+'</span><span><strong>'+esc(r.display_name)+'</strong><small>'+(r.active?(r.online?"● Online":"○ Desconectado"):"Inactivo")+' · '+open.filter(o=>o.rider_id===r.id).length+' pedidos</small></span></div>').join("")||"<p>Sin riders</p>";
  el("ordersTable").innerHTML=orders.map(o=>{
    const options='<option value="">Sin asignar</option>'+riders.filter(r=>r.active).map(r=>'<option value="'+esc(r.id)+'" '+(o.rider_id===r.id?"selected":"")+'>'+esc(r.display_name)+'</option>').join("");
    const gmaps=mapsLink(o);
    return '<tr><td><strong>'+esc(o.reference)+'</strong><small>'+esc(Number(o.amount||0).toFixed(2))+' €</small></td>'+
      '<td><strong>'+esc(o.customer_name)+'</strong><small>'+esc(o.destination)+'</small>'+
      (o.customer_phone?'<small>☎ '+esc(o.customer_phone)+'</small>':'')+
      (o.notes?'<small>📝 '+esc(o.notes)+'</small>':'')+
      (gmaps?'<small><a href="'+gmaps+'" target="_blank" rel="noopener noreferrer">📍 Google Maps ↗</a></small>':'')+
      '</td><td>'+esc(chan[o.channel]||o.channel)+'</td><td><strong>'+esc(o.payment_method==='efectivo'?'💶 Efectivo':o.payment_method==='tarjeta'?'💳 Tarjeta':'Por indicar')+'</strong></td><td><span class="pill">'+esc(labels[o.status])+
      '</span></td><td><select data-assign="'+esc(o.id)+'" '+(["entregado","cancelado"].includes(o.status)?"disabled":"")+'>'+options+'</select></td><td><button class="outline" type="button" data-edit="'+esc(o.id)+'">Editar</button></td></tr>';
  }).join("")||'<tr><td colspan="7">Sin pedidos.</td></tr>';
 }else{
  el("myOrders").innerHTML=orders.map(o=>{
    const n=next[o.status],map=mapsLink(o);
    return '<article class="my-order"><small>'+esc(chan[o.channel]||o.channel)+'</small><h3>'+esc(o.reference)+'</h3><p><strong>'+esc(o.customer_name)+'</strong></p><p>'+esc(o.destination)+'</p><p class="pill">'+esc(labels[o.status])+'</p><div class="actions">'+(map?'<a target="_blank" rel="noopener noreferrer" href="'+map+'">Google Maps ↗</a>':"")+(n?'<button class="btn" data-advance="'+esc(o.id)+'" data-next="'+n+'">'+esc({recogido:"Recogido",en_ruta:"Iniciar reparto",entregado:"Entregado"}[n])+'</button>':"")+'</div></article>';
  }).join("")||'<p>No hay pedidos asignados a este rider.</p>';
 }
}
async function operation(fn){
 if(busy)return;busy=true;clearError();
 try{await fn();await reload()}catch(e){message(e)}
 finally{busy=false}
}
async function start(){
 if(!ready){el("noConfig").hidden=false;el("connection").textContent="Sin configurar";return}
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
 }catch(err){session=null;persist();member=null;el("loginSection").hidden=false;message(err,true)}
 finally{busy=false;el("signInButton").disabled=false}
});
el("logout").addEventListener("click",()=>{session=null;persist();member=null;account=null;orders=[];riders=[];el("appSection").hidden=true;el("logout").hidden=true;el("loginSection").hidden=false;el("connection").textContent="Desconectado"});
el("sendInvitations").addEventListener("click",async()=>{
 if(busy||member?.role!=="admin")return;
 busy=true;clearError();el("sendInvitations").disabled=true;
 try{
  if(!window.confirm("¿Crear dos usuarios Rider de prueba con contraseñas temporales únicas? Se mostrarán solo una vez."))return;
  const result=await query("/functions/v1/ed-invite-riders",{method:"POST",body:"{}"});
  const lines=(result.results||[]).map(r=>
   r.email+" — "+(r.status==="created"?"CUENTA CREADA":r.status)+(r.error?" ("+r.error+")":"")+
   (r.temporary_password?"\nCONTRASEÑA TEMPORAL: "+r.temporary_password+"\nEnvíala de forma privada. El rider debe cambiarla al entrar.":"")
  );
  if(result.already_created?.length)lines.push("Cuentas ya aprovisionadas: "+result.already_created.join(", "));
  if(!lines.length)lines.push("No hay cuentas pendientes de crear.");
  if((result.results||[]).some(r=>r.temporary_password))lines.unshift("IMPORTANTE: guarda ahora las contraseñas en un gestor seguro. No podrás volver a verlas.");
  el("inviteResult").textContent=lines.join("\n");
  el("inviteResult").hidden=false;
 }catch(e){el("inviteResult").textContent="No se pudieron crear las cuentas: "+(e.message||String(e))+
  ". Revisa el estado del proyecto y los permisos del administrador en Supabase.";el("inviteResult").hidden=false;}
 finally{busy=false;el("sendInvitations").disabled=false;}
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
 el("editAddress").value=o.destination||"";
 el("editNotes").value=o.notes||"";
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
  const item={customer_name:el("editCustomer").value.trim(),
   customer_phone:el("editPhone").value.trim()||null,
   destination:el("editAddress").value.trim(),notes:el("editNotes").value.trim(),payment_method:el("editPayment").value||null,amount};
  const path="/rest/v1/ed_orders?id=eq."+encodeURIComponent(id)+"&account_id=eq."+encodeURIComponent(member.account_id);
  const rows=await query(path,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(item)});
  if(!rows?.length)throw Error("No se pudo actualizar el pedido");
  el("editCard").hidden=true;
 });
});
el("refresh").addEventListener("click",()=>void operation(async()=>{}));
el("createForm").addEventListener("submit",e=>{
 e.preventDefault();void operation(async()=>{
  const phone=el("newPhone").value.trim();
  const amount=Number(el("newAmount").value||"0");
  if(!Number.isFinite(amount)||amount<0||amount>999999)throw Error("Importe no válido");
  const item={account_id:member.account_id,reference:el("newReference").value.trim(),channel:"test",
    customer_name:el("newCustomer").value.trim(),customer_phone:phone||null,
    destination:el("newAddress").value.trim(),notes:el("newNotes").value.trim(),
    amount,payment_method:el("newPayment").value,status:"pendiente"};
  await query("/rest/v1/ed_orders",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify(item)});
  el("createForm").reset();
 });
});
document.addEventListener("change",e=>{
 const sel=e.target;if(!sel.dataset.assign)return;
 const o=orders.find(x=>x.id===sel.dataset.assign);if(!o)return;
 void operation(async()=>{
  const rid=sel.value||null,params="?id=eq."+encodeURIComponent(o.id)+"&account_id=eq."+encodeURIComponent(member.account_id);
  await query("/rest/v1/ed_orders"+params,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({rider_id:rid,status:rid?"asignado":"pendiente"})});
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