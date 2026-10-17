import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SAFETY_FLAGS,sampleData,summarizeOperations,summarizeFinance,summarizeRiders,customerView,euros} from "../docs/labs-core.mjs";
const NOW=Date.UTC(2026,9,18,12,0,0);
const order=(overrides={})=>({id:"DEMO-1",reference:"DEMO-1",source:"lastapp",externalId:"L1",status:"entregado",riderId:"R01",amountCents:1000,paymentMethod:"efectivo",createdAt:NOW-2400000,deliveredAt:NOW-300000,dueAt:NOW,gpsOptIn:false,gpsAt:null,route:null,...overrides});
test("all risky capabilities default OFF",()=>{
 assert.deepEqual(Object.values(SAFETY_FLAGS),[false,false,false,false,false]);
 assert.ok(Object.isFrozen(SAFETY_FLAGS));
});
test("sample data is reproducible, synthetic and bounded",()=>{
 assert.deepEqual(sampleData({now:NOW,count:8,riderCount:3}),sampleData({now:NOW,count:8,riderCount:3}));
 assert.equal(sampleData({now:NOW,count:999,riderCount:999}).orders.length,60);
 assert.equal(sampleData({now:NOW,count:999,riderCount:999}).riders.length,12);
 assert.ok(sampleData({now:NOW}).orders.every(o=>o.reference.startsWith("DEMO-")));
});
test("financial totals only include delivered and preserve integer cents",()=>{
 const actual=summarizeFinance([order(),order({id:"2",paymentMethod:"tarjeta",amountCents:1250}),order({id:"3",paymentMethod:"",amountCents:325}),order({id:"4",status:"cancelado",amountCents:99999})],800);
 assert.equal(actual.totalCents,2575);
 assert.equal(actual.cashCents,1000);
 assert.equal(actual.cardCents,1250);
 assert.equal(actual.unclassifiedCents,325);
 assert.equal(actual.cashDifferenceCents,-200);
 assert.equal(actual.deliveredCount,3);
});
test("unset counted cash never invents a difference",()=>{
 assert.equal(summarizeFinance([order()]).cashDifferenceCents,null);
 assert.equal(summarizeFinance([order()],-1).cashDifferenceCents,null);
});
test("money is localised as EUR",()=>assert.match(euros(1250),/12,50/));
test("alerts flag duplicates per channel, unassigned and delayed",()=>{
 const a=order({status:"pendiente",riderId:null,createdAt:NOW-3000000,dueAt:NOW-10000});
 const b=order({id:"2",reference:"DEMO-2",status:"asignado",source:"lastapp",externalId:"L1"});
 const r=summarizeOperations([a,b],[{id:"R01",available:true}],NOW,20);
 assert.ok(r.alerts.some(x=>x.type==="duplicate"));
 assert.ok(r.alerts.some(x=>x.type==="unassigned"));
 assert.ok(r.alerts.some(x=>x.type==="late"));
});
test("GPS warning only when active opted-in rider GPS stale",()=>{
 const a=order({status:"en_ruta",gpsOptIn:true,gpsAt:NOW-120000});
 const b=order({id:"2",externalId:"L2",status:"en_ruta",gpsOptIn:false,gpsAt:NOW-120000});
 const r=summarizeOperations([a,b],[],NOW);
 assert.equal(r.alerts.filter(x=>x.type==="gps").length,1);
});
test("customer never shows route without fresh opt-in GPS and validated backend route",()=>{
 const route={validated:true,distanceKm:2.5,durationMinutes:9,calculatedAt:NOW-25000};
 const o=order({status:"en_ruta",gpsOptIn:true,gpsAt:NOW-12000,route});
 assert.equal(customerView(o,NOW).routeValid,true);
 assert.equal(customerView({...o,gpsAt:NOW-60000},NOW).routeValid,false);
 assert.equal(customerView({...o,gpsOptIn:false},NOW).routeValid,false);
 assert.equal(customerView({...o,route:{...route,validated:false}},NOW).routeValid,false);
 assert.equal(customerView({...o,route:{...route,calculatedAt:NOW-130000}},NOW).routeValid,false);
 assert.equal(customerView({...o,status:"entregado"},NOW).routeValid,false);
});
test("cancelled customer timeline has no completed milestones",()=>{
 const r=customerView(order({status:"cancelado"}),NOW);
 assert.equal(r.progress,0);
 assert.ok(r.steps.every(s=>!s.done));
});
test("rider summary counts delivered separately from active",()=>{
 const riders=[{id:"R01",label:"Rider 1",available:true}];
 const result=summarizeRiders([order(),order({id:"2",externalId:"L2",status:"en_ruta",deliveredAt:null})],riders);
 assert.equal(result[0].delivered,1);
 assert.equal(result[0].active,1);
 assert.equal(result[0].averageMinutes,35);
});
test("labs implementation has no secrets, remote integrations or writes",()=>{
 const files=["docs/labs-core.mjs","docs/labs.js","labs.html"];
 for(const file of files){
  const text=readFileSync(new URL("../"+file,import.meta.url),"utf8");
  assert.doesNotMatch(text,/fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|service_role|TWILIO_AUTH_TOKEN/);
 }
});

test("all laboratory UI references exist in the standalone HTML",()=>{
 const page=readFileSync(new URL("../labs.html",import.meta.url),"utf8");
 const script=readFileSync(new URL("../docs/labs.js",import.meta.url),"utf8");
 const ids=new Set([...page.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 const uses=[...script.matchAll(/byId\("([^"]+)"\)/g)].map(m=>m[1]);
 assert.ok(uses.length>10);
 assert.deepEqual([...new Set(uses)].filter(id=>!ids.has(id)),[]);
 assert.equal(ids.size,[...page.matchAll(/\bid="([^"]+)"/g)].length);
});
test("the lab page only loads local resources and is not indexable",()=>{
 const page=readFileSync(new URL("../labs.html",import.meta.url),"utf8");
 assert.match(page,/noindex,nofollow/);
 assert.match(page,/src="docs\/labs.js"/);
 assert.match(page,/href="docs\/labs.css"/);
 assert.doesNotMatch(page,/<script[^>]*src="https?:/);
 assert.doesNotMatch(page,/<iframe/i);
});
