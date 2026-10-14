-- ESTAMBUL DELIVERY: ETA aproximada sin rutas externas y estado visible del GPS privado.
-- Nunca publica coordenadas de otros pedidos. Las ubicaciones siguen siendo voluntarias.
begin;
alter table public.ed_rider_positions add column if not exists speed_kmh numeric(5,1)
 check(speed_kmh is null or speed_kmh between 0 and 120);

-- Version ampliada: GPS del dispositivo + velocidad cuando el sistema operativo la proporcione.
-- Se mantiene la RPC antigua de 3 argumentos para clientes no actualizados.
create or replace function public.ed_update_rider_position(
 p_lat double precision,p_lng double precision,p_accuracy integer,p_speed_kmh double precision)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare r record;
begin
 if p_lat is null or p_lng is null or not (p_lat between -90 and 90) or not (p_lng between -180 and 180)
   or (p_accuracy is not null and not (p_accuracy between 0 and 3000))
   or (p_speed_kmh is not null and (p_speed_kmh < 0 or p_speed_kmh > 120))
 then raise exception 'GPS no válido'; end if;
 select rd.id,rd.account_id into r
 from public.ed_riders rd where rd.user_id=(select auth.uid()) and rd.active and rd.online
   and private.ed_is_rider(rd.account_id,rd.id) limit 1;
 if r.id is null then raise exception 'Repartidor no autorizado o desconectado';end if;
 if not exists(select 1 from public.ed_orders o where o.rider_id=r.id and o.account_id=r.account_id
     and o.status in ('recogido','en_ruta')) then
   raise exception 'GPS solo permitido con reparto activo';
 end if;
 insert into public.ed_rider_positions(rider_id,account_id,latitude,longitude,accuracy_m,speed_kmh,updated_at)
 values(r.id,r.account_id,p_lat,p_lng,p_accuracy,round(p_speed_kmh::numeric,1),now())
 on conflict(rider_id) do update
 set latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,
     speed_kmh=excluded.speed_kmh,updated_at=excluded.updated_at
 where public.ed_rider_positions.updated_at<now()-interval '10 seconds';
 return true;
end $function$;

create or replace function public.ed_public_track(p_token text)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
 v record;
 visible_gps boolean := false;
 gps_state text := 'not_in_route';
 km double precision;
 route_km double precision;
 speed_used double precision;
 use_measured boolean := false;
 eta integer;
 result jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null;end if;
 select o.id,o.reference,o.status,o.updated_at,o.lat as dest_lat,o.lng as dest_lng,
  coalesce(b.display_name,acct.name) as brand,
  coalesce(b.primary_color,'#14263b') as primary_color,
  b.logo_url,b.google_review_url,
  case when o.status in ('asignado','recogido','en_ruta') and r.active
    and r.customer_call_enabled and r.phone ~ '^[+][1-9][0-9]{7,14}$'
  then r.phone else null end as call_phone,
  coalesce(s.enabled,false) as share_enabled,
  coalesce(r.active,false) as rider_active,
  coalesce(r.online,false) as rider_online,
  p.latitude as rider_lat,p.longitude as rider_lng,
  p.speed_kmh as rider_speed,p.accuracy_m as accuracy_m,p.updated_at as gps_time,
  exists(select 1 from public.ed_customer_feedback f where f.order_id=o.id) as has_feedback
 into v
 from private.ed_public_tracking_tokens tok
 join public.ed_orders o on o.id=tok.order_id and o.account_id=tok.account_id
 join public.ed_accounts acct on acct.id=tok.account_id
 left join public.ed_brand_settings b on b.account_id=tok.account_id
 left join public.ed_riders r on r.id=o.rider_id and r.account_id=o.account_id
 left join public.ed_order_location_shares s on s.order_id=o.id
 left join public.ed_rider_positions p on p.rider_id=o.rider_id and p.account_id=o.account_id
 where tok.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
   and tok.revoked_at is null and tok.expires_at>now();
 if v.id is null then return null;end if;

 if v.status='en_ruta' then
  gps_state='not_shared';
  if v.share_enabled and v.rider_active and v.rider_online then
   gps_state='waiting_gps';
   if v.gps_time>now()-interval '45 seconds' and v.rider_lat is not null
    and v.rider_lng is not null then
     visible_gps=true;
     gps_state='live';
   end if;
  end if;
 end if;

 if visible_gps and v.dest_lat between -90 and 90 and v.dest_lng between -180 and 180 then
  -- Haversine kilometres in straight line, approximated *1.35 for urban streets.
  -- This is NOT a Google/OSRM road routing ETA and does not include traffic.
  km=6371.0*2*asin(least(1.0,sqrt(
    power(sin(radians((v.dest_lat-v.rider_lat)::double precision)/2),2)+
    cos(radians(v.rider_lat::double precision))*cos(radians(v.dest_lat::double precision))*
    power(sin(radians((v.dest_lng-v.rider_lng)::double precision)/2),2)
  )));
  if km<=100 then
   route_km=km*1.35;
   use_measured=v.rider_speed is not null and v.rider_speed>=8 and v.rider_speed<=60
     and (v.accuracy_m is null or v.accuracy_m<=120);
   speed_used=case when use_measured then v.rider_speed::double precision else 18.0 end;
   eta=least(240,greatest(3,ceil(route_km/speed_used*60+3)::integer));
  end if;
 end if;

 result=jsonb_build_object(
 'reference',v.reference,'status',v.status,'updated_at',v.updated_at,
 'brand',v.brand,'color',v.primary_color,'logo_url',v.logo_url,
 'rider_call_phone',v.call_phone,
 'gps_state',gps_state,
 'live_location',case when visible_gps then jsonb_build_object(
   'lat',v.rider_lat,'lng',v.rider_lng,'accuracy_m',v.accuracy_m,'updated_at',v.gps_time
 ) else null end,
 'eta_minutes',eta,
 'eta_distance_km',case when eta is not null then round(route_km::numeric,1) else null end,
 'eta_speed_kmh',case when eta is not null then round(speed_used::numeric,1) else null end,
 'eta_speed_source',case when eta is null then null when use_measured then 'gps' else 'referencia' end,
 'review_url',case when v.status='entregado' then v.google_review_url else null end,
 'can_feedback',v.status='entregado' and not v.has_feedback,'feedback_sent',v.has_feedback
 );
 return result;
end $function$;

revoke all on function public.ed_update_rider_position(double precision,double precision,integer,double precision)
 from public,anon,authenticated;
grant execute on function public.ed_update_rider_position(double precision,double precision,integer,double precision)
 to authenticated;
revoke all on function public.ed_public_track(text) from public,anon;
grant execute on function public.ed_public_track(text) to anon,authenticated;
commit;