begin;

create function public.submit_superfight_offer_classes(target_id uuid, handle text, selected_bout public.superfight_bout_type,
  submission_key uuid, first_name text default null, submitted_belt text default null,
  selected_weights uuid[] default null, submitted_gym text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  target public.superfight_competitors;
  fighter public.superfight_competitors;
  existing_offer public.superfight_offers;
  offer_id uuid;
  primary_weight public.superfight_event_weight_options;
  normalized text := lower(btrim(handle));
begin
  if normalized is null or normalized !~ '^[a-z0-9._]{1,30}$' then raise exception 'Enter a valid Instagram handle.'; end if;
  -- Serialize retries and offers from the same handle, then lock the target.
  perform pg_advisory_xact_lock(hashtextextended('offer:' || normalized,0));
  select * into existing_offer from public.superfight_offers where request_key=submission_key;
  if existing_offer.id is not null then
    if existing_offer.target_competitor_id <> target_id or not exists(
      select 1 from public.superfight_competitors where id=existing_offer.offering_competitor_id and lower(btrim(instagram_handle))=normalized
    ) then raise exception 'This submission was already used.'; end if;
    return jsonb_build_object('id',existing_offer.id,'created',false);
  end if;
  select * into target from public.superfight_competitors where id=target_id;
  if target.id is null then raise exception 'This match is no longer available.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('superfight-event:' || target.event_id::text,0));
  select * into target from public.superfight_competitors where id=target_id for update;
  if target.id is null or target.record_state <> 'active' or target.matchmaking_pool <> 'standard'
    or exists(select 1 from public.superfight_matches where state='active' and target.id in (fighter_a_id,fighter_b_id))
    or not exists(select 1 from public.superfight_events where id=target.event_id and applications_open) then
    raise exception 'This match is no longer available.';
  end if;
  if coalesce(cardinality(selected_weights),0)=0 or exists (
    select 1 from unnest(selected_weights) chosen(id) where not exists (
      select 1 from public.superfight_event_weight_options w where w.id=chosen.id and w.event_id=target.event_id and w.is_active
    )
  ) then raise exception 'Select available weight classes for this event.'; end if;
  select * into primary_weight from public.superfight_event_weight_options where id=any(selected_weights)
    order by sort_order,value_lbs limit 1;
  select * into fighter from public.superfight_competitors
    where event_id=target.event_id and lower(btrim(instagram_handle))=normalized
    order by (record_state='active') desc, created_at asc limit 1;
  if fighter.id is not null and fighter.record_state <> 'active' then
    raise exception 'Your registration needs promoter review. Please contact Liberty Fight League.';
  end if;
  if fighter.id=target.id then raise exception 'You cannot offer a match against yourself.'; end if;
  if fighter.id is not null and exists(select 1 from public.superfight_matches where state='active' and fighter.id in (fighter_a_id,fighter_b_id)) then
    raise exception 'You already have an active match. Please contact the promoter.';
  end if;
  if fighter.id is null then
    if nullif(btrim(first_name),'') is null or length(first_name)>80 or
       submitted_belt is null or submitted_belt not in ('white','blue','purple','brown','black','unranked') or
       nullif(btrim(submitted_gym),'') is null or length(submitted_gym)>160 then
      raise exception 'Complete your name, belt or experience, weight classes, and gym.';
    end if;
    insert into public.superfight_competitors(event_id,source,full_name,instagram_handle,instagram_url,
      preferred_contact_method,belt,experience_level,competition_weight_lbs,weight_option_id,gym,grappling_preference,application_submitted_at)
    values(target.event_id,'public_application',split_part(btrim(first_name),' ',1),normalized,'https://instagram.com/'||normalized,
      'instagram',case when submitted_belt in ('blue','purple','brown','black') then submitted_belt::public.superfight_belt else null end,
      case when submitted_belt in ('white','unranked') then submitted_belt else null end,
      primary_weight.value_lbs,primary_weight.id,btrim(submitted_gym),selected_bout::text::public.superfight_grappling_preference,now())
    on conflict (event_id,lower(btrim(instagram_handle))) where instagram_handle is not null and record_state='active'
    do nothing returning * into fighter;
    if fighter.id is null then
      select * into fighter from public.superfight_competitors where event_id=target.event_id
        and lower(btrim(instagram_handle))=normalized and record_state='active';
    end if;
  end if;
  -- Keep existing registration preferences and add selected classes atomically.
  insert into public.superfight_competitor_weight_preferences(competitor_id,event_id,weight_option_id)
    select fighter.id,target.event_id,chosen from unnest(selected_weights) chosen
    on conflict do nothing;
  select * into existing_offer from public.superfight_offers
    where target_competitor_id=target.id and offering_competitor_id=fighter.id and state='pending';
  if existing_offer.id is not null then return jsonb_build_object('id',existing_offer.id,'created',false); end if;
  if (select count(*) from public.superfight_offers where offering_competitor_id=fighter.id and created_at>now()-interval '1 hour') >= 10 then
    raise exception 'Too many offers. Please try again later.';
  end if;
  insert into public.superfight_offers(event_id,target_competitor_id,offering_competitor_id,bout_type,offered_weight_lbs,request_key)
  values(target.event_id,target.id,fighter.id,selected_bout,primary_weight.value_lbs,submission_key)
  returning id into offer_id;
  return jsonb_build_object('id',offer_id,'created',true);
end; $$;
revoke all on function public.submit_superfight_offer_classes(uuid,text,public.superfight_bout_type,uuid,text,text,uuid[],text) from public,anon,authenticated;
grant execute on function public.submit_superfight_offer_classes(uuid,text,public.superfight_bout_type,uuid,text,text,uuid[],text) to service_role;


commit;
