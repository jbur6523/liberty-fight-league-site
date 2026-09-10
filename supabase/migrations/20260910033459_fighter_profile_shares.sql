-- Shared snapshots contain only explicitly shared profile fields.
create table public.superfight_profile_shares (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{16}$'),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  created_at timestamptz not null default now()
);
alter table public.superfight_profile_shares enable row level security;
revoke all on public.superfight_profile_shares from public, anon, authenticated;
grant select, insert on public.superfight_profile_shares to service_role;
