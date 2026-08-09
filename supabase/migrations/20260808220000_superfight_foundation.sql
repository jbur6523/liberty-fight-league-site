begin;

create extension if not exists pgcrypto;

create type public.superfight_belt as enum (
  'blue',
  'purple',
  'brown',
  'black'
);

create type public.superfight_competitor_source as enum (
  'public_application',
  'admin_quick_add'
);

create type public.superfight_competitor_state as enum (
  'active',
  'withdrawn',
  'merged'
);

create type public.superfight_match_state as enum (
  'active',
  'unmatched'
);

create type public.superfight_confirmation_response as enum (
  'awaiting',
  'accepted',
  'declined'
);

create table public.superfight_events (
  id uuid primary key default gen_random_uuid(),
  public_slug text not null unique,
  name text not null,
  starts_at timestamptz,
  venue text,
  application_info text,
  applications_open boolean not null default false,
  instagram_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint superfight_events_slug_format
    check (public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint superfight_events_name_present
    check (length(btrim(name)) > 0)
);

create table public.superfight_event_weight_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.superfight_events(id) on delete cascade,
  label text not null,
  value_lbs numeric(6, 2) not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint superfight_weight_options_label_present
    check (length(btrim(label)) > 0),
  constraint superfight_weight_options_positive
    check (value_lbs > 0),
  constraint superfight_weight_options_event_value_unique
    unique (event_id, value_lbs),
  constraint superfight_weight_options_id_event_unique
    unique (id, event_id)
);

create table public.superfight_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  promoter_id uuid not null unique references public.promoters(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.superfight_competitors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.superfight_events(id) on delete restrict,
  status_token uuid not null default gen_random_uuid() unique,
  source public.superfight_competitor_source not null,
  record_state public.superfight_competitor_state not null default 'active',
  full_name text not null,
  phone text,
  email text,
  belt public.superfight_belt,
  competition_weight_lbs numeric(6, 2),
  weight_option_id uuid,
  gym text,
  instagram_handle text,
  instagram_url text,
  notes text,
  application_submitted_at timestamptz,
  merged_into_competitor_id uuid references public.superfight_competitors(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint superfight_competitors_name_present
    check (length(btrim(full_name)) > 0),
  constraint superfight_competitors_weight_positive
    check (competition_weight_lbs is null or competition_weight_lbs > 0),
  constraint superfight_competitors_merge_target_different
    check (merged_into_competitor_id is null or merged_into_competitor_id <> id),
  constraint superfight_competitors_merge_state_consistent
    check (
      (record_state = 'merged' and merged_into_competitor_id is not null)
      or (record_state <> 'merged' and merged_into_competitor_id is null)
    ),
  constraint superfight_competitors_id_event_unique
    unique (id, event_id),
  constraint superfight_competitors_weight_option_event_fk
    foreign key (weight_option_id, event_id)
    references public.superfight_event_weight_options(id, event_id)
    on delete restrict
);

create table public.superfight_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.superfight_events(id) on delete restrict,
  fighter_a_id uuid not null,
  fighter_b_id uuid not null,
  match_weight_lbs numeric(6, 2),
  state public.superfight_match_state not null default 'active',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  unmatched_by uuid references auth.users(id) on delete set null,
  unmatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint superfight_matches_distinct_fighters
    check (fighter_a_id <> fighter_b_id),
  constraint superfight_matches_weight_positive
    check (match_weight_lbs is null or match_weight_lbs > 0),
  constraint superfight_matches_unmatched_audit
    check (
      (state = 'active' and unmatched_at is null)
      or (state = 'unmatched' and unmatched_at is not null)
    ),
  constraint superfight_matches_fighter_a_event_fk
    foreign key (fighter_a_id, event_id)
    references public.superfight_competitors(id, event_id)
    on delete restrict,
  constraint superfight_matches_fighter_b_event_fk
    foreign key (fighter_b_id, event_id)
    references public.superfight_competitors(id, event_id)
    on delete restrict
);

create table public.superfight_match_confirmations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.superfight_matches(id) on delete restrict,
  competitor_id uuid not null references public.superfight_competitors(id) on delete restrict,
  token uuid not null default gen_random_uuid() unique,
  response public.superfight_confirmation_response not null default 'awaiting',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint superfight_confirmations_match_competitor_unique
    unique (match_id, competitor_id),
  constraint superfight_confirmations_response_timestamp
    check (
      (response = 'awaiting' and responded_at is null)
      or (response <> 'awaiting' and responded_at is not null)
    )
);

create index superfight_events_open_starts_idx
  on public.superfight_events (applications_open, starts_at);

create index superfight_weight_options_event_sort_idx
  on public.superfight_event_weight_options (event_id, is_active, sort_order, value_lbs);

create index superfight_competitors_event_pool_idx
  on public.superfight_competitors (event_id, record_state, belt, competition_weight_lbs);

create index superfight_competitors_event_name_idx
  on public.superfight_competitors (event_id, lower(full_name));

create index superfight_matches_event_state_idx
  on public.superfight_matches (event_id, state, created_at desc);

