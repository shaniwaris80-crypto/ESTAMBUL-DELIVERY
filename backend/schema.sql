-- New, isolated staging tables. No legacy schema or production records modified.
begin;
create table public.dm_settings (
 singleton boolean primary key default true check(singleton), owner_email text not null,
 last_location_id text, last_amount_unit text check(last_amount_unit in ('cents','euros')),
 restaurant_phone text, public_origin text, bootstrap_hash text, sms_enabled boolean not null default false, created_at timestamptz not null default now()
);
insert into public.dm_settings(owner_email) values ('shaniwaris80@gmail.com');
create table public.dm_members (
 id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id),
 display_name text not null, role text not null check(role in ('admin','rider')), active boolean not null default true,
 courier_key text unique, online boolean not null default false, created_at timestamptz not null default now()
);
create table public.dm_orders (
 id uuid primary key default gen_random_uuid(), last_location_id text not null, last_tab_id text not null,
 code text not null, customer_name text not null, phone text not null default '', address text not null default '', notes text not null default '',
 latitude double precision, longitude double precision, source text not null default 'Last.app', items jsonb not null default '[]',
 rider_id uuid references public.dm_members(id), status text not null default 'unassigned' check(status in ('unassigned','assigned','accepted','en_route','delivered','cancelled','review')),
 amount_cents integer check(amount_cents>=0), payment text not null default 'unknown' check(payment in ('unknown','cash','card','prepaid')),
 tracking_token uuid not null unique default gen_random_uuid(), tracking_expires timestamptz not null default now()+interval '1 day',
 version integer not null default 1, last_synced_at timestamptz not null default now(), started_at timestamptz, delivered_at timestamptz,
 closure_id uuid, created_at timestamptz not null default now(), unique(last_location_id,last_tab_id)
);
create index dm_order_rider_state on public.dm_orders(rider_id,status);
create table public.dm_positions (rider_id uuid primary key references public.dm_members(id),latitude double precision not null check(latitude between -90 and 90),longitude double precision not null check(longitude between -180 and 180),accuracy double precision not null check(accuracy between 0 and 200),updated_at timestamptz not null default now());
create table public.dm_events (event_id text primary key,event_type text not null,location_id text not null,tab_id text, status text not null default 'pending',attempts integer not null default 0,error_code text,created_at timestamptz not null default now(),processed_at timestamptz);
create table public.dm_audit (id bigint generated always as identity primary key,order_id uuid references public.dm_orders(id),actor_id uuid references public.dm_members(id),action text not null,created_at timestamptz not null default now());
create table public.dm_closures (id uuid primary key default gen_random_uuid(),rider_id uuid not null references public.dm_members(id),order_count integer not null,cash_cents integer not null,card_cents integer not null,prepaid_cents integer not null,created_at timestamptz not null default now());
create table public.dm_messages (id bigint generated always as identity primary key,order_id uuid not null references public.dm_orders(id),actor text not null check(actor in ('customer','rider','admin')),body text not null check(length(body) between 1 and 500),created_at timestamptz not null default now());
create index dm_messages_order on public.dm_messages(order_id,created_at);
-- Authenticated users go through the authenticated API. These tables deliberately have no direct-client policies.
alter table public.dm_settings enable row level security;
alter table public.dm_members enable row level security;
alter table public.dm_orders enable row level security;
alter table public.dm_positions enable row level security;
alter table public.dm_events enable row level security;
alter table public.dm_audit enable row level security;
alter table public.dm_closures enable row level security;
alter table public.dm_messages enable row level security;
revoke all on public.dm_settings,public.dm_members,public.dm_orders,public.dm_positions,public.dm_events,public.dm_audit,public.dm_closures,public.dm_messages from anon,authenticated;
grant all on public.dm_settings,public.dm_members,public.dm_orders,public.dm_positions,public.dm_events,public.dm_audit,public.dm_closures,public.dm_messages to service_role;
grant usage,select on sequence public.dm_audit_id_seq,public.dm_messages_id_seq to service_role;

