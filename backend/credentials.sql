create table public.dm_credentials(name text primary key,iv text not null,cipher text not null);
alter table public.dm_credentials enable row level security;
revoke all on public.dm_credentials from anon,authenticated;
grant all on public.dm_credentials to service_role;