create index superfight_confirmations_match_idx
  on public.superfight_match_confirmations (match_id, response);

create function public.set_superfight_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_superfight_events_updated_at
before update on public.superfight_events
for each row execute function public.set_superfight_updated_at();

create trigger set_superfight_weight_options_updated_at
before update on public.superfight_event_weight_options
for each row execute function public.set_superfight_updated_at();

create trigger set_superfight_competitors_updated_at
before update on public.superfight_competitors
for each row execute function public.set_superfight_updated_at();

create trigger set_superfight_matches_updated_at
before update on public.superfight_matches
for each row execute function public.set_superfight_updated_at();

create trigger set_superfight_confirmations_updated_at
before update on public.superfight_match_confirmations
for each row execute function public.set_superfight_updated_at();

create function public.validate_superfight_match()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.fighter_a_id is distinct from old.fighter_a_id
    or new.fighter_b_id is distinct from old.fighter_b_id
  ) then
    raise exception 'Unmatch the existing pair and create a new match to change competitors.';
  end if;

  perform 1
  from public.superfight_competitors
  where id in (new.fighter_a_id, new.fighter_b_id)
  order by id
  for update;

  if new.state = 'active' then
    if exists (
      select 1
      from public.superfight_competitors competitor
      where competitor.id in (new.fighter_a_id, new.fighter_b_id)
        and competitor.record_state <> 'active'
    ) then
      raise exception 'Only active competitors can be placed in an active match.';
    end if;

    if exists (
      select 1
      from public.superfight_matches existing_match
      where existing_match.state = 'active'
        and existing_match.id <> new.id
        and (
          existing_match.fighter_a_id in (new.fighter_a_id, new.fighter_b_id)
          or existing_match.fighter_b_id in (new.fighter_a_id, new.fighter_b_id)
        )
    ) then
      raise exception 'A competitor already belongs to an active match.';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_superfight_match_before_write
before insert or update of fighter_a_id, fighter_b_id, state
on public.superfight_matches
for each row execute function public.validate_superfight_match();

create function public.create_superfight_match_confirmations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.superfight_match_confirmations (match_id, competitor_id)
  values
    (new.id, new.fighter_a_id),
    (new.id, new.fighter_b_id);

  return new;
end;
$$;

create trigger create_superfight_confirmations_after_match
after insert on public.superfight_matches
for each row execute function public.create_superfight_match_confirmations();

create function public.validate_superfight_confirmation_competitor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.superfight_matches match_record
    where match_record.id = new.match_id
      and new.competitor_id in (match_record.fighter_a_id, match_record.fighter_b_id)
  ) then
    raise exception 'Confirmation competitor must belong to the match.';
  end if;

  return new;
end;
$$;

create trigger validate_superfight_confirmation_before_write
before insert or update of match_id, competitor_id
on public.superfight_match_confirmations
for each row execute function public.validate_superfight_confirmation_competitor();

