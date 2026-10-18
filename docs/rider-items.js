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
  const children=Array.isArray(x.children)?x.children:
    Array.isArray(x.comboProducts)?x.comboProducts:
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

 function createController(escape,enabled){
  const packing=newChecklist(),snapshots=new Map(),manual=new Set();
  let lastFetch=0,fetching=false;
  function render(order){
   if(!enabled||!["asignado","recogido","en_ruta"].includes(order.status))return "";
   const snap=snapshots.get(order.id),norm=parseSnapshot(snap),editable=order.status!=="en_ruta";
   const items=norm.available?norm.items.map((item,index)=>{
    const detail=[
      ...item.modifiers.map(m=>(m.quantity===1?"":m.quantity+"× ")+m.name),
      ...item.children.map(m=>(m.quantity===1?"":m.quantity+"× ")+m.name),
      item.comments
    ].filter(Boolean).map(escape).join(" · ");
    return '<label class="packing-item"><input type="checkbox" data-pack-id="'+escape(order.id)+
      '" data-pack-rev="'+escape(norm.revision)+'" data-pack-index="'+index+'" '+
      (packing.selected(order.id,norm.revision,index)?"checked ":"")+(editable?"":"disabled ")+
      '><span><strong>'+escape(item.quantity+"× "+item.name)+'</strong>'+
      (detail?'<small>'+detail+'</small>':"")+'</span></label>';
   }).join(""):"";
   const notice=norm.available?'<div class="packing-progress">'+
      packing.count(order.id,snap)+" de "+norm.items.length+" líneas comprobadas</div>":
      '<p class="packing-missing">⚠ No hay desglose fiable. Verifica el ticket y las bolsas directamente con cocina.</p>'+
      '<label class="packing-manual"><input type="checkbox" data-pack-manual="'+escape(order.id)+'" '+
        (manual.has(order.id)?"checked ":"")+(editable?"":"disabled ")+
      '> He revisado el ticket y confirmado las bolsas con cocina.</label>';
   return '<section class="order-packing" aria-label="Lista de productos para preparar"><div class="packing-heading">'+
    '<strong>🍕 ARTÍCULOS DEL PEDIDO</strong><span>'+(norm.available?norm.items.length+" líneas":"Sin desglose")+
    '</span></div>'+items+notice+'</section>';
  }
  function onChange(event){
   if(!enabled)return;
   const input=event.target;
   if(input?.matches?.('input[data-pack-id]')){
    const id=input.dataset.packId,snap=snapshots.get(id);
    if(snap&&input.dataset.packRev===snap.revision){
     packing.set(id,snap.revision,Number(input.dataset.packIndex),input.checked);
     const progress=input.closest(".order-packing")?.querySelector(".packing-progress");
     if(progress)progress.textContent=packing.count(id,snap)+" de "+parseSnapshot(snap).items.length+" líneas comprobadas";
    }
   }else if(input?.matches?.('input[data-pack-manual]')){
    input.checked?manual.add(input.dataset.packManual):manual.delete(input.dataset.packManual);
   }
  }
  function mayStartRoute(order){
   if(!enabled)return {ok:true};
   const snap=snapshots.get(order.id),norm=parseSnapshot(snap);
   if(norm.available){
    return packing.verified(order.id,snap)?{ok:true}:
      {ok:false,reason:"Comprueba cada artículo, especialmente pizzas, bebidas y complementos, antes de empezar el reparto."};
   }
   return manual.has(order.id)?{ok:true}:
     {ok:false,reason:"Sin lista digital: confirma que revisaste el ticket y todas las bolsas con cocina."};
  }
  async function load(orders,withAuth,redraw){
   if(!enabled||fetching||Date.now()-lastFetch<15000)return;
   const ids=orders.filter(o=>["asignado","recogido","en_ruta"].includes(o.status)).map(o=>o.id).slice(0,80);
   if(!ids.length)return;
   lastFetch=Date.now();fetching=true;
   try{
    const rows=await withAuth("/rest/v1/ed_order_item_snapshots?select=order_id,items,revision,updated_at&order_id=in.("+
      ids.map(encodeURIComponent).join(",")+")&limit=80");
    if(Array.isArray(rows)){
     for(const row of rows)if(row?.order_id&&parseSnapshot(row).available)snapshots.set(row.order_id,row);
     redraw();
    }
   }catch{
    // Feature may be disabled on server: never interrupt Last.app order syncing.
   }finally{fetching=false;}
  }
  const clear=()=>{snapshots.clear();manual.clear();lastFetch=0;};
  const completed=id=>{packing.clear(id);manual.delete(id);};
  return {render,onChange,mayStartRoute,load,clear,completed};
 }
 root.ESTAMBUL_ORDER_ITEMS=Object.freeze({normalizeItems,fromLastTab,parseSnapshot,newChecklist,createController});
})(typeof window!=="undefined"?window:globalThis);
