import {readBody,constantTimeEqual,uuid,normalizeTab} from './core.mjs';
export function createLastHandler({db,env,fetcher=fetch}){
 const plain=status=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});
 const q=async p=>{const {data,error}=await p;if(error)throw Error('database_error');return data;};
 return async req=>{
  if(req.method!=='POST')return plain(405);
  const secret=env('LAST_APP_INTEGRATOR_TOKEN');if(!secret)return plain(503);
  const supplied=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!constantTimeEqual(supplied,secret.trim()))return plain(401);
  try{
   const event=await readBody(req);const {id,type,data}=event;
   if(typeof id!=='string'||id.length>128||!id||typeof type!=='string')return plain(400);
   if(!['tab:created','tab:updated','tab:delivery-status-updated','tab:cancelled','tab:closed'].includes(type))return plain(200);
   const cfg=await q(db.from('dm_settings').select('*').eq('singleton',true).single());
   const location=req.headers.get('locationid')||data?.locationId;
   if(!cfg.last_location_id||location!==cfg.last_location_id)return plain(403);
   const tabId=uuid(data?.tabId||data?.tab?.id||data?.id);
   const existing=await q(db.from('dm_events').select('*').eq('event_id',id).maybeSingle());
   if(existing?.status==='done')return plain(200);
   await q(db.from('dm_events').upsert({event_id:id,event_type:type,location_id:location,tab_id:tabId,status:'pending',attempts:(existing?.attempts||0)+1}));
   // Fetch full authoritative order: assignment data in a webhook can be partial.
   const r=await fetcher('https://api.last.app/v2/tabs/'+encodeURIComponent(tabId),{headers:{Authorization:'Bearer '+secret,LocationID:location,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('last_http_'+r.status);
   const raw=await r.json();if(raw.id!==tabId)throw Error('tab_id_mismatch');
   if(type==='tab:cancelled')raw.cancelled=true;
   const tab=normalizeTab(raw,location);
   if(tab){
    const amount=cfg.last_amount_unit&&tab.source_amount!==null?Math.round(tab.source_amount*(cfg.last_amount_unit==='euros'?100:1)):null;
    await q(db.rpc('dm_ingest',{p_tab:tab,p_amount:amount}));
   }
   await q(db.from('dm_events').update({status:'done',error_code:null,processed_at:new Date().toISOString()}).eq('event_id',id));
   return plain(200);
  }catch(e){return plain(e.status||503);}
 };
}
