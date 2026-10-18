-- STAGING REVIEW ONLY. Do NOT execute on live Supabase before staging & RLS verification.
-- Purpose: persist sanitized product lists from authenticated Last.app tab fetches.
-- The Rider receives only items for orders assigned to that authenticated Rider.
create table if not exists public.ed_order_item_snapshots (
  order_id uuid primary key references public.ed_orders(id) on delete cascade,
  account_id uuid not null references public.ed_accounts(id) on delete cascade,
  items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 80),
  revision text not null check (length(revision)=32),
  source text not null default 'lastapp' check (source='lastapp'),
  updated_at timestamptz not null default now()
);

alter table public.ed_order_item_snapshots enable row level security;
revoke all on public.ed_order_item_snapshots from public,anon,authenticated;
grant select on public.ed_order_item_snapshots to authenticated;
grant select,insert,update,delete on public.ed_order_item_snapshots to service_role;

drop policy if exists ed_order_items_read on public.ed_order_item_snapshots;
create policy ed_order_items_read on public.ed_order_item_snapshots
for select to authenticated
using (exists (
  select 1 from public.ed_orders o
  where o.id=ed_order_item_snapshots.order_id
  and o.account_id=ed_order_item_snapshots.account_id
  and ((select private.ed_is_staff(o.account_id))
   or (o.rider_id is not null and (select private.ed_is_rider(o.account_id,o.rider_id))))
));

-- Server-only: executed only after a verified Last.app fetch has been stored.
-- No changes to order amount, payment method, rider assignment, or status.
create or replace function public.ed_last_upsert_item_snapshot(
 p_location_id text, p_tab_id text, p_tab jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_order uuid;v_account uuid;v_raw jsonb:='[]'::jsonb;
 v_items jsonb:='[]'::jsonb;v_bill jsonb;v_line jsonb;v_mod jsonb;v_child jsonb;
 v_mods jsonb;v_children jsonb;v_name text;v_qty numeric;v_source text;
 v_rev text;v_count integer:=0;
begin
 if (select auth.role()) <> 'service_role' then raise exception 'service role only';end if;
 if p_location_id is null or p_tab_id is null or jsonb_typeof(p_tab)<>'object' then
  raise exception 'Invalid item snapshot arguments';end if;
 select o.id,o.account_id into v_order,v_account
 from private.ed_last_order_links l
 join public.ed_orders o on o.id=l.order_id
 join private.ed_last_locations loc on loc.location_id=l.location_id and loc.account_id=o.account_id and loc.enabled
 where l.location_id=p_location_id and l.tab_id=p_tab_id;
 if v_order is null then return jsonb_build_object('skipped','not_imported');end if;
 if p_tab->>'locationId' is distinct from p_location_id then
  raise exception 'Last tab location does not match';end if;
 -- Last may return active products OR products nested in bills.
 -- Never concatenate both: that would double-count meals.
 if jsonb_typeof(p_tab->'products')='array' and jsonb_array_length(p_tab->'products')>0 then
  v_raw=p_tab->'products';v_source='products';
 elsif jsonb_typeof(p_tab->'bills')='array' then
  for v_bill in select value from jsonb_array_elements(p_tab->'bills') loop
   if coalesce(v_bill->>'deleted','false')='true' then continue;end if;
   if jsonb_typeof(v_bill->'products')='array' then v_raw=v_raw||(v_bill->'products');end if;
  end loop;
  v_source='bills';
 end if;
 if jsonb_typeof(v_raw)<>'array' or jsonb_array_length(v_raw)=0 then
  return jsonb_build_object('skipped','list_unavailable');
 end if;
 for v_line in select value from jsonb_array_elements(v_raw) limit 80 loop
  if jsonb_typeof(v_line)<>'object' then continue;end if;
  v_name=left(btrim(coalesce(v_line->>'name','')),140);
  if length(v_name)=0 or coalesce(v_line->>'quantity','') !~ '^[0-9]+([.][0-9]{1,2})?$' then continue;end if;
  v_qty=(v_line->>'quantity')::numeric;
  if v_qty<=0 or v_qty>500 then continue;end if;
  v_mods='[]'::jsonb;
  if jsonb_typeof(v_line->'modifiers')='array' then
   for v_mod in select value from jsonb_array_elements(v_line->'modifiers') limit 30 loop
    if jsonb_typeof(v_mod)<>'object' or btrim(coalesce(v_mod->>'name',''))='' then continue;end if;
    v_mods=v_mods||jsonb_build_array(jsonb_build_object(
      'name',left(btrim(v_mod->>'name'),100),
      'quantity',case when coalesce(v_mod->>'quantity','')~'^[0-9]+$'
          and length(v_mod->>'quantity')<=3 and (v_mod->>'quantity')::integer between 1 and 500
          then (v_mod->>'quantity')::integer else 1 end));
   end loop;
  end if;
  v_children='[]'::jsonb;
  for v_child in select value from jsonb_array_elements(
    case when jsonb_typeof(v_line->'comboProducts')='array' then v_line->'comboProducts'
         when jsonb_typeof(v_line->'products')='array' then v_line->'products'
         else '[]'::jsonb end) limit 30 loop
   if jsonb_typeof(v_child)<>'object' or btrim(coalesce(v_child->>'name',''))='' then continue;end if;
   v_children=v_children||jsonb_build_array(jsonb_build_object(
     'name',left(btrim(v_child->>'name'),140),
     'quantity',case when coalesce(v_child->>'quantity','')~'^[0-9]+$'
        and length(v_child->>'quantity')<=3 and (v_child->>'quantity')::integer between 1 and 500
        then (v_child->>'quantity')::integer else 1 end));
  end loop;
  v_items=v_items||jsonb_build_array(jsonb_build_object(
    'name',v_name,'quantity',v_qty,'comments',left(coalesce(v_line->>'comments',''),300),
    'modifiers',v_mods,'children',v_children));
  v_count=v_count+1;
 end loop;
 if v_count=0 then return jsonb_build_object('skipped','no_valid_lines');end if;
 v_rev=md5(v_items::text);
 insert into public.ed_order_item_snapshots(order_id,account_id,items,revision,source,updated_at)
 values(v_order,v_account,v_items,v_rev,'lastapp',now())
 on conflict(order_id) do update set items=excluded.items,revision=excluded.revision,
  source=excluded.source,updated_at=excluded.updated_at
 where public.ed_order_item_snapshots.revision is distinct from excluded.revision;
 return jsonb_build_object('saved',true,'count',v_count,'source',v_source);
end;
$fn$;
revoke all on function public.ed_last_upsert_item_snapshot(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ed_last_upsert_item_snapshot(text,text,jsonb) to service_role;
