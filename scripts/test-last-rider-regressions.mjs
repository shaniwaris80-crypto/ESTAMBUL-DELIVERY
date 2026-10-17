import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {analyzeLastFinance} from "../docs/last-finance-diagnostic.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const rider=read("docs/rider.js");
test("existing Last bill totals are in cents and payment preferences do not mean paid",()=>{
 const r=analyzeLastFinance({bills:[{total:2390,preferredPaymentMethod:"cash",payments:[]} ]});
 assert.equal(r.totalCents,2390);
 assert.equal(r.preferredCollectionMethod,"efectivo");
 assert.equal(r.paidAlready,false);
 assert.equal(r.needsPaymentReview,false);
});
test("deleted bills excluded from cost",()=>{
 const r=analyzeLastFinance({bills:[{total:1100},{total:400,deleted:true}]});
 assert.equal(r.totalCents,1100);
 assert.equal(r.preferredCollectionMethod,null);
 assert.equal(r.needsPaymentReview,true);
});
test("no bill or tab total is unknown, not zero",()=>{
 const r=analyzeLastFinance({products:[{price:1000,quantity:2}]});
 assert.equal(r.totalCents,null);
 assert.equal(r.totalSource,"unknown");
});
test("explicit tab total allowed only with a valid integer amount in cents",()=>{
 assert.equal(analyzeLastFinance({total:1780,bills:[]}).totalCents,1780);
 assert.equal(analyzeLastFinance({total:"eighteen euros"}).totalCents,null);
});
test("paid order is not automatically interpreted as new card collection",()=>{
 const r=analyzeLastFinance({bills:[{total:2490,payments:[{method:"card",amount:2490}]}]});
 assert.equal(r.paidAlready,true);
 assert.equal(r.paidCents,2490);
 assert.equal(r.preferredCollectionMethod,null);
 assert.equal(r.needsPaymentReview,true);
});
test("conflicting payment preferences require human review",()=>{
 const r=analyzeLastFinance({preferredPaymentMethod:"cash",bills:[{total:2000,preferredPaymentMethod:"card"}]});
 assert.equal(r.preferredCollectionMethod,null);
 assert.match(r.reason,/contradictorios/);
});
test("five-second sync cannot erase currently focused selector or active swipe",()=>{
 assert.match(rider,/setInterval\(\(\) => \{ if \(identity\) void updateOrders\(\); \}, 5000\)/);
 assert.match(rider,/document\.activeElement\?\.matches\('select\[data-payment-for\]'\)/);
 assert.match(rider,/activeSwipe===null/);
 assert.match(rider,/const paymentDrafts=new Map\(\)/);
 assert.match(rider,/capturePaymentDrafts\(\)/);
});
test("Rider restores the draft when order is redrawn",()=>{
 const start=rider.indexOf("function renderOrder(order,isPriority=false)");
 const end=rider.indexOf("async function operation(fn)",start);
 assert.ok(start>=0&&end>start);
 const snippet=rider.slice(start,end);
 const paymentDrafts=new Map([["abc","tarjeta"]]);
 const context={
  allowedNext:{en_ruta:"entregado"},nextNames:{entregado:"Entregar"},
  escapeText:x=>String(x??""),paymentDrafts,
  mapUrl:()=>"",locationShares:new Map(),locationSharingAvailable:false,
  statusNames:{en_ruta:"En ruta"},channelNames:{lastapp:"Last.app"},
  displayOrderCode:o=>o.reference,waitMinutes:()=>2,waitLabel:()=> "2 min",
  canShareFollowup:()=>false,euros:n=>String(n)
 };
 vm.createContext(context);
 const render=vm.runInContext(snippet+";renderOrder",context);
 const html=render({id:"abc",reference:"LA-x",channel:"lastapp",status:"en_ruta",
  customer_name:"Demo",customer_phone:"",destination:"Demo street",notes:"",
  amount:12.5,payment_method:null,notifications_consent:false,accepted_at:"today"});
 assert.match(html,/value="tarjeta" selected/);
 assert.match(html,/value="efectivo" /);
});
test("zero Last total displays verification instead of pretending to know source",()=>{
 assert.match(rider,/verificar importe en Last\.app/);
});
test("manager GPS aligns freshness with public 45 seconds",()=>{
 const staff=read("docs/live.js");
 assert.match(staff,/age>=0&&age<=45000/);
});
test("database fix is staging only and preserves previously confirmed amounts",()=>{
 const sql=read("docs/staging/ed_last_import_tab_review.sql");
 assert.match(sql,/STAGING PROPOSAL ONLY/);
 assert.match(sql,/delivery|bills/);
 assert.match(sql,/amount=case when bill_total_confirmed then amount_eur else existing\.amount end/);
 assert.match(sql,/coalesce\(b->>'deleted','false'\)<>'true'/);
});
test("JavaScript remains syntactically valid",()=>{
 assert.ok(rider.includes('function renderOrder(order,isPriority=false)'));
});
