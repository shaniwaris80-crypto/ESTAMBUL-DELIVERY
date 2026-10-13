"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { channelLabels, statusLabels, type Channel, type DeliveryStatus, type DemoCommand, type DemoState } from "@estambul/shared";

const DeliveryMap=dynamic(()=>import("../components/DeliveryMap"),{ssr:false,loading:()=> <div className="map-loading">Cargando mapa...</div>});
const euro=new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"});
const channels:("todos"|Channel)[]=["todos","lastapp","uber","justeat"];
const statuses:DeliveryStatus[]=["pendiente","asignado","recogido","en_ruta","entregado"];

export default function Home(){
  const [data,setData]=useState<DemoState|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [filter,setFilter]=useState<"todos"|Channel>("todos");
  const [riderFilter,setRiderFilter]=useState("all");
  const [showDelivered,setShowDelivered]=useState(false);
  const [newRider,setNewRider]=useState("");
  const refresh=useCallback(async()=>{
    try{const r=await fetch("/api/demo",{cache:"no-store"});if(!r.ok)throw new Error("Demo API no disponible. Ejecuta 'npm run dev:backoffice'.");setData(await r.json());setError("");}
    catch(e){setError(e instanceof Error?e.message:"Error de conexión");}
  },[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return ()=>clearInterval(timer);},[refresh]);
  const update=async(command:DemoCommand)=>{
    setBusy(true);
    try{const r=await fetch("/api/demo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)});const json=await r.json();if(!r.ok)throw new Error(json.error||"Error al actualizar");setData(json);setError("");}
    catch(e){setError(e instanceof Error?e.message:"Error");}
    finally{setBusy(false);}
  };
  const visible=useMemo(()=>data?.orders.filter(o=>(filter==="todos"||o.channel===filter)&&(riderFilter==="all"||o.riderId===riderFilter)&& (showDelivered||o.status!=="entregado"))??[],[data,filter,riderFilter,showDelivered]);
  const totals=useMemo(()=>({total:data?.orders.length??0,unassigned:data?.orders.filter(o=>!o.riderId&&o.status!=="entregado").length??0,route:data?.orders.filter(o=>o.status==="en_ruta").length??0,remaining:data?.orders.filter(o=>o.status!=="entregado").length??0,done:data?.orders.filter(o=>o.status==="entregado").length??0,active:data?.riders.filter(r=>r.active).length??0,online:data?.riders.filter(r=>r.active&&r.online).length??0}),[data]);
  return <div className="shell">
    <aside className="sidebar">
      <div className="logo-mark"><span className="logo-icon">E</span><div><strong>ESTAMBUL</strong><small>DELIVERY</small></div></div>
      <div className="sidebar-section">OPERACIONES</div>
      <div className="nav active">◈ &nbsp; Centro de reparto</div>
      <div className="nav">▤ &nbsp; Pedidos</div>
      <div className="nav">♙ &nbsp; Repartidores</div>
      <div className="sidebar-section">INTEGRACIONES</div>
      <div className="nav">↔ &nbsp; Last.app <span className="soon">pendiente</span></div>
      <div className="nav">↔ &nbsp; Uber Eats / Just Eat</div>
      <div className="sidebar-note">ENTORNO DE PRUEBAS<br/><span>Sin clientes reales · Sin GPS real · Sin conexión activa a Last.app</span></div>
    </aside>
    <main className="main">
      <header className="header"><div><div className="eyebrow">CENTRO DE OPERACIONES · BURGOS</div><h1>Control de repartos</h1><p>Pedidos, asignaciones, riders y rutas en una sola pantalla.</p></div>
        <div className="header-actions"><span className="demo-pill"><span className="dot"/> DEMO SIMULADA</span><button className="btn secondary" disabled={busy} onClick={()=>void refresh()}>↻ Actualizar</button></div>
      </header>
      {error&&<div className="alert" role="alert">{error}</div>}
      <div className="stat-grid">
        <Stat label="Pedidos del día" value={totals.total} sub="Todos los canales"/>
        <Stat label="Sin asignar" value={totals.unassigned} sub="Necesitan rider" tone="orange"/>
        <Stat label="En reparto" value={totals.route} sub="Salidas activas" tone="blue"/>
        <Stat label="Por entregar" value={totals.remaining} sub="Excluye entregados"/>
        <Stat label="Entregados" value={totals.done} sub="Completados" tone="green"/>
        <Stat label="Riders online" value={totals.online} sub={totals.active+" registrados"} tone="green"/>
      </div>
      <section className="workspace">
        <div className="map-panel panel">
          <div className="panel-heading"><div><h2>Mapa operativo</h2><p>Riders y entregas de ejemplo · rutas orientativas</p></div><div className="map-key"><span><i className="legend rider"/> Rider</span><span><i className="legend order"/> Pedido</span></div></div>
          <div className="map-frame">{data?<DeliveryMap data={data} focusRider={riderFilter==="all"?"":riderFilter}/>:<div className="map-loading">Preparando simulación...</div>}</div>
          <div className="map-bottom"><span>📍 Burgos · Coordenadas ficticias de prueba</span><button className="btn secondary small" disabled={!data||busy} onClick={()=>data&&void update({action:"moveDemo",riderId:data.riders.find(r=>r.active&&r.online)?.id||""})}>Simular movimiento GPS ↗</button></div>
        </div>
        <div className="riders-panel panel">
          <div className="panel-heading"><div><h2>Repartidores</h2><p>Demo del catálogo Last.app</p></div><span className="count">{totals.active} activos</span></div>
          <div className="rider-list">{data?.riders.map(r=><div key={r.id} className={"rider-item "+(!r.active?"faded":"")}>
            <div className="avatar">{r.name.split(" ").map(s=>s[0]).join("").slice(0,2)}</div><div className="rider-detail"><strong>{r.name}</strong><small>{!r.active?"Desactivado":r.online?"● Conectado":"○ Desconectado"} · {data.orders.filter(o=>o.riderId===r.id&&o.status!=="entregado").length} pendientes</small></div>
            <button title={r.active?"Simular baja de Last.app":"Simular alta de Last.app"} className={"toggle "+(r.active?"on":"")} disabled={busy} onClick={()=>void update({action:"toggleRider",riderId:r.id})}>{r.active?"✓":"—"}</button>
          </div>)}</div>
          <form className="new-rider" onSubmit={e=>{e.preventDefault();if(newRider.trim()){void update({action:"addRider",name:newRider});setNewRider("");}}}><input aria-label="Nombre nuevo rider" placeholder="Nuevo rider de prueba..." value={newRider} onChange={e=>setNewRider(e.target.value)} maxLength={60}/><button disabled={busy||!newRider.trim()} type="submit">+ Añadir</button></form>
          <p className="help">Altas/bajas aquí son simulaciones. La sincronización automática real requiere acceso a riders de Last.app.</p>
        </div>
      </section>
      <section className="panel orders-panel">
        <div className="orders-heading"><div><h2>Listado de pedidos</h2><p>Asigna, reasigna y cambia estados para probar el flujo completo.</p></div>
          <div className="filters"><select aria-label="Filtrar por canal" value={filter} onChange={e=>setFilter(e.target.value as "todos"|Channel)}>{channels.map(c=><option key={c} value={c}>{c==="todos"?"Todos los canales":channelLabels[c]}</option>)}</select>
            <select aria-label="Filtrar por rider" value={riderFilter} onChange={e=>setRiderFilter(e.target.value)}><option value="all">Todos los riders</option>{data?.riders.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </div>
        </div>
        <div className="toggle-row"><label><input type="checkbox" checked={showDelivered} onChange={e=>setShowDelivered(e.target.checked)}/> Mostrar entregados</label><span>{visible.length} pedidos mostrados</span></div>
        <div className="table-scroll"><table><thead><tr><th>Pedido</th><th>Cliente / zona</th><th>Importe</th><th>Repartidor</th><th>Estado</th></tr></thead><tbody>
          {visible.map(o=><tr key={o.id}><td><strong>{o.id}</strong><span className={"source "+o.channel}>{channelLabels[o.channel]}</span></td><td><strong>{o.customer}</strong><small>{o.address}</small></td><td className="price">{euro.format(o.amount)}</td><td><select className="row-select" aria-label={"Asignación "+o.id} disabled={busy||o.status==="entregado"} value={o.riderId??""} onChange={e=>void update({action:"assign",orderId:o.id,riderId:e.target.value||null})}><option value="">Sin asignar</option>{data?.riders.filter(r=>r.active).map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></td><td><select aria-label={"Estado "+o.id} className={"row-select state "+o.status} disabled={busy||!o.riderId||o.status==="entregado"} value={o.status} onChange={e=>void update({action:"status",orderId:o.id,status:e.target.value as DeliveryStatus})}>{statuses.map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}</select></td></tr>)}
          {!visible.length&&<tr><td colSpan={5} className="empty">No hay pedidos con estos filtros.</td></tr>}
        </tbody></table></div>
        <div className="table-footer"><span>Todos los datos son simulados y se reinician al reiniciar el servidor.</span><button className="btn danger small" disabled={busy} onClick={()=>{if(window.confirm("¿Reiniciar todos los datos ficticios de la demo?"))void update({action:"reset"});}}>Restablecer demo</button></div>
      </section>
      <footer className="footer">Estambul Delivery · Versión de desarrollo 0.1 · No usar con datos reales sin autenticación, permisos y auditoría de privacidad.</footer>
    </main>
  </div>;
}
function Stat({label,value,sub,tone=""}:{label:string;value:number;sub:string;tone?:""|"orange"|"blue"|"green"}){return <div className="stat"><div className="stat-label">{label}</div><div className={"stat-value "+tone}>{value}</div><div className="stat-sub">{sub}</div></div>}