create table public.dm_sms (order_id uuid primary key references public.dm_orders(id),status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','blocked')),provider_sid text,error_code text,claimed_at timestamptz,sent_at timestamptz);
alter table public.dm_sms enable row level security;
revoke all on public.dm_sms from anon,authenticated;
grant all on public.dm_sms to service_role;

create function public.dm_transition(p_user uuid,p_order uuid,p_action text,p_version integer,p_payment text default null,p_amount integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.dm_members; o public.dm_orders; s text;
begin
 select * into m from public.dm_members where user_id=p_user and active for update;
 if m.id is null or m.role<>'rider' then raise exception 'not_authorized'; end if;
 select * into o from public.dm_orders where id=p_order for update;
 if o.id is null or o.rider_id is distinct from m.id then raise exception 'not_assigned'; end if;
 if not m.online then raise exception 'rider_offline'; end if;
 if o.version<>p_version then raise exception 'version_conflict'; end if;
 if p_action='accept' and o.status='assigned' then s:='accepted';
 elsif p_action='start' and o.status='accepted' then s:='en_route';
 elsif p_action='deliver' and o.status='en_route' then
  if p_payment not in ('cash','card','prepaid') or p_payment is null or p_amount is null or p_amount<0 or p_amount>1000000 then raise exception 'payment_required'; end if;
  s:='delivered';
 else raise exception 'invalid_transition'; end if;
 update public.dm_orders set status=s,version=version+1,
 started_at=case when s='en_route' then now() else started_at end,
 delivered_at=case when s='delivered' then now() else delivered_at end,
 tracking_expires=case when s='delivered' then now()+interval '2 hours' else tracking_expires end,
 payment=case when s='delivered' then p_payment else payment end,
 amount_cents=case when s='delivered' then p_amount else amount_cents end where id=o.id returning * into o;
 insert into public.dm_audit(order_id,actor_id,action) values(o.id,m.id,p_action);
 if p_action='accept' then insert into public.dm_sms(order_id) values(o.id) on conflict(order_id) do nothing;end if;
 return to_jsonb(o);
end $$;
create function public.dm_close_shift(p_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.dm_members;c public.dm_closures;n integer;cash integer;card integer;paid integer;
begin
 select * into m from public.dm_members where user_id=p_user and active for update;
 if m.id is null or m.role<>'rider' then raise exception 'not_authorized'; end if;
 if exists(select 1 from public.dm_orders where rider_id=m.id and status in ('assigned','accepted','en_route','review')) then raise exception 'pending_deliveries';end if;
 select count(*),coalesce(sum(amount_cents) filter(where payment='cash'),0),coalesce(sum(amount_cents) filter(where payment='card'),0),coalesce(sum(amount_cents) filter(where payment='prepaid'),0) into n,cash,card,paid from public.dm_orders where rider_id=m.id and status='delivered' and closure_id is null;
 if n=0 then raise exception 'empty_shift';end if;
 insert into public.dm_closures(rider_id,order_count,cash_cents,card_cents,prepaid_cents) values(m.id,n,cash,card,paid) returning * into c;
 update public.dm_orders set closure_id=c.id where rider_id=m.id and status='delivered' and closure_id is null;
 update public.dm_members set online=false where id=m.id;
 delete from public.dm_positions where rider_id=m.id;
 return to_jsonb(c);
end $$;
create function public.dm_set_online(p_user uuid,p_online boolean) returns void language plpgsql security invoker set search_path='' as $$
declare m public.dm_members;
begin
 select * into m from public.dm_members where user_id=p_user and active and role='rider' for update;
 if m.id is null then raise exception 'not_authorized';end if;
 if not p_online and exists(select 1 from public.dm_orders where rider_id=m.id and status='en_route') then raise exception 'pending_deliveries';end if;
 update public.dm_members set online=p_online where id=m.id;
 if not p_online then delete from public.dm_positions where rider_id=m.id;end if;
end $$;
create function public.dm_ingest(p_tab jsonb,p_amount integer) returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.dm_members;o public.dm_orders; new_status text; rid uuid;
begin
 -- Per-location lock serializes fresh fetch writes; prevent duplicates and concurrent close/assignment races.
 perform pg_advisory_xact_lock(hashtextextended(p_tab->>'last_location_id',0));
 select * into r from public.dm_members where courier_key=nullif(p_tab->>'courier_key','') and role='rider' and active for update;
 rid:=r.id;
 select * into o from public.dm_orders where last_location_id=p_tab->>'last_location_id' and last_tab_id=p_tab->>'last_tab_id' for update;
 new_status:=case when (p_tab->>'cancelled')::boolean then 'cancelled' when rid is not null then 'assigned' when nullif(p_tab->>'courier_key','') is null then 'unassigned' else 'review' end;
 if o.id is not null and o.status in ('delivered','cancelled') then return o.id;end if;
 -- Reassignment while en route stops the old rider immediately and requires review; never follows the old GPS.
 if o.status in ('accepted','en_route') then
  if o.rider_id is distinct from rid then new_status:='review';rid:=null;
  elsif new_status<>'cancelled' then new_status:=o.status;end if;
 end if;
 insert into public.dm_orders(last_location_id,last_tab_id,code,customer_name,phone,address,notes,latitude,longitude,source,items,rider_id,status,amount_cents)
 values(p_tab->>'last_location_id',p_tab->>'last_tab_id',p_tab->>'code',p_tab->>'customer_name',p_tab->>'phone',p_tab->>'address',p_tab->>'notes',(p_tab->>'latitude')::double precision,(p_tab->>'longitude')::double precision,p_tab->>'source',p_tab->'items',rid,new_status,p_amount)
 on conflict(last_location_id,last_tab_id) do update set customer_name=excluded.customer_name,phone=excluded.phone,address=excluded.address,notes=excluded.notes,latitude=excluded.latitude,longitude=excluded.longitude,items=excluded.items,rider_id=excluded.rider_id,status=excluded.status,amount_cents=case when dm_orders.started_at is null then excluded.amount_cents else dm_orders.amount_cents end,version=dm_orders.version+1,last_synced_at=now()
 returning id into rid;
 return rid;
end $$;
revoke all on function public.dm_transition(uuid,uuid,text,integer,text,integer),public.dm_close_shift(uuid),public.dm_set_online(uuid,boolean),public.dm_ingest(jsonb,integer) from public,anon,authenticated;
grant execute on function public.dm_transition(uuid,uuid,text,integer,text,integer),public.dm_close_shift(uuid),public.dm_set_online(uuid,boolean),public.dm_ingest(jsonb,integer) to service_role;
commit;
