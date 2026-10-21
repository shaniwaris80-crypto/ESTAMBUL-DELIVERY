/* Estambul Delivery: approved navy/emerald operational workspace.
   Visual composition only. Moves EXISTING DOM nodes; business logic,
   authentication, tracking and Last.app remain in live.js/Supabase. */
(function(){
 "use strict";
 function setup(){
  const staff=document.getElementById("staffView");
  if(!staff||staff.dataset.edReady==="yes")return;
  staff.dataset.edReady="yes";
  staff.classList.add("ed-dashboard");
  const el=(tag,cls,html)=>{
   const node=document.createElement(tag);node.className=cls;
   if(html)node.innerHTML=html;return node;
  };
  const frame=el("div","ed-desktop");
  const sidebar=el("aside","ed-sidebar",
   '<div class="ed-logo">ESTAMBUL <strong>DELIVERY</strong></div>'+
   '<nav class="ed-menu" aria-label="Secciones del Back Office">'+
   '<button type="button" data-ed-screen="operations" aria-current="page">▣ <span>Operaciones</span></button>'+
   '<button type="button" data-ed-screen="riders">♧ <span>Repartidores</span></button>'+
   '<button type="button" data-ed-screen="cash">▤ <span>Caja</span></button>'+
   '<button type="button" data-ed-screen="settings">⚙ <span>Ajustes</span></button>'+
   '</nav><div class="ed-sidebar-foot">● <span id="edService">Comprobando conexión</span>'+
   '<small>Los riders se asignan en LastPOS</small></div>');
  const area=el("div","ed-workspace");
  const toolbar=el("div","ed-toolbar",
    '<div class="ed-toolbar-title"><span>ESTAMBUL DELIVERY</span><strong id="edTitle">Operaciones</strong></div>'+
    '<span id="edLastHealth" class="ed-last-health" role="status" aria-live="polite">Last.app · comprobando integración</span>'+
    '<div class="ed-kpis" aria-label="Estado actual">'+
    '<div><b id="edWaiting">—</b><small>Sin rider</small></div>'+
    '<div><b id="edRoute">—</b><small>En reparto</small></div>'+
    '<div><b id="edRiders">—</b><small>Riders</small></div></div>'+
    '<button class="ed-refresh" id="edRefresh" type="button" title="Actualizar">↻ <span>Actualizar</span></button>');
  area.append(toolbar);
  const screens={};
  for(const [key,title] of [["operations","Operaciones"],["riders","Repartidores"],["cash","Caja"],["settings","Ajustes"]]){
   const page=el("section","ed-screen ed-"+key);
   page.id="ed-screen-"+key;page.setAttribute("aria-label",title);
   if(key!=="operations")page.hidden=true;
   screens[key]=page;area.append(page);
  }
  const top=el("div","ed-main-grid");
  screens.operations.append(top);
  const map=document.getElementById("opsLiveMapPanel");
  const queue=document.getElementById("opsSpotlight");
  if(map)top.append(map);
  if(queue)top.append(queue);
  const fleet=el("div","ed-fleet",'');
  const fleetHeading=el("div","ed-fleet-heading","<strong>Repartidores (5)</strong><span>Ver la flota y su actividad</span>");
  const cards=el("div","ed-fleet-cards");
  for(let i=1;i<=5;i++){
   const btn=el("button","ed-fleet-rider");
   btn.type="button";
   btn.dataset.rider=String(i);
   const label="Rider "+String(i).padStart(2,"0");
   const symbol=el("span","ed-fleet-icon","◉");
   const title=el("strong","",label);
   const text=el("small","","Ver en Repartidores");
   btn.append(symbol,title,text);
   btn.addEventListener("click",()=>activate("riders"));
   cards.append(btn);
  }
  fleet.append(fleetHeading,cards);
  screens.operations.append(fleet);
  const groups={
    operations:["ordersArea"],
    riders:["riderDirectory","gpsAdminCard","inviteCard"],
    cash:["shiftHistoryCard","feedbackAdmin"],
    settings:["notifyAdminCard","brandCard","operationsResetCard","createCard","editCard"]
  };
  for(const [key,ids] of Object.entries(groups))for(const id of ids){
   const section=document.getElementById(id);
   if(section)screens[key].append(section);
  }
  sidebar.querySelectorAll("[data-ed-screen]").forEach(btn=>btn.addEventListener("click",()=>activate(btn.dataset.edScreen)));
  document.getElementById("edRefresh").addEventListener("click",()=>document.getElementById("refresh")?.click());
  frame.append(sidebar,area);
  staff.prepend(frame);
  function activate(key){
    if(!screens[key])return;
    for(const [id,node] of Object.entries(screens))node.hidden=id!==key;
    sidebar.querySelectorAll("[data-ed-screen]").forEach(btn=>{
      const selected=btn.dataset.edScreen===key;
      btn.classList.toggle("is-active",selected);
      if(selected)btn.setAttribute("aria-current","page");else btn.removeAttribute("aria-current");
    });
    document.getElementById("edTitle").textContent=key==="cash"?"Caja y arqueos":key==="settings"?"Configuración":key==="riders"?"Repartidores":"Operaciones";
    staff.dataset.edScreen=key;
    window.scrollTo({top:0,behavior:"instant"});
  }
  activate("operations");
  if(window.ESTAMBUL_PARITY_PREVIEW){
    const chip=document.getElementById("edLastHealth");
    if(chip)chip.textContent="Last.app · DEMO sin conexión";
  }
  function update(){
   const waiting=document.getElementById("opsUnassignedCount")?.textContent?.trim()||"—";
   const route=document.getElementById("opsRouteCount")?.textContent?.trim()||"—";
   const count=document.getElementById("riderCount")?.textContent?.trim()||"";
   document.getElementById("edWaiting").textContent=waiting;
   document.getElementById("edRoute").textContent=route;
   // This is a configured profile capacity, not a claim of five logged-in people.
   document.getElementById("edRiders").textContent=(count.match(/^(\d+)\s+de\s+5\s+listos/)?.[1]||"0")+"/5";
   document.getElementById("edRiders").title=count||"5 perfiles disponibles; cuentas aún sin activar";
   const connection=document.getElementById("connection");
   const status=connection?.textContent?.trim()||"Sin configurar";
   // Show verified identity state; never invent rider online status.
   for(const btn of cards.querySelectorAll("[data-rider]")){
     const n=Number(btn.dataset.rider);
     const slot=[...document.querySelectorAll("#riderCapacity .rider-slot")].find(row=>Number(row.querySelector(".rider-slot-number")?.textContent)===n);
     const subtitle=btn.querySelector("small");
     if(subtitle)subtitle.textContent=slot?.classList.contains("ready")
       ? (slot.textContent?.includes("Online")?"● Online":"● Cuenta activa")
       : "○ Cuenta pendiente";
   }
   const service=document.getElementById("edService");
   service.textContent=status;
   service.parentElement.classList.toggle("ed-online",/conectad|online|activo/i.test(status)&&!/desconectad/i.test(status));
  }
  // DOM changes here reflect the actual connected application; never invent orders or GPS.
  let pending=false;
  const observer=new MutationObserver(()=>{
   if(pending)return;
   pending=true;
   requestAnimationFrame(()=>{pending=false;update()});
  });
  for(const id of ["opsUnassignedCount","opsRouteCount","riderCount","connection"])
   if(document.getElementById(id))observer.observe(document.getElementById(id),{subtree:true,childList:true,characterData:true});
  update();
  const edit=document.getElementById("editCard");
  if(edit)new MutationObserver(()=>{if(!edit.hidden)activate("settings")}).observe(edit,{attributes:true,attributeFilter:["hidden"]});
  // Keep historic anchors into the real orders detail, regardless of current tab.
  window.addEventListener("hashchange",()=>{
   const hash=location.hash;
   if(["#riderDirectory","#gpsAdminCard","#inviteCard"].includes(hash))activate("riders");
   else if(["#shiftHistoryCard","#feedbackAdmin"].includes(hash))activate("cash");
   else if(["#brandCard","#notifyAdminCard","#operationsResetCard","#createCard"].includes(hash))activate("settings");
   else if(["#ordersArea","#opsLiveMapPanel","#opsSpotlight"].includes(hash))activate("operations");
  });
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup,{once:true});else setup();
})();