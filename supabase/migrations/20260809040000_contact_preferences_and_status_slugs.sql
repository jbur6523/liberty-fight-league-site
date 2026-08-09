begin;

create type public.superfight_contact_method as enum (
  'instagram',
  'cell_phone'
);

alter table public.superfight_competitors
  add column preferred_contact_method public.superfight_contact_method,
  add column status_slug text;

create or replace function public.superfight_status_slug_base(fighter_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  last_name text;
  normalized text;
begin
  last_name := regexp_replace(btrim(coalesce(fighter_name, '')), '^.*[[:space:]]+', '');
  normalized := translate(
    lower(last_name),
    'àáâãäåæçèéêëìíîïñòóôõöøœùúûüýÿšž',
    'aaaaaaaceeeeiiiinooooooouuuuyysz'
  );
  normalized := trim(both '-' from regexp_replace(normalized, '[^a-z0-9]+', '-', 'g'));
  normalized := trim(both '-' from left(normalized, 60));
  return coalesce(nullif(normalized, ''), 'fighter');
end;
$$;

create or replace function public.assign_superfight_status_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  base_slug text;
  candidate_slug text;
  suffix integer := 1;
begin
  if new.status_slug is not null then
    return new;
  end if;

  base_slug := public.superfight_status_slug_base(new.full_name);
  perform pg_advisory_xact_lock(hashtextextended(base_slug, 0));
  candidate_slug := base_slug;

  while exists (
    select 1
    from public.superfight_competitors competitor
    where competitor.status_slug = candidate_slug
      and competitor.id <> new.id
  ) loop
    suffix := suffix + 1;
    candidate_slug := base_slug || '-' || suffix;
  end loop;

  new.status_slug := candidate_slug;
  return new;
end;
$$;

create trigger assign_superfight_status_slug_before_write
before insert or update of status_slug
on public.superfight_competitors
for each row execute function public.assign_superfight_status_slug();

update public.superfight_competitors
set status_slug = null
where status_slug is null;

alter table public.superfight_competitors
  alter column status_slug set not null,
  add constraint superfight_competitors_status_slug_unique unique (status_slug),
  add constraint superfight_competitors_status_slug_format
    check (status_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  add constraint superfight_competitors_preferred_contact_available
    check (
      preferred_contact_method is null
      or (preferred_contact_method = 'instagram' and instagram_handle is not null)
      or (preferred_contact_method = 'cell_phone' and phone is not null and length(btrim(phone)) > 0)
    );

create or replace function public.merge_superfight_competitors(
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

  insert into public.superfight_competitor_weight_preferences (
    competitor_id,
    event_id,
    weight_option_id
  )
  select target_record.id, target_record.event_id, preference.weight_option_id
  from public.superfight_competitor_weight_preferences preference
  where preference.competitor_id = source_record.id
  on conflict do nothing;

  update public.superfight_competitors
  set
    phone = coalesce(target_record.phone, source_record.phone),
    email = coalesce(target_record.email, source_record.email),
    preferred_contact_method = coalesce(target_record.preferred_contact_method, source_record.preferred_contact_method),
    age = coalesce(target_record.age, source_record.age),
    gender_division = coalesce(target_record.gender_division, source_record.gender_division),
    grappling_preference = coalesce(target_record.grappling_preference, source_record.grappling_preference),
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

revoke all on function public.superfight_status_slug_base(text) from public;
revoke all on function public.assign_superfight_status_slug() from public;

comment on column public.superfight_competitors.preferred_contact_method is
  'Structured fighter preference for Instagram or cell phone. Public applications always set this field.';

comment on column public.superfight_competitors.status_slug is
  'Readable unique public status identifier. The internal UUID status token is retained for legacy bookmarks.';

comment on function public.assign_superfight_status_slug() is
  'Allocates a lowercase last-name-based status slug with numeric suffixes under concurrent inserts.';

commit;
