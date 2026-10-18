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
 function optionalCategory(line){
  const x=asObj(line),names=[clean(x.name),...(Array.isArray(x.children)?x.children:[]).map(y=>clean(asObj(y).name))];
  const normalized=names.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  if(/\b(pizzas?|pizzetas?|calzones?)\b/.test(normalized))return "pizza";
  if(/\b(bebidas?|refrescos?|aguas?|coca[\s-]?colas?|colas?|pepsis?|fantas?|sprites?|seven[\s-]?up|7[\s-]?up|aquarius|nesteas?|kas|zumos?|jugos?|cervezas?|tonicas?|red[\s-]?bull|monsters?|batidos?)\b/.test(normalized))return "bebida";
  return null;
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
  const packing=newChecklist(),snapshots=new Map();
  let lastFetch=0,fetching=false;
  function optionalRows(snapshot){
   const norm=parseSnapshot(snapshot);
   return norm.items.map((item,index)=>({item,index,category:optionalCategory(item)})).filter(row=>row.category);
  }
  function render(order){
   if(!enabled||!["asignado","recogido","en_ruta"].includes(order.status))return "";
   const snap=snapshots.get(order.id),norm=parseSnapshot(snap);
   const optional=optionalRows(snap);
   const items=norm.available?norm.items.map((item,index)=>{
    const category=optionalCategory(item);
    const detail=[
     ...item.modifiers.map(m=>(m.quantity===1?"":m.quantity+"× ")+m.name),
     ...item.children.map(m=>(m.quantity===1?"":m.quantity+"× ")+m.name),
     item.comments
    ].filter(Boolean).map(escape).join(" · ");
    const line='<span><strong>'+escape(item.quantity+"× "+item.name)+'</strong>'+
     (detail?'<small>'+detail+'</small>':"")+'</span>';
    return category?
     '<label class="packing-item packing-optional"><input type="checkbox" data-pack-id="'+escape(order.id)+
       '" data-pack-rev="'+escape(norm.revision)+'" data-pack-index="'+index+'" '+
       (packing.selected(order.id,norm.revision,index)?"checked ":"")+
       'aria-label="Marcar '+escape(category)+': '+escape(item.name)+'" >'+line+'</label>':
     '<div class="packing-item packing-readonly">'+line+'</div>';
   }).join(""):"";
   const done=optional.filter(row=>packing.selected(order.id,norm.revision,row.index)).length;
   const notice=norm.available?
     (optional.length?'<div class="packing-progress">'+done+" de "+optional.length+
       ' pizzas/bebidas marcadas (opcional)</div>':
       '<div class="packing-progress">Sin casillas: solo pizzas y bebidas llevan control opcional.</div>'):
     '<p class="packing-missing">No hay desglose de artículos en este pedido. Puedes consultar el ticket en cocina; no es obligatorio marcar nada.</p>';
   return '<section class="order-packing" aria-label="Artículos del pedido">'+
    '<div class="packing-heading"><strong>🍕 ARTÍCULOS DEL PEDIDO</strong>'+
     '<span>REVISIÓN OPCIONAL</span></div>'+
    '<p class="packing-explanation">Solo pizzas y bebidas tienen casilla. Puedes continuar el reparto sin marcar.</p>'+
    items+notice+'</section>';
  }
  function onChange(event){
   if(!enabled)return;
   const input=event.target;
   if(!input?.matches?.('input[data-pack-id]'))return;
   const id=input.dataset.packId,snap=snapshots.get(id);
   if(!snap||input.dataset.packRev!==snap.revision)return;
   const index=Number(input.dataset.packIndex),norm=parseSnapshot(snap);
   if(!norm.available||!norm.items[index]||!optionalCategory(norm.items[index]))return;
   packing.set(id,snap.revision,index,input.checked);
   const progress=input.closest(".order-packing")?.querySelector(".packing-progress");
   if(progress){
    const optional=optionalRows(snap);
    const done=optional.filter(row=>packing.selected(id,snap.revision,row.index)).length;
    progress.textContent=done+" de "+optional.length+" pizzas/bebidas marcadas (opcional)";
   }
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
    // Optional read-only detail cannot interrupt the ongoing delivery.
   }finally{fetching=false;}
  }
  const clear=()=>{snapshots.clear();lastFetch=0;};
  const completed=id=>packing.clear(id);
  return {render,onChange,load,clear,completed};
 }
 root.ESTAMBUL_ORDER_ITEMS=Object.freeze({normalizeItems,fromLastTab,parseSnapshot,optionalCategory,newChecklist,createController});
})(typeof window!=="undefined"?window:globalThis);
