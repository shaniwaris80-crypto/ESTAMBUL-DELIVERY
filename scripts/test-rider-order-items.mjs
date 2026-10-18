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
 {name:"Refresco",quantity:1,children:[{name:"2L",quantity:1}]}
]});
test("Last root products take precedence over bills, to avoid double-counting",()=>{
 const m=make();const r=m.fromLastTab({products:[{name:"Pizza",quantity:2}],bills:[{products:[{name:"Pizza",quantity:2}]}]});
 assert.equal(r.items.length,1);assert.equal(r.source,"products");
});
test("fallback to nondeleted bills when root products are empty",()=>{
 const r=make().fromLastTab({products:[],bills:[{products:[{name:"Pizza margarita",quantity:1}]} ,{deleted:true,products:[{name:"Should not ship",quantity:5}]}]});
 assert.equal(r.source,"bills");assert.equal(r.items.length,1);assert.equal(r.items[0].name,"Pizza margarita");
});
test("invalid names, zero quantities and untrusted extras are rejected",()=>{
 const items=make().normalizeItems([{name:"",quantity:1},{name:"Pizza",quantity:0},{name:"Pizza",quantity:1,customer_phone:"DO NOT EXPOSE"},{name:"Drink",quantity:9999}]);
 assert.equal(items.length,1);assert.equal(items[0].customer_phone,undefined);
});
test("combo components, modifiers and notes are preserved",()=>{
 const r=make().fromLastTab({products:[{name:"Combo pizza",quantity:1,comments:"Sin picante",modifiers:[{name:"Extra queso",quantity:1}],comboProducts:[{name:"Patatas",quantity:1}]}]});
 assert.equal(r.items[0].modifiers[0].name,"Extra queso");
 assert.equal(r.items[0].children[0].name,"Patatas");
 assert.equal(r.items[0].comments,"Sin picante");
});
test("no product list is visibly unavailable, never fabricated or assumed packed",()=>{
 const r=make().fromLastTab({products:[],bills:[]});
 assert.equal(r.available,false);assert.deepEqual(Array.from(r.items),[]);
});
test("route remains blocked until ALL lines are independently confirmed",async()=>{
 const controller=make().createController(esc,true);
 await controller.load([order],async()=>[snapshot()],()=>{});
 assert.equal(controller.mayStartRoute(order).ok,false);
 assert.match(controller.render(order),/Pizza barbacoa/);
 controller.onChange({target:{matches:q=>q.includes("data-pack-id"),dataset:{packId:"demo1",packRev:"abc",packIndex:"0"},checked:true,closest:()=>null}});
 assert.equal(controller.mayStartRoute(order).ok,false);
 controller.onChange({target:{matches:q=>q.includes("data-pack-id"),dataset:{packId:"demo1",packRev:"abc",packIndex:"1"},checked:true,closest:()=>null}});
 assert.equal(controller.mayStartRoute(order).ok,true);
});
test("new order revision invalidates old checklist confirmations",async()=>{
 const ctl=make().createController(esc,true);
 await ctl.load([order],async()=>[snapshot("first")],()=>{});
 for(let i=0;i<2;i++)ctl.onChange({target:{matches:q=>q.includes("data-pack-id"),dataset:{packId:"demo1",packRev:"first",packIndex:String(i)},checked:true,closest:()=>null}});
 assert.equal(ctl.mayStartRoute(order).ok,true);
 // A route check must never treat a newly modified order as confirmed.
 const engine=make().newChecklist();
 engine.set("demo1","old",0,true);
 assert.equal(engine.verified("demo1",{revision:"new",items:[{name:"New Pizza",quantity:1}]}),false);
});
test("without a reliable list, manual ticket verification is required",()=>{
 const ctl=make().createController(esc,true);
 assert.equal(ctl.mayStartRoute(order).ok,false);
 assert.match(ctl.render(order),/ticket/);
 ctl.onChange({target:{matches:q=>q.includes("data-pack-manual"),dataset:{packManual:"demo1"},checked:true}});
 assert.equal(ctl.mayStartRoute(order).ok,true);
});
test("disabled switch neither requests network nor changes route transitions",async()=>{
 const ctl=make().createController(esc,false);let called=false;
 await ctl.load([order],async()=>{called=true},()=>{});
 assert.equal(called,false);assert.equal(ctl.render(order),"");assert.equal(ctl.mayStartRoute(order).ok,true);
});
test("untrusted product names are HTML escaped",async()=>{
 const ctl=make().createController(esc,true);
 await ctl.load([order],async()=>[{order_id:"demo1",revision:"x",items:[{name:'<img src=x onerror=alert(1)>',quantity:1}]}],()=>{});
 const html=ctl.render(order);
 assert.ok(html.includes("&lt;img"));assert.ok(!html.includes("<img"));
});
test("feature is explicitly OFF by default on web, mobile and Last worker",()=>{
 const js=read("docs/rider.js"),native=read("apps/rider/lib/connected.ts"),worker=read("supabase/functions/ed-last-auto-sync/index.ts");
 assert.match(js,/window\.ESTAMBUL_RIDER_ITEMS_ENABLED===true/);
 assert.match(native,/EXPO_PUBLIC_RIDER_ITEMS_ENABLED==="true"/);
 assert.match(worker,/ED_RIDER_ITEMS_INGEST_ENABLED"\)==="true"/);
 assert.match(worker,/Order item snapshot unavailable; original Last\.app order was preserved/);
});
test("feature does not leak cross-rider order items or expose public insert",()=>{
 const sql=read("docs/staging/order-item-snapshots-review.sql");
 assert.match(sql,/enable row level security/);
 assert.match(sql,/o\.rider_id is not null and \(select private\.ed_is_rider/);
 assert.match(sql,/grant select on public\.ed_order_item_snapshots to authenticated/);
 assert.doesNotMatch(sql,/grant (insert|update|delete|all) on public\.ed_order_item_snapshots to authenticated/i);
 assert.match(sql,/STAGING REVIEW ONLY/);
});
test("Rider page loads module before handlers, existing pay/dispatch preserved",()=>{
 const html=read("rider.html"),js=read("docs/rider.js");
 assert.ok(html.indexOf('docs/rider-items.js')<html.indexOf('docs/rider.js?v='));
 assert.match(js,/itemController\.mayStartRoute\(order\)/);
 assert.match(js,/payment_method:confirmedPayment/);
 assert.match(js,/data-next="entregado"/);
});