create function public.submit_superfight_confirmation(
  confirmation_token uuid,
  selected_response text,
  updated_gym text default null,
  should_update_gym boolean default false
)
returns table (
  competitor_id uuid,
  response public.superfight_confirmation_response,
  responded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmation_record public.superfight_match_confirmations%rowtype;
  match_record public.superfight_matches%rowtype;
begin
  if selected_response is null or selected_response not in ('accepted', 'declined') then
    raise exception 'Confirmation response must be accepted or declined.';
  end if;

  select * into confirmation_record
  from public.superfight_match_confirmations
  where token = confirmation_token
  for update;

  if not found then
    raise exception 'Confirmation token was not found.';
  end if;

  select * into match_record
  from public.superfight_matches
  where id = confirmation_record.match_id
  for update;

  if match_record.state <> 'active' then
    raise exception 'This matchup is no longer active.';
  end if;

  if should_update_gym then
    update public.superfight_competitors
    set gym = nullif(btrim(updated_gym), '')
    where id = confirmation_record.competitor_id;
  end if;

  return query
  update public.superfight_match_confirmations
  set
    response = selected_response::public.superfight_confirmation_response,
    responded_at = now()
  where id = confirmation_record.id
  returning
    public.superfight_match_confirmations.competitor_id,
    public.superfight_match_confirmations.response,
    public.superfight_match_confirmations.responded_at;
end;
$$;

create function public.merge_superfight_competitors(
  source_competitor_id uuid,
  target_competitor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record public.superfight_competitors%rowtype;
  target_record public.superfight_competitors%rowtype;
begin
  if source_competitor_id = target_competitor_id then
    raise exception 'A competitor cannot be merged into the same record.';
  end if;

  select * into source_record
  from public.superfight_competitors
  where id = source_competitor_id
  for update;

  select * into target_record
  from public.superfight_competitors
  where id = target_competitor_id
  for update;

  if source_record.id is null or target_record.id is null then
    raise exception 'Both competitor records must exist.';
  end if;

  if source_record.event_id <> target_record.event_id then
    raise exception 'Competitors from different events cannot be merged.';
  end if;

  if source_record.record_state <> 'active' or target_record.record_state <> 'active' then
    raise exception 'Only active competitor records can be merged.';
  end if;

  if exists (
    select 1
    from public.superfight_matches match_record
    where match_record.state = 'active'
      and source_competitor_id in (match_record.fighter_a_id, match_record.fighter_b_id)
  ) then
    raise exception 'Unmatch the source competitor before merging records.';
  end if;

  update public.superfight_competitors
  set
    phone = coalesce(target_record.phone, source_record.phone),
    email = coalesce(target_record.email, source_record.email),
    belt = coalesce(target_record.belt, source_record.belt),
    competition_weight_lbs = coalesce(target_record.competition_weight_lbs, source_record.competition_weight_lbs),
    weight_option_id = coalesce(target_record.weight_option_id, source_record.weight_option_id),
    gym = coalesce(target_record.gym, source_record.gym),
    instagram_handle = coalesce(target_record.instagram_handle, source_record.instagram_handle),
    instagram_url = coalesce(target_record.instagram_url, source_record.instagram_url),
    notes = case
      when target_record.notes is null then source_record.notes
      when source_record.notes is null then target_record.notes
      else target_record.notes || E'\n\nMerged record notes:\n' || source_record.notes
    end,
    application_submitted_at = coalesce(target_record.application_submitted_at, source_record.application_submitted_at)
  where id = target_record.id;

  update public.superfight_competitors
  set
    record_state = 'merged',
    merged_into_competitor_id = target_record.id
  where id = source_record.id;
end;
$$;

create function public.is_superfight_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.superfight_admin_users admin_user
    join public.promoters promoter
      on promoter.id = admin_user.promoter_id
    where admin_user.user_id = check_user_id
      and promoter.status = 'active'
  );
$$;

revoke all on function public.is_superfight_admin(uuid) from public;
grant execute on function public.is_superfight_admin(uuid) to authenticated;

revoke all on function public.submit_superfight_confirmation(uuid, text, text, boolean) from public;
revoke all on function public.merge_superfight_competitors(uuid, uuid) from public;
grant execute on function public.submit_superfight_confirmation(uuid, text, text, boolean) to service_role;
grant execute on function public.merge_superfight_competitors(uuid, uuid) to service_role;

alter table public.superfight_events enable row level security;
alter table public.superfight_event_weight_options enable row level security;
alter table public.superfight_admin_users enable row level security;
alter table public.superfight_competitors enable row level security;
alter table public.superfight_matches enable row level security;
alter table public.superfight_match_confirmations enable row level security;

revoke all on table public.superfight_events from anon;
revoke all on table public.superfight_event_weight_options from anon;
revoke all on table public.superfight_admin_users from anon;
revoke all on table public.superfight_competitors from anon;
revoke all on table public.superfight_matches from anon;
revoke all on table public.superfight_match_confirmations from anon;

grant select, insert, update on table public.superfight_events to authenticated;
grant select, insert, update on table public.superfight_event_weight_options to authenticated;
grant select, insert, update, delete on table public.superfight_admin_users to authenticated;
grant select, insert, update on table public.superfight_competitors to authenticated;
grant select, insert, update on table public.superfight_matches to authenticated;
grant select, insert, update on table public.superfight_match_confirmations to authenticated;

create policy superfight_events_admin_all
on public.superfight_events
for all to authenticated
using (public.is_superfight_admin())
with check (public.is_superfight_admin());

create policy superfight_weight_options_admin_all
on public.superfight_event_weight_options
for all to authenticated
using (public.is_superfight_admin())
with check (public.is_superfight_admin());

create policy superfight_admin_users_admin_all
on public.superfight_admin_users
for all to authenticated
using (public.is_superfight_admin())
with check (public.is_superfight_admin());

create policy superfight_competitors_admin_all
on public.superfight_competitors
for all to authenticated
using (public.is_superfight_admin())
with check (public.is_superfight_admin());

create policy superfight_matches_admin_all
on public.superfight_matches
for all to authenticated
using (public.is_superfight_admin())
with check (public.is_superfight_admin());

create policy superfight_confirmations_admin_all
on public.superfight_match_confirmations
for all to authenticated
using (public.is_superfight_admin())
with check (public.is_superfight_admin());

comment on table public.superfight_events is
  'Lightweight event configuration for the Liberty Fight League Superfight system.';

comment on column public.superfight_event_weight_options.value_lbs is
  'Canonical numeric pounds used for sorting and compatibility; label is the promoter-controlled public text.';

comment on column public.superfight_competitors.status_token is
  'Non-guessable public status-page token. Public table access remains disabled.';

comment on column public.superfight_match_confirmations.token is
  'Non-guessable fighter-specific confirmation token. Public table access remains disabled.';

comment on function public.is_superfight_admin(uuid) is
  'Checks whether an existing Supabase Auth user is linked to an active promoter.';

comment on function public.submit_superfight_confirmation(uuid, text, text, boolean) is
  'Atomically records a confirmation response and the only fighter-editable field: gym.';

comment on function public.merge_superfight_competitors(uuid, uuid) is
  'Fills missing target fields from a duplicate source record and preserves the source as merged history.';

commit;
