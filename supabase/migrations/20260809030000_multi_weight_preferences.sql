begin;

create table public.superfight_competitor_weight_preferences (
  competitor_id uuid not null,
  event_id uuid not null,
  weight_option_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (competitor_id, weight_option_id),
  constraint superfight_weight_preferences_competitor_event_fk
    foreign key (competitor_id, event_id)
    references public.superfight_competitors(id, event_id)
    on delete cascade,
  constraint superfight_weight_preferences_option_event_fk
    foreign key (weight_option_id, event_id)
    references public.superfight_event_weight_options(id, event_id)
    on delete restrict
);

create index superfight_weight_preferences_event_option_idx
  on public.superfight_competitor_weight_preferences (event_id, weight_option_id, competitor_id);

insert into public.superfight_competitor_weight_preferences (
  competitor_id,
  event_id,
  weight_option_id
)
select id, event_id, weight_option_id
from public.superfight_competitors
where weight_option_id is not null
on conflict do nothing;

alter table public.superfight_matches
  add column weight_option_id uuid,
  add constraint superfight_matches_weight_option_event_fk
    foreign key (weight_option_id, event_id)
    references public.superfight_event_weight_options(id, event_id)
    on delete restrict;

update public.superfight_matches match_record
set weight_option_id = option_record.id
from public.superfight_event_weight_options option_record
where match_record.weight_option_id is null
  and match_record.match_weight_lbs is not null
  and option_record.event_id = match_record.event_id
  and option_record.value_lbs = match_record.match_weight_lbs;

create or replace function public.validate_superfight_match()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fighter_a_record public.superfight_competitors%rowtype;
  fighter_b_record public.superfight_competitors%rowtype;
  weight_option_record public.superfight_event_weight_options%rowtype;
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

  select * into fighter_a_record
  from public.superfight_competitors
  where id = new.fighter_a_id;

  select * into fighter_b_record
  from public.superfight_competitors
  where id = new.fighter_b_id;

  if new.state = 'active' then
    if new.bout_type is null then
      raise exception 'Choose Gi or No-Gi for the final bout type.';
    end if;

    if new.weight_option_id is null then
      raise exception 'Choose the final contracted weight class.';
    end if;

    select * into weight_option_record
    from public.superfight_event_weight_options
    where id = new.weight_option_id
      and event_id = new.event_id
      and is_active = true;

    if weight_option_record.id is null then
      raise exception 'Choose an active weight class for this event.';
    end if;

    if not exists (
      select 1
      from public.superfight_competitor_weight_preferences preference
      where preference.competitor_id = new.fighter_a_id
        and preference.weight_option_id = new.weight_option_id
    ) or not exists (
      select 1
      from public.superfight_competitor_weight_preferences preference
      where preference.competitor_id = new.fighter_b_id
        and preference.weight_option_id = new.weight_option_id
    ) then
      raise exception 'The final weight class must be accepted by both competitors.';
    end if;

    new.match_weight_lbs := weight_option_record.value_lbs;

    if fighter_a_record.record_state <> 'active'
       or fighter_b_record.record_state <> 'active' then
      raise exception 'Only active competitors can be placed in an active match.';
    end if;

    if fighter_a_record.gender_division is not null
       and fighter_b_record.gender_division is not null
       and fighter_a_record.gender_division <> fighter_b_record.gender_division then
      raise exception 'Competitors must belong to the same gender division.';
    end if;

    if new.bout_type = 'gi' and (
      fighter_a_record.grappling_preference = 'no_gi'
      or fighter_b_record.grappling_preference = 'no_gi'
    ) then
      raise exception 'A Gi bout is incompatible with a No-Gi-only competitor.';
    end if;

    if new.bout_type = 'no_gi' and (
      fighter_a_record.grappling_preference = 'gi'
      or fighter_b_record.grappling_preference = 'gi'
    ) then
      raise exception 'A No-Gi bout is incompatible with a Gi-only competitor.';
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

drop trigger validate_superfight_match_before_write
  on public.superfight_matches;

create trigger validate_superfight_match_before_write
before insert or update of fighter_a_id, fighter_b_id, state, bout_type, weight_option_id
on public.superfight_matches
for each row execute function public.validate_superfight_match();

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

alter table public.superfight_competitor_weight_preferences enable row level security;
revoke all on table public.superfight_competitor_weight_preferences from anon;
grant select, insert, update, delete on table public.superfight_competitor_weight_preferences to authenticated;

create policy superfight_weight_preferences_admin_all
on public.superfight_competitor_weight_preferences
for all to authenticated
using (public.is_superfight_admin())
with check (public.is_superfight_admin());

comment on table public.superfight_competitor_weight_preferences is
  'Event weight classes a competitor is willing to accept. Competitors may select more than one.';

comment on column public.superfight_competitors.weight_option_id is
  'Legacy primary/sort anchor. The complete selection is stored in superfight_competitor_weight_preferences.';

comment on column public.superfight_matches.weight_option_id is
  'Promoter-selected final contracted event weight class, which must be accepted by both competitors.';

comment on column public.superfight_matches.match_weight_lbs is
  'Derived numeric value for sorting and legacy displays; copied from the final contracted weight option.';

commit;
