/* Estambul Operations · real GPS map (no simulated rider positions).
   Map tiles load only after manager clicks to consent to OSM requests. */
(()=>{
 "use strict";
 const panel=document.getElementById("opsLiveMapPanel");
 const button=document.getElementById("opsEnableLiveMap");
 if(!panel||!button)return;
 const fresh=document.getElementById("opsMapFresh");
 const status=document.getElementById("opsMapStatus");
 const updated=document.getElementById("opsMapLastUpdate");
 const placeholder=document.getElementById("opsMapPlaceholder");
 const target=document.getElementById("opsLeafletMap");
 let positions=[],enabled=false,loading=false,map=null,markers=null;
 const readyPos=p=>{
  const lat=Number(p.latitude),lng=Number(p.longitude),age=Date.now()-Date.parse(p.updated_at);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180&&Number.isFinite(age)&&age>=0&&age<=45000;
 };
 function repaint(){
  const live=positions.filter(readyPos);
  fresh.textContent=live.length?"● "+live.length+" Rider"+(live.length===1?"":"s")+" con GPS reciente":"● Sin GPS reciente";
  status.textContent=live.length
   ?live.length+" ubicación"+(live.length===1?"":"es")+" verificada"+(live.length===1?"":"s")+" en los últimos 45 segundos."
   :"No hay ningún Rider compartiendo una ubicación GPS reciente. No mostramos marcadores ficticios.";
  updated.textContent="Actualizado a las "+new Date().toLocaleTimeString("es-ES");
  if(!map||!markers||!window.L)return;
  markers.clearLayers();
  const bounds=[];
  for(const p of live){
   const lat=Number(p.latitude),lng=Number(p.longitude);
   const icon=window.L.divIcon({className:"ed-map-marker",html:"<span>🛵</span>",iconSize:[48,48],iconAnchor:[24,24]});
   const marker=window.L.marker([lat,lng],{icon,title:p.label||"Rider"}).addTo(markers);
   const popup=document.createElement("div"),title=document.createElement("strong"),time=document.createElement("small");
   title.textContent=p.label||"Rider";
   time.textContent=" · GPS "+new Date(p.updated_at).toLocaleTimeString("es-ES");
   popup.append(title,time);
   marker.bindPopup(popup);
   bounds.push([lat,lng]);
  }
  if(bounds.length===1)map.setView(bounds[0],14);
  else if(bounds.length>1)map.fitBounds(bounds,{padding:[25,25],maxZoom:14});
 }
 function fetchLibrary(){
  return new Promise((resolve,reject)=>{
   if(window.L){resolve();return;}
   const stylesheet=document.createElement("link");
   stylesheet.rel="stylesheet";stylesheet.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
   stylesheet.integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoT4xyu4uDLo=";
   stylesheet.crossOrigin="anonymous";
   document.head.append(stylesheet);
   const script=document.createElement("script");
   script.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
   script.integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
   script.crossOrigin="anonymous";
   script.onload=()=>window.L?resolve():reject(Error("Mapa no disponible"));
   script.onerror=()=>reject(Error("No se pudo cargar la librería del mapa"));
   document.head.append(script);
  });
 }
 button.addEventListener("click",async()=>{
  if(loading||enabled)return;
  loading=true;button.disabled=true;button.textContent="Cargando mapa…";
  try{
   await fetchLibrary();
   map=window.L.map(target,{zoomControl:true,attributionControl:true}).setView([42.344,-3.6969],12);
   window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,attribution:'&copy; OpenStreetMap contributors'
   }).addTo(map);
   markers=window.L.layerGroup().addTo(map);
   enabled=true;
   placeholder.hidden=true;target.hidden=false;repaint();
   window.setTimeout(()=>map.invalidateSize(),50);
  }catch(e){
   status.textContent=e.message+". Consulta las ubicaciones individuales de Rider en la sección GPS.";
   button.disabled=false;button.textContent="Reintentar mapa";
  }finally{loading=false;}
 });
 window.ESTAMBUL_VISUAL_MAP={
  update(active,riders){
   const names=new Map((Array.isArray(riders)?riders:[]).map(r=>[r.id,r.display_name]));
   positions=(Array.isArray(active)?active:[]).filter(readyPos).map(p=>({
    latitude:p.latitude,longitude:p.longitude,updated_at:p.updated_at,
    label:String(names.get(p.rider_id)||"Rider")
   }));
   repaint();
  }
 };
})();
