begin;

alter table public.superfight_competitors add column experience_level text
  check (experience_level is null or length(experience_level) between 1 and 80);

-- One active event registration per normalized Instagram handle. Existing
-- registrations are not merged or rewritten by this migration.
create unique index superfight_competitors_event_instagram_unique
  on public.superfight_competitors(event_id, lower(btrim(instagram_handle)))
  where instagram_handle is not null and record_state = 'active';

create table public.superfight_offers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.superfight_events(id),
  target_competitor_id uuid not null,
  offering_competitor_id uuid not null,
  bout_type public.superfight_bout_type not null,
  offered_weight_lbs numeric(6,2) check (offered_weight_lbs > 0),
  state text not null default 'pending' check (state in ('pending','denied','matched','closed')),
  match_id uuid references public.superfight_matches(id),
  request_key uuid not null unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  notification_state text not null default 'pending' check (notification_state in ('pending','sent','failed')),
  notification_attempts integer not null default 0,
  notification_sent_at timestamptz,
  foreign key (target_competitor_id,event_id) references public.superfight_competitors(id,event_id),
  foreign key (offering_competitor_id,event_id) references public.superfight_competitors(id,event_id),
  check (target_competitor_id <> offering_competitor_id)
);
create unique index superfight_offers_pending_pair on public.superfight_offers(target_competitor_id,offering_competitor_id) where state='pending';
create index superfight_offers_event_state on public.superfight_offers(event_id,state,created_at);
create index superfight_offers_offering_competitor on public.superfight_offers(offering_competitor_id);
alter table public.superfight_offers enable row level security;
revoke all on public.superfight_offers from anon, authenticated;
grant select,insert,update on public.superfight_offers to service_role;

create table public.superfight_offer_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.superfight_offer_rate_limits enable row level security;
revoke all on public.superfight_offer_rate_limits from anon, authenticated;
grant select,insert,update,delete on public.superfight_offer_rate_limits to service_role;

create function public.consume_superfight_offer_limit(rate_bucket text, maximum integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare used integer;
begin
  insert into public.superfight_offer_rate_limits as r(bucket,window_start,attempts)
  values(rate_bucket,now(),1)
  on conflict(bucket) do update set
    attempts=case when r.window_start < now()-interval '10 minutes' then 1 else r.attempts+1 end,
    window_start=case when r.window_start < now()-interval '10 minutes' then now() else r.window_start end
  returning attempts into used;
  delete from public.superfight_offer_rate_limits where window_start < now()-interval '1 day';
  return used <= maximum;
end; $$;
revoke all on function public.consume_superfight_offer_limit(text,integer) from public,anon,authenticated;
grant execute on function public.consume_superfight_offer_limit(text,integer) to service_role;

create function public.submit_superfight_offer(target_id uuid, handle text, selected_bout public.superfight_bout_type,
  submission_key uuid, first_name text default null, submitted_belt text default null,
  current_weight numeric default null, submitted_gym text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  target public.superfight_competitors;
  fighter public.superfight_competitors;
  existing_offer public.superfight_offers;
  offer_id uuid;
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
       current_weight is null or current_weight<=0 or current_weight>9999 or
       nullif(btrim(submitted_gym),'') is null or length(submitted_gym)>160 then
      raise exception 'Complete your name, belt or experience, current weight, and gym.';
    end if;
    insert into public.superfight_competitors(event_id,source,full_name,instagram_handle,instagram_url,
      preferred_contact_method,belt,experience_level,competition_weight_lbs,gym,grappling_preference,application_submitted_at)
    values(target.event_id,'public_application',split_part(btrim(first_name),' ',1),normalized,'https://instagram.com/'||normalized,
      'instagram',case when submitted_belt in ('blue','purple','brown','black') then submitted_belt::public.superfight_belt else null end,
      case when submitted_belt in ('white','unranked') then submitted_belt else null end,
      current_weight,btrim(submitted_gym),selected_bout::text::public.superfight_grappling_preference,now())
    on conflict (event_id,lower(btrim(instagram_handle))) where instagram_handle is not null and record_state='active'
    do nothing returning * into fighter;
    if fighter.id is null then
      select * into fighter from public.superfight_competitors where event_id=target.event_id
        and lower(btrim(instagram_handle))=normalized and record_state='active';
    end if;
  end if;
  select * into existing_offer from public.superfight_offers
    where target_competitor_id=target.id and offering_competitor_id=fighter.id and state='pending';
  if existing_offer.id is not null then return jsonb_build_object('id',existing_offer.id,'created',false); end if;
  if (select count(*) from public.superfight_offers where offering_competitor_id=fighter.id and created_at>now()-interval '1 hour') >= 10 then
    raise exception 'Too many offers. Please try again later.';
  end if;
  insert into public.superfight_offers(event_id,target_competitor_id,offering_competitor_id,bout_type,offered_weight_lbs,request_key)
  values(target.event_id,target.id,fighter.id,selected_bout,coalesce(current_weight,fighter.competition_weight_lbs),submission_key)
  returning id into offer_id;
  return jsonb_build_object('id',offer_id,'created',true);
end; $$;
revoke all on function public.submit_superfight_offer(uuid,text,public.superfight_bout_type,uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.submit_superfight_offer(uuid,text,public.superfight_bout_type,uuid,text,text,numeric,text) to service_role;

-- Reuse existing match constraints/triggers and atomically resolve offers.
create function public.create_superfight_match_with_offer(event_id_input uuid, fighter_a uuid, fighter_b uuid,
  weight_option uuid, agreed_weight numeric, selected_bout public.superfight_bout_type, admin_id uuid, offer_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare saved_offer public.superfight_offers; created_match uuid;
begin
  -- All admin match creation now locks the pair in a stable order.
  perform pg_advisory_xact_lock(hashtextextended('superfight-event:' || event_id_input::text,0));
  perform 1 from public.superfight_competitors where id in(fighter_a,fighter_b) order by id for update;
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
  insert into public.superfight_matches(event_id,fighter_a_id,fighter_b_id,weight_option_id,match_weight_lbs,bout_type,created_by)
    values(event_id_input,fighter_a,fighter_b,weight_option,agreed_weight,selected_bout,admin_id) returning id into created_match;
  update public.superfight_offers set state='closed',resolved_at=now()
    where state='pending' and (target_competitor_id in(fighter_a,fighter_b) or offering_competitor_id in(fighter_a,fighter_b));
  if offer_id is not null then update public.superfight_offers set state='matched',match_id=created_match,resolved_at=now() where id=offer_id; end if;
  return created_match;
end; $$;
revoke all on function public.create_superfight_match_with_offer(uuid,uuid,uuid,uuid,numeric,public.superfight_bout_type,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_superfight_match_with_offer(uuid,uuid,uuid,uuid,numeric,public.superfight_bout_type,uuid,uuid) to service_role;

commit;
