begin;

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

    if new.weight_option_id is not null then
      select * into weight_option_record
      from public.superfight_event_weight_options
      where id = new.weight_option_id
        and event_id = new.event_id
        and is_active = true;

      if weight_option_record.id is null then
        raise exception 'Choose an active weight class for this event.';
      end if;

      new.match_weight_lbs := weight_option_record.value_lbs;
    elsif new.match_weight_lbs is null or new.match_weight_lbs <= 0 then
      raise exception 'Enter the agreed match weight in pounds.';
    end if;

    if fighter_a_record.record_state <> 'active'
       or fighter_b_record.record_state <> 'active' then
      raise exception 'Only active competitors can be placed in an active match.';
    end if;

    if fighter_a_record.gender_division is not null
       and fighter_b_record.gender_division is not null
       and fighter_a_record.gender_division <> fighter_b_record.gender_division then
      raise exception 'Competitors must belong to the same gender division.';
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

drop trigger if exists validate_superfight_match_before_write
  on public.superfight_matches;

create trigger validate_superfight_match_before_write
before insert or update of fighter_a_id, fighter_b_id, state, bout_type, weight_option_id, match_weight_lbs
on public.superfight_matches
for each row execute function public.validate_superfight_match();

comment on column public.superfight_matches.weight_option_id is
  'Optional promoter-selected contracted event weight class. Application preferences inform the UI but do not constrain an agreed match.';

comment on column public.superfight_matches.match_weight_lbs is
  'Final match weight. Derived from weight_option_id when a contracted class is selected, otherwise entered manually by the promoter.';

comment on column public.superfight_matches.bout_type is
  'Promoter-confirmed final bout type. Competitor Gi/No-Gi preferences inform warnings and suggestions but do not constrain an agreed match.';

commit;
