import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const live=read("live.html"),rider=read("rider.html"),track=read("track.html"),ops=read("docs/live.js"),rjs=read("docs/rider.js"),map=read("docs/visual-ops-map-v5.js");
test("V5 modifies real production pages and shared branded identity",()=>{
 for(const [page,css] of [[live,"visual-backoffice-v5.css"],[rider,"visual-rider-v5.css"],[track,"visual-client-v5.css"]]){
  assert.match(page,/class="ed-visual-v5"/);assert.ok(page.includes(css));
  assert.match(page,/docs\/icon.svg\?v=5/);
 }
 assert.match(read("docs/icon.svg"),/moto con kebab/);
 assert.match(read("docs/visual-burgos-rider.svg"),/Burgos de noche/);
});
test("PWA uses the new motorcycle icon and updated app shell",()=>{
 assert.match(read("rider.webmanifest"),/docs\/icon.svg\?v=5/);
 assert.match(read("rider-sw.js"),/estambul-rider-shell-v27/);
 assert.match(read("rider-sw.js"),/visual-rider-v5.css/);
});
test("Operations map is driven by real authenticated rider GPS not invented positions",()=>{
 assert.match(live,/id="opsLiveMapPanel"/);
 assert.match(live,/id="opsEnableLiveMap"/);
 assert.match(ops,/window\.ESTAMBUL_VISUAL_MAP\?\.update\(active,riders\)/);
 assert.match(map,/age<=45000/);
 assert.match(map,/positions\.filter\(readyPos\)/);
 assert.match(map,/No hay ningún Rider compartiendo una ubicación GPS reciente/);
 assert.doesNotMatch(map,/Math\.random\(/);
});
test("GPS map only calls third-party tiles after explicit admin click",()=>{
 const click=map.indexOf('button.addEventListener("click",async');
 const load=map.indexOf('await fetchLibrary()',click);
 assert.ok(click>0&&load>click);
 assert.match(map,/title\.textContent=p\.label/);
 assert.match(map,/OpenStreetMap/);
});
test("Manual LastPOS assignment and payment confirmations are preserved",()=>{
 assert.match(ops,/o\.channel!=="test"/);
 assert.match(ops,/Asignación manual desde LastPOS/);
 assert.match(rjs,/rider_id=eq\." \+ encodeURIComponent\(rider\.id\)/);
 assert.match(rjs,/const paymentDrafts=new Map\(\)/);
});
test("No new SMS and pizzas/drinks checkboxes remain optional",()=>{
 assert.doesNotMatch(map,/Twilio|Messages\.json|ed-send-notifications/);
 assert.match(rjs,/No status-change SMS/);
 assert.match(rider,/ESTAMBUL_RIDER_ITEMS_ENABLED=true/);
});
test("Visual styles keep hidden login-gated screens hidden",()=>{
 for(const p of ["docs/visual-backoffice-v5.css","docs/visual-rider-v5.css","docs/visual-client-v5.css"]){
  assert.match(read(p),/\[hidden\]\{display:none!important\}/);
  assert.match(read(p),/@media\(max-width:/);
 }
 assert.match(live,/id="appSection" hidden/);
 assert.match(rider,/id="dashboard" hidden/);
 assert.match(track,/id="orderContent" hidden/);
});
test("Customer page still shows only verified ETA and private live map",()=>{
 assert.match(track,/Un enlace, todo el seguimiento/);
 assert.match(read("docs/track.js"),/No mostramos un tiempo inventado/);
 assert.match(track,/id="liveMapPanel"[^>]*hidden/);
 assert.match(track,/noindex,nofollow,noarchive/);
});
