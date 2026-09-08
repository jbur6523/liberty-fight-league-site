begin;
alter table public.superfight_matches
  add column fighter_c_id uuid,
  add column fighter_d_id uuid,
  add constraint match_fighter_c_event_fk foreign key(fighter_c_id,event_id) references public.superfight_competitors(id,event_id),
  add constraint match_fighter_d_event_fk foreign key(fighter_d_id,event_id) references public.superfight_competitors(id,event_id),
  add constraint match_extra_fighters_gauntlet check ((fighter_c_id is null and fighter_d_id is null) or bout_type='gauntlet'),
  add constraint match_fourth_requires_third check(fighter_d_id is null or fighter_c_id is not null);
create index superfight_matches_fighter_c on public.superfight_matches(fighter_c_id) where fighter_c_id is not null;
create index superfight_matches_fighter_d on public.superfight_matches(fighter_d_id) where fighter_d_id is not null;

create or replace function public.validate_superfight_match()
returns trigger language plpgsql set search_path='' as $$
declare participants uuid[]; weight_record public.superfight_event_weight_options;
begin
  participants := array_remove(array[new.fighter_a_id,new.fighter_b_id,new.fighter_c_id,new.fighter_d_id],null);
  if tg_op='UPDATE' and array[new.fighter_a_id,new.fighter_b_id,new.fighter_c_id,new.fighter_d_id]
    is distinct from array[old.fighter_a_id,old.fighter_b_id,old.fighter_c_id,old.fighter_d_id] then
    raise exception 'Unmatch the existing pair and create a new match to change competitors.';
  end if;
  if cardinality(participants) <> (select count(distinct p) from unnest(participants) p) then
    raise exception 'Choose different competitors for each position.';
  end if;
  -- Share the same lock used by offer and normal match creation.
  perform pg_advisory_xact_lock(hashtextextended('superfight-event:'||new.event_id::text,0));
  perform 1 from public.superfight_competitors where id=any(participants) order by id for update;
  if new.state='active' then
    if new.bout_type is null then raise exception 'Choose the final bout type.'; end if;
    if (select count(*) from public.superfight_competitors where id=any(participants) and event_id=new.event_id and record_state='active') <> cardinality(participants) then
      raise exception 'Only active competitors from this event can be placed in an active match.';
    end if;
    if (select count(distinct gender_division) from public.superfight_competitors where id=any(participants))>1 then
      raise exception 'Competitors must belong to the same gender division.';
    end if;
    if new.weight_option_id is not null then
      select * into weight_record from public.superfight_event_weight_options where id=new.weight_option_id and event_id=new.event_id and is_active;
      if weight_record.id is null then raise exception 'Choose an active weight class for this event.'; end if;
      new.match_weight_lbs := weight_record.value_lbs;
    elsif new.match_weight_lbs is null or new.match_weight_lbs<=0 then
      raise exception 'Enter the agreed match weight in pounds.';
    end if;
    if exists(select 1 from public.superfight_matches m where m.state='active' and m.id<>new.id
      and array[m.fighter_a_id,m.fighter_b_id,m.fighter_c_id,m.fighter_d_id] && participants) then
      raise exception 'A competitor already belongs to an active match.';
    end if;
  end if;
  return new;
end; $$;
drop trigger validate_superfight_match_before_write on public.superfight_matches;
create trigger validate_superfight_match_before_write
before insert or update of fighter_a_id,fighter_b_id,fighter_c_id,fighter_d_id,state,bout_type,weight_option_id,match_weight_lbs
on public.superfight_matches for each row execute function public.validate_superfight_match();

create or replace function public.create_superfight_match_confirmations()
returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.superfight_match_confirmations(match_id,competitor_id)
    select new.id,p from unnest(array_remove(array[new.fighter_a_id,new.fighter_b_id,new.fighter_c_id,new.fighter_d_id],null)) p;
  return new;
end; $$;

-- Extend existing membership checks without changing authentication or response rules.
do $migration$
declare routine record; definition text;
begin
  for routine in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'validate_superfight_confirmation_competitor','merge_superfight_competitors',
      'submit_superfight_offer','submit_superfight_offer_classes')
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := replace(definition,'(match_record.fighter_a_id, match_record.fighter_b_id)',
      '(match_record.fighter_a_id, match_record.fighter_b_id, match_record.fighter_c_id, match_record.fighter_d_id)');
    definition := replace(definition,'(fighter_a_id,fighter_b_id)','(fighter_a_id,fighter_b_id,fighter_c_id,fighter_d_id)');
    execute definition;
  end loop;
end; $migration$;

create function public.create_superfight_group_match(event_id_input uuid, fighter_a uuid, fighter_b uuid,
  weight_option uuid, agreed_weight numeric, selected_bout public.superfight_bout_type, admin_id uuid, offer_id uuid default null, fighter_c uuid default null, fighter_d uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare saved_offer public.superfight_offers; created_match uuid;
begin
  -- All admin match creation now locks the pair in a stable order.
  perform pg_advisory_xact_lock(hashtextextended('superfight-event:' || event_id_input::text,0));
  perform 1 from public.superfight_competitors where id in(fighter_a,fighter_b,fighter_c,fighter_d) order by id for update;
  if offer_id is not null then
    select * into saved_offer from public.superfight_offers where id=offer_id for update;
    if saved_offer.id is null or saved_offer.state<>'pending' or saved_offer.event_id<>event_id_input
      or saved_offer.target_competitor_id<>fighter_a or saved_offer.offering_competitor_id<>fighter_b then
      raise exception 'This offer is no longer available.';
    end if;
    if not exists(select 1 from public.superfight_competitors where id=fighter_a and record_state='active' and matchmaking_pool='standard') then
      raise exception 'This competitor is no longer in Unmatched.';
    end if;
  end if;
  insert into public.superfight_matches(event_id,fighter_a_id,fighter_b_id,fighter_c_id,fighter_d_id,weight_option_id,match_weight_lbs,bout_type,created_by)
    values(event_id_input,fighter_a,fighter_b,fighter_c,fighter_d,weight_option,agreed_weight,selected_bout,admin_id) returning id into created_match;
  update public.superfight_offers set state='closed',resolved_at=now()
    where state='pending' and (target_competitor_id in(fighter_a,fighter_b,fighter_c,fighter_d) or offering_competitor_id in(fighter_a,fighter_b,fighter_c,fighter_d));
  if offer_id is not null then update public.superfight_offers set state='matched',match_id=created_match,resolved_at=now() where id=offer_id; end if;
  return created_match;
end; $$;
revoke all on function public.create_superfight_group_match(uuid,uuid,uuid,uuid,numeric,public.superfight_bout_type,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_superfight_group_match(uuid,uuid,uuid,uuid,numeric,public.superfight_bout_type,uuid,uuid,uuid,uuid) to service_role;

commit;
