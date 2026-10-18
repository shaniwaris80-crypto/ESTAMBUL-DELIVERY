/* Product checklists — no authentication, network, storage or external writes.
 * Each order ID and its snapshot revision uniquely identify a packing checklist.
 * State is ephemeral: a re-issued product list clears previous confirmations.
 */
(function(root){
 "use strict";
 const asObj=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{};
 const clean=(x,max=140)=>typeof x==="string"?x.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max):"";
 const positive=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&x<=500?x:
   typeof x==="string"&&/^\d+(\.\d{1,2})?$/.test(x)&&Number(x)>0&&Number(x)<=500?Number(x):null;
 function normalizeLine(raw){
  const x=asObj(raw),name=clean(x.name);
  const quantity=positive(x.quantity);
  if(!name||quantity===null)return null;
  const mods=Array.isArray(x.modifiers)?x.modifiers.slice(0,30):[];
  const children=Array.isArray(x.comboProducts)?x.comboProducts:
    Array.isArray(x.products)?x.products:[];
  return {name,quantity,
   comments:clean(x.comments,300),
   modifiers:mods.map(m=>{const v=asObj(m);return {name:clean(v.name,100),quantity:positive(v.quantity)||1}}).filter(m=>m.name),
   children:children.slice(0,30).map(y=>{const v=asObj(y);return {name:clean(v.name,140),quantity:positive(v.quantity)||1}}).filter(y=>y.name)};
 }
 function normalizeItems(lines){
  return (Array.isArray(lines)?lines:[]).slice(0,80).map(normalizeLine).filter(Boolean);
 }
 function fromLastTab(raw){
  const tab=asObj(raw);
  const rootLines=normalizeItems(tab.products);
  if(rootLines.length)return {source:"products",items:rootLines,available:true};
  const bills=(Array.isArray(tab.bills)?tab.bills:[]).filter(b=>asObj(b).deleted!==true);
  const fromBills=normalizeItems(bills.flatMap(b=>Array.isArray(asObj(b).products)?b.products:[]));
  if(fromBills.length)return {source:"bills",items:fromBills,available:true};
  return {source:"missing",items:[],available:false};
 }
 function parseSnapshot(raw){
  const snapshot=asObj(raw);
  const items=normalizeItems(snapshot.items);
  const revision=clean(snapshot.revision,128);
  return {revision,items,available:items.length>0&&revision.length>0};
 }
 function newChecklist(){
  const stored=new Map();
  const key=(orderId,revision)=>String(orderId)+"|"+String(revision);
  const selected=(orderId,revision,index)=>stored.get(key(orderId,revision))?.has(index)||false;
  function set(orderId,revision,index,isChecked){
   if(!Number.isInteger(index)||index<0||index>79)return;
   const id=key(orderId,revision);
   let checked=stored.get(id);if(!checked){checked=new Set();stored.set(id,checked);}
   if(isChecked)checked.add(index);else checked.delete(index);
  }
  const verified=(orderId,snapshot)=>{
   const s=parseSnapshot(snapshot);
   if(!s.available)return false;
   return s.items.every((_,index)=>selected(orderId,s.revision,index));
  };
  const count=(orderId,snapshot)=>{
   const s=parseSnapshot(snapshot);
   return s.items.filter((_,i)=>selected(orderId,s.revision,i)).length;
  };
  function clear(orderId){
   for(const k of stored.keys())if(k.startsWith(String(orderId)+"|"))stored.delete(k);
  }
  return {set,selected,verified,count,clear};
 }
 root.ESTAMBUL_ORDER_ITEMS=Object.freeze({normalizeItems,fromLastTab,parseSnapshot,newChecklist});
})(typeof window!=="undefined"?window:globalThis);
