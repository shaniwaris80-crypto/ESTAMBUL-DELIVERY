/* Private customer tracking copy. No synthetic location or ETA. */
(function(root){
 "use strict";
 const copy=Object.freeze({
  pendiente:{icon:"✓",title:"Order confirmed",description:"The restaurant has received your order. Follow its progress here.",next:"Next: preparation.",step:"Confirmed"},
  asignado:{icon:"♨",title:"Preparing your order",description:"Your delivery rider has been assigned. We will show the next update here.",next:"Next: collection from the restaurant.",step:"Preparing"},
  recogido:{icon:"▣",title:"Order picked up",description:"Your rider has collected the order.",next:"Next: on the way to you.",step:"Picked up"},
  en_ruta:{icon:"↗",title:"On the way",description:"Your rider is on the way. The map appears only when location sharing is enabled.",next:"Next: delivery to your address.",step:"On the way"},
  entregado:{icon:"✓",title:"Order delivered",description:"Your delivery is complete. Enjoy your meal!",next:"Delivery completed.",step:"Delivered"},
  cancelado:{icon:"!",title:"Order cancelled",description:"This order has been cancelled. Please contact the restaurant if you need help.",next:"Contact the restaurant for assistance.",step:"Cancelled"}
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