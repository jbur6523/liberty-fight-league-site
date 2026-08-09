begin;

-- Baseline representation of the Liberty Fight League objects that existed
-- before this repository adopted Supabase migration history. This migration is
-- recorded as already applied on the existing project; it also recreates the
-- same objects when building a fresh local or disposable database.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.promoters (
  id uuid primary key default gen_random_uuid(),
  promotion_name text not null,
  license_number text not null,
  email text not null,
  contact_name text not null,
  phone text not null,
  website_or_social text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promoters_contact_name_not_blank
    check (length(btrim(contact_name)) > 0),
  constraint promoters_email_not_blank
    check (length(btrim(email)) > 0),
  constraint promoters_license_number_not_blank
    check (length(btrim(license_number)) > 0),
  constraint promoters_phone_not_blank
    check (length(btrim(phone)) > 0),
  constraint promoters_promotion_name_not_blank
    check (length(btrim(promotion_name)) > 0),
  constraint promoters_status_check
    check (status in ('pending', 'active', 'denied', 'disabled'))
);

create index promoters_status_promotion_name_idx
  on public.promoters (status, promotion_name);

create trigger set_promoters_updated_at
before update on public.promoters
for each row execute function public.set_updated_at();

alter table public.promoters enable row level security;

create policy "Active promoters are publicly readable"
on public.promoters
for select to authenticated, anon
using (status = 'active');

create policy "Promoter registrations can be created as pending"
on public.promoters
for insert to authenticated, anon
with check (status = 'pending');

grant execute on function public.set_updated_at() to anon, authenticated, service_role;
grant all on table public.promoters to anon, authenticated, service_role;

commit;
