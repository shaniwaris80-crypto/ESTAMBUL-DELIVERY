/* Rider navigation shell: presentation only, existing rider.js owns every order action. */
(function(){
 "use strict";
 function boot(){
  const dashboard=document.getElementById("dashboard");
  if(!dashboard||dashboard.dataset.edReady)return;
  dashboard.dataset.edReady="yes";
  dashboard.dataset.edView="deliveries";
  const nav=document.createElement("nav");
  nav.id="edRiderNav";nav.className="ed-rider-tabs";
  nav.setAttribute("aria-label","Rider navigation");
  const tabs=[
   ["deliveries","▤","Deliveries"],["wallet","▣","Wallet"],["account","♙","Account"]
  ];
  const choose=(name)=>{
   if(!tabs.some(t=>t[0]===name))return;
   dashboard.dataset.edView=name;
   nav.querySelectorAll("button").forEach(button=>{
    const on=button.dataset.tab===name;
    button.classList.toggle("active",on);
    button.setAttribute("aria-current",on?"page":"false");
   });
   const title=document.getElementById("edRiderScreenTitle");
   if(title)title.textContent=tabs.find(t=>t[0]===name)[2];
   window.scrollTo({top:0,behavior:"instant"});
  };
  const title=document.createElement("div");
  title.className="ed-rider-screen-heading";
  title.innerHTML='<span>ESTAMBUL <b>DELIVERY</b></span><strong id="edRiderScreenTitle">Deliveries</strong>';
  dashboard.prepend(title);
  for(const [id,symbol,name] of tabs){
   const btn=document.createElement("button");
   btn.type="button";btn.dataset.tab=id;
   const glyph=document.createElement("span");glyph.className="ed-rider-tab-icon";glyph.textContent=symbol;
   const label=document.createElement("span");label.textContent=name;
   btn.append(glyph,label);
   btn.addEventListener("click",()=>choose(id));
   nav.append(btn);
  }
  dashboard.append(nav);
  choose("deliveries");
  // Existing buttons sometimes scroll to hidden sections; selecting the
  // relevant screen first makes each existing action visible again.
  const old=document.querySelector(".v2-rider-nav");
  if(old)old.addEventListener("click",event=>{
   const link=event.target.closest("a[href]");
   if(!link)return;
   const href=link.getAttribute("href");
   choose(href==="#dayCloseSection"||href==="#historyTitle"?"wallet":
     href==="#gpsSection"?"account":"deliveries");
  });
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();