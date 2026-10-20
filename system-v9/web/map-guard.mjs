// Treat map labels as text even when a mapping library accepts HTML strings.
export function installMapTextGuard(leaflet,documentRef){
 const prototype=leaflet?.Marker?.prototype;if(!prototype||prototype.__edTextLabels)return false;
 const original=prototype.bindTooltip;if(typeof original!=='function')return false;
 prototype.bindTooltip=function(value,options){
  if(typeof value==='string'){const element=documentRef.createElement('span');element.textContent=value;return original.call(this,element,options);}
  return original.call(this,value,options);
 };
 Object.defineProperty(prototype,'__edTextLabels',{value:true});return true;
}
