/* Pure customer-friendly status presentation. No calls, no GPS simulation. */
(function(root){
 "use strict";
 const copy=Object.freeze({
  pendiente:{icon:"🧾",title:"¡Pedido recibido!",description:"El restaurante ha recibido tu pedido. Puedes consultar el progreso en esta misma página.",next:"Siguiente: asignación del repartidor.",step:"Pedido recibido"},
  asignado:{icon:"🍕",title:"Estamos preparando tu pedido",description:"Tu entrega ya tiene un repartidor asignado. En cuanto recoja el pedido, lo verás aquí.",next:"Siguiente: recogida en el restaurante.",step:"Repartidor asignado"},
  recogido:{icon:"📦",title:"¡Pedido recogido!",description:"Tu repartidor ya tiene el pedido. Esta página se actualizará cuando esté en camino.",next:"Siguiente: reparto en camino.",step:"Pedido recogido"},
  en_ruta:{icon:"🛵",title:"¡Tu pedido va de camino!",description:"El repartidor se dirige a tu dirección. Si comparte su GPS, podrás consultar el mapa aquí.",next:"Siguiente: entrega en tu dirección.",step:"En camino"},
  entregado:{icon:"✅",title:"¡Pedido entregado!",description:"Tu pedido figura como entregado. ¡Que lo disfrutes!",next:"Entrega finalizada. Gracias por confiar en nosotros.",step:"Entregado"},
  cancelado:{icon:"!",title:"Pedido cancelado",description:"Este pedido figura como cancelado. Contacta con el restaurante si necesitas ayuda.",next:"El restaurante puede ayudarte.",step:"Cancelado"}
 });
 const stages=["pendiente","asignado","recogido","en_ruta","entregado"];
 function presentation(status){
  const code=String(status||"");
  const info=copy[code]||copy.pendiente;
  const index=stages.indexOf(code);
  return {...info,stepNumber:index<0?0:index+1,total:5,
   progress:code==="cancelado"?0:index<0?0:Math.round((index+1)/5*100)};
 }
 root.ESTAMBUL_TRACK_PRESENTATION=Object.freeze({presentation});
})(typeof window!=="undefined"?window:globalThis);
