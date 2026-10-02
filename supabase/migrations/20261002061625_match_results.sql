-- Official results remain on the immutable matchup; existing admin RLS applies.
alter table public.superfight_matches add column winner_fighter_id uuid references public.superfight_competitors(id);
alter table public.superfight_matches add constraint superfight_winner_is_participant check (
 winner_fighter_id is null or winner_fighter_id = any(array_remove(array[fighter_a_id,fighter_b_id,fighter_c_id,fighter_d_id], null))
);

-- Multi-fighter gauntlets use two outcomes: fighter A sweeps, or any opponent wins.
-- The immutable fighter B ID keys the opponent-group choice, never an individual win.
create or replace function public.cast_superfight_fan_pick(requested_event uuid, requested_match uuid,
  picked_fighter uuid, voter_hash text, ip_hash text) returns text
language plpgsql security invoker set search_path='' as $$
declare
  event_record public.superfight_events;
  match_record public.superfight_matches;
  browser_attempts integer;
  network_attempts integer;
begin
  if voter_hash is null or voter_hash !~ '^[a-f0-9]{64}$' or ip_hash is null or ip_hash !~ '^[a-f0-9]{64}$' then return 'invalid'; end if;
  -- Lock the event and matchup until commit: closing, switching events, and unmatching
  -- cannot race past validation. Different voters can still share these read locks.
  select * into event_record from public.superfight_events where id=requested_event for share;
  if event_record.id is null or not event_record.fan_picks_current then return 'unavailable'; end if;
  if not event_record.fan_picks_open then return 'closed'; end if;
  select * into match_record from public.superfight_matches where id=requested_match for share;
  if match_record.id is null or match_record.event_id<>requested_event or match_record.state<>'active'
    or ((match_record.fighter_c_id is not null or match_record.fighter_d_id is not null) and match_record.bout_type <> 'gauntlet') then return 'unavailable'; end if;
  if match_record.winner_fighter_id is not null then return 'completed'; end if;
  if picked_fighter is null or picked_fighter not in (match_record.fighter_a_id,match_record.fighter_b_id) then return 'invalid'; end if;

  -- Fixed one-minute windows, persisted across server instances. Generous network cap
  -- allows many independent visitors on venue Wi-Fi; it is not a one-vote-per-IP rule.
  delete from public.superfight_fan_limits where window_start < now()-interval '1 day';
  insert into public.superfight_fan_limits as limits(bucket,window_start,attempts)
    values('browser:'||voter_hash,date_trunc('minute',now()),1)
    on conflict(bucket) do update set window_start=excluded.window_start,
      attempts=case when limits.window_start=excluded.window_start then least(limits.attempts+1,10000) else 1 end
    returning attempts into browser_attempts;
  insert into public.superfight_fan_limits as limits(bucket,window_start,attempts)
    values('network:'||ip_hash,date_trunc('minute',now()),1)
    on conflict(bucket) do update set window_start=excluded.window_start,
      attempts=case when limits.window_start=excluded.window_start then least(limits.attempts+1,10000) else 1 end
    returning attempts into network_attempts;
  if browser_attempts>40 or network_attempts>1200 then return 'rate_limited'; end if;

  insert into public.superfight_fan_votes(match_id,voter_hash,fighter_id)
    values(requested_match,voter_hash,picked_fighter)
    on conflict on constraint superfight_fan_votes_pkey do update set fighter_id=excluded.fighter_id,updated_at=now();
  return 'saved';
end; $$;

-- Versioned snapshot keeps older deployed clients from displaying a group as 1-vs-1.
create or replace function public.superfight_fan_picks_snapshot_v2(voter_hash text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'event',jsonb_build_object('id',e.id,'name',e.name,'voting_open',e.fan_picks_open),
    'matches',coalesce((
      select jsonb_agg(card.payload order by card.created_at,card.id) from (
        select m.id,m.created_at,jsonb_build_object(
          'id',m.id,'winner_fighter_id',m.winner_fighter_id,'bout_type',m.bout_type,'match_weight_lbs',m.match_weight_lbs,
          'fighter_a',jsonb_build_object('id',a.id,'full_name',a.full_name,'gym',a.gym,'fan_photo_path',a.fan_photo_path),
          'fighter_b',jsonb_build_object('id',b.id,'full_name',b.full_name,'gym',b.gym,'fan_photo_path',b.fan_photo_path),
          'opponents',case when m.fighter_c_id is not null then (
            select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'gym',p.gym,'fan_photo_path',p.fan_photo_path) order by array_position(array[m.fighter_b_id,m.fighter_c_id,m.fighter_d_id],p.id))
            from public.superfight_competitors p where p.id=any(array[m.fighter_b_id,m.fighter_c_id,m.fighter_d_id])
          ) else null end,
          'votes_a',(select count(*) from public.superfight_fan_votes v where v.match_id=m.id and v.fighter_id=a.id),
          'votes_b',(select count(*) from public.superfight_fan_votes v where v.match_id=m.id and v.fighter_id=b.id),
          'selected_fighter_id',(select v.fighter_id from public.superfight_fan_votes v where v.match_id=m.id and v.voter_hash=$1)
        ) payload
        from public.superfight_matches m
        join public.superfight_competitors a on a.id=m.fighter_a_id
        join public.superfight_competitors b on b.id=m.fighter_b_id
        where m.event_id=e.id and m.state='active'
          and (m.fighter_c_id is null or m.bout_type='gauntlet')
          and not exists(select 1 from public.superfight_competitors p where p.id=any(array[m.fighter_a_id,m.fighter_b_id,m.fighter_c_id,m.fighter_d_id]) and p.record_state<>'active')
      ) card
    ),'[]'::jsonb)
  ) from public.superfight_events e where e.fan_picks_current;
$$;
revoke all on function public.superfight_fan_picks_snapshot_v2(text) from public,anon,authenticated;
grant execute on function public.superfight_fan_picks_snapshot_v2(text) to service_role;
notify pgrst, 'reload schema';
