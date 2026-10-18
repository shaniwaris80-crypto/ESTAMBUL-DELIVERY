import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
function make(){
 const window={};
 vm.runInNewContext(read("docs/rider-items.js"),{window,Date,encodeURIComponent});
 return window.ESTAMBUL_ORDER_ITEMS;
}
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const order={id:"demo1",status:"recogido"};
const snapshot=(revision="abc")=>({order_id:"demo1",revision,items:[
 {name:"Pizza barbacoa",quantity:2,modifiers:[{name:"Extra queso",quantity:1}],comments:"Sin cebolla"},
 {name:"Coca-Cola 2L",quantity:1},
 {name:"Patatas fritas",quantity:1},
 {name:"Kebab mixto",quantity:1}
]});
const checkboxCount=s=>(s.match(/type="checkbox"/g)||[]).length;

test("Last root products take precedence over bills (no double-count)",()=>{
 const r=make().fromLastTab({products:[{name:"Pizza",quantity:2}],bills:[{products:[{name:"Pizza",quantity:2}]}]});
 assert.equal(r.items.length,1);assert.equal(r.source,"products");
});
test("fallback to nondeleted bills when root items empty",()=>{
 const r=make().fromLastTab({products:[],bills:[{products:[{name:"Pizza margarita",quantity:1}]},{deleted:true,products:[{name:"Should not ship",quantity:5}]}]});
 assert.equal(r.source,"bills");assert.equal(r.items.length,1);assert.equal(r.items[0].name,"Pizza margarita");
});
test("invalid names and quantities rejected and extra PII discarded",()=>{
 const items=make().normalizeItems([{name:"",quantity:1},{name:"Pizza",quantity:0},{name:"Pizza",quantity:1,customer_phone:"DO NOT EXPOSE"},{name:"Drink",quantity:9999}]);
 assert.equal(items.length,1);assert.equal(items[0].customer_phone,undefined);
});
test("combo contents, modifiers and kitchen notes preserved",()=>{
 const r=make().fromLastTab({products:[{name:"Combo pizza",quantity:1,comments:"Sin picante",modifiers:[{name:"Extra queso",quantity:1}],comboProducts:[{name:"Patatas",quantity:1}]}]});
 assert.equal(r.items[0].modifiers[0].name,"Extra queso");
 assert.equal(r.items[0].children[0].name,"Patatas");
 assert.equal(r.items[0].comments,"Sin picante");
});
test("optional product categories include pizzas, drinks and combos containing them",()=>{
 const cat=make().optionalCategory;
 assert.equal(cat({name:"Pizza 4 quesos"}),"pizza");
 assert.equal(cat({name:"2 PIZZAS GRANDES"}),"pizza");
 assert.equal(cat({name:"Fanta naranja"}),"bebida");
 assert.equal(cat({name:"Coca Cola 2 litros"}),"bebida");
 assert.equal(cat({name:"Agua mineral"}),"bebida");
 assert.equal(cat({name:"Aquarius limón"}),"bebida");
 assert.equal(cat({name:"Menú",children:[{name:"Pizza familiar"}]}),"pizza");
 assert.equal(cat({name:"Menú",children:[{name:"Coca-Cola"}]}),"bebida");
 assert.equal(cat({name:"Kebab mixto"}),null);
 assert.equal(cat({name:"Patatas grandes"}),null);
 assert.equal(cat({name:"Salsa blanca"}),null);
});
test("only pizza and drink rows have checkboxes; other articles visible without checks",async()=>{
 const ctl=make().createController(esc,true);
 await ctl.load([order],async()=>[snapshot()],()=>{});
 const html=ctl.render(order);
 assert.equal(checkboxCount(html),2);
 assert.match(html,/Pizza barbacoa/);
 assert.match(html,/Coca-Cola 2L/);
 assert.match(html,/Patatas fritas/);
 assert.match(html,/Kebab mixto/);
 assert.match(html,/REVISIÓN OPCIONAL/);
 assert.match(html,/Puedes continuar el reparto sin marcar/);
 assert.match(html,/2 pizzas\/bebidas marcadas \(opcional\)|0 de 2 pizzas\/bebidas marcadas \(opcional\)/);
});
test("pizza and drink marks are independent, editable and not required",async()=>{
 const ctl=make().createController(esc,true);
 await ctl.load([order],async()=>[snapshot()],()=>{});
 let html=ctl.render(order);
 assert.match(html,/0 de 2 pizzas\/bebidas marcadas/);
 ctl.onChange({target:{matches:q=>q.includes("data-pack-id"),dataset:{packId:"demo1",packRev:"abc",packIndex:"0"},checked:true,closest:()=>null}});
 html=ctl.render(order);
 assert.match(html,/1 de 2 pizzas\/bebidas marcadas/);
 assert.equal(checkboxCount(html),2);
 ctl.onChange({target:{matches:q=>q.includes("data-pack-id"),dataset:{packId:"demo1",packRev:"abc",packIndex:"0"},checked:false,closest:()=>null}});
 assert.match(ctl.render(order),/0 de 2 pizzas\/bebidas marcadas/);
});
test("checks on other article types are rejected even if forged",async()=>{
 const ctl=make().createController(esc,true);
 await ctl.load([order],async()=>[snapshot()],()=>{});
 ctl.onChange({target:{matches:q=>q.includes("data-pack-id"),dataset:{packId:"demo1",packRev:"abc",packIndex:"2"},checked:true,closest:()=>null}});
 assert.match(ctl.render(order),/0 de 2 pizzas\/bebidas marcadas/);
});
test("modified order revision never reuses previously ticked items",()=>{
 const engine=make().newChecklist();
 engine.set("demo1","old",0,true);
 assert.equal(engine.selected("demo1","new",0),false);
});
test("missing list shows guidance but never asks for manual checkbox",()=>{
 const ctl=make().createController(esc,true);
 const html=ctl.render(order);
 assert.match(html,/ticket/);
 assert.match(html,/no es obligatorio marcar nada/);
 assert.equal(checkboxCount(html),0);
});
test("no pizza or beverage keeps only plain article list",async()=>{
 const ctl=make().createController(esc,true);
 await ctl.load([order],async()=>[{order_id:"demo1",revision:"x",items:[{name:"Patatas",quantity:1},{name:"Kebab",quantity:2}]}],()=>{});
 const html=ctl.render(order);
 assert.equal(checkboxCount(html),0);
 assert.match(html,/Sin casillas/);
});
test("disabled flag makes no network requests and renders no packing module",async()=>{
 const ctl=make().createController(esc,false);let called=false;
 await ctl.load([order],async()=>{called=true},()=>{});
 assert.equal(called,false);assert.equal(ctl.render(order),"");
});
test("untrusted product names are escaped in browser UI",async()=>{
 const ctl=make().createController(esc,true);
 await ctl.load([order],async()=>[{order_id:"demo1",revision:"x",items:[{name:'<img src=x onerror=alert(1)>',quantity:1}]}],()=>{});
 const html=ctl.render(order);
 assert.ok(html.includes("&lt;img"));assert.ok(!html.includes("<img"));
});
test("pickup, route and delivery are not gated by optional packing in PWA",()=>{
 const js=read("docs/rider.js");
 assert.doesNotMatch(js,/itemController\.mayStartRoute\(/);
 assert.doesNotMatch(js,/Comprueba cada artículo.*antes de empezar el reparto/);
 assert.match(js,/allowedNext\[order\.status\] !== status/);
 assert.match(js,/payment_method:confirmedPayment/);
});
test("native Rider only offers pizza and beverage marks without gate",()=>{
 const native=read("apps/rider/app/connected.tsx");
 assert.match(native,/function optionalPackingCategory/);
 assert.match(native,/disabled=\{!optional\}/);
 assert.match(native,/onPress=\{\(\)=>onAdvance\(status\)\}/);
 assert.doesNotMatch(native,/checkAndAdvance\(/);
 assert.doesNotMatch(native,/!ready/);
 assert.match(native,/No hace falta marcar nada para continuar/);
});
test("order details feature still OFF by default until staging verified",()=>{
 const js=read("docs/rider.js"),native=read("apps/rider/lib/connected.ts"),worker=read("supabase/functions/ed-last-auto-sync/index.ts");
 assert.match(js,/window\.ESTAMBUL_RIDER_ITEMS_ENABLED===true/);
 assert.match(native,/EXPO_PUBLIC_RIDER_ITEMS_ENABLED==="true"/);
 assert.match(worker,/ED_RIDER_ITEMS_INGEST_ENABLED"\)==="true"/);
 assert.match(worker,/Order item snapshot unavailable; original Last\.app order was preserved/);
});
test("proposed snapshot RLS restricts orders to assigned Rider and readonly API",()=>{
 const sql=read("docs/staging/order-item-snapshots-review.sql");
 assert.match(sql,/enable row level security/);
 assert.match(sql,/o\.rider_id is not null and \(select private\.ed_is_rider/);
 assert.match(sql,/grant select on public\.ed_order_item_snapshots to authenticated/);
 assert.doesNotMatch(sql,/grant (insert|update|delete|all) on public\.ed_order_item_snapshots to authenticated/i);
 assert.match(sql,/STAGING REVIEW ONLY/);
});
test("existing Rider interface and delivery actions remain intact",()=>{
 const html=read("rider.html"),js=read("docs/rider.js");
 assert.ok(html.indexOf("docs/rider-items.js")<html.indexOf("docs/rider.js?v="));
 assert.match(js,/data-next="entregado"/);
 assert.match(js,/payment_method:confirmedPayment/);
});
