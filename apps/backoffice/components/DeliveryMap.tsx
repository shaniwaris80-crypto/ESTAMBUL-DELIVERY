"use client";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import { Fragment } from "react";
import { divIcon } from "leaflet";
import { Fragment } from "react";
import type { DemoState } from "@estambul/shared";
const colors=["#16a34a","#2563eb","#d97706","#9333ea","#0d9488"];
export default function DeliveryMap({data,focusRider}:{data:DemoState;focusRider:string}){
  const riderOrders=data.orders.filter(o=>o.status!=="entregado");
  return <MapContainer center={[42.347,-3.682]} zoom={13} scrollWheelZoom={true} style={{height:"100%",width:"100%",borderRadius:16}}>
    <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    {data.riders.filter(r=>r.active&&r.online&&(!focusRider||r.id===focusRider)).map((r,i)=>{
      const color=colors[i%colors.length];const deliveries=riderOrders.filter(o=>o.riderId===r.id);
      const path:[[number,number],...[number,number][]]=[[r.lat,r.lng],...deliveries.map(o=>[o.lat,o.lng] as [number,number])];
      return <Fragment key={r.id}>
        <Marker position={[r.lat,r.lng]} icon={divIcon({className:"custom-pin",html:`<div style="background:${color}" class="map-rider">🚴</div>`,iconSize:[38,38],iconAnchor:[19,19]})}><Popup><strong>{r.name}</strong><br/>{deliveries.length} pendientes · ubicación simulada</Popup></Marker>
        {path.length>1&&<Polyline positions={path} pathOptions={{color,weight:4,dashArray:"7 7",opacity:.85}}/>}
      </Fragment>;
    })}
    {riderOrders.filter(o=>!focusRider||o.riderId===focusRider).map(o=><Marker key={o.id} position={[o.lat,o.lng]} icon={divIcon({className:"custom-pin",html:`<div class="map-order">${o.id.slice(-2)}</div>`,iconSize:[30,36],iconAnchor:[15,36]})}><Popup><b>{o.id}</b> · {o.customer}<br/>{o.address}<br/>{o.status}</Popup></Marker>)}
  </MapContainer>;
}
