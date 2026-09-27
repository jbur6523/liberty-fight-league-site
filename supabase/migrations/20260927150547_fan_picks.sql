begin;

alter table public.superfight_events
  add column fan_picks_current boolean not null default false,
  add column fan_picks_open boolean not null default true;
create unique index superfight_one_current_fan_event on public.superfight_events(fan_picks_current) where fan_picks_current;
-- Match the existing public event selection once; thereafter admins choose explicitly.
update public.superfight_events set fan_picks_current=true where id=(
  select id from public.superfight_events where applications_open order by starts_at asc nulls last, created_at, id limit 1
);
alter table public.superfight_competitors add column fan_photo_path text;

create table public.superfight_fan_votes (
  match_id uuid not null references public.superfight_matches(id) on delete cascade,
  voter_hash text not null check (voter_hash ~ '^[a-f0-9]{64}$'),
  fighter_id uuid not null references public.superfight_competitors(id),
  updated_at timestamptz not null default now(),
  primary key(match_id, voter_hash)
);
create index superfight_fan_votes_fighter on public.superfight_fan_votes(fighter_id);
create table public.superfight_fan_limits (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
create index superfight_fan_limits_expiry on public.superfight_fan_limits(window_start);
alter table public.superfight_fan_votes enable row level security;
alter table public.superfight_fan_limits enable row level security;
revoke all on public.superfight_fan_votes, public.superfight_fan_limits from public, anon, authenticated;
grant all on public.superfight_fan_votes, public.superfight_fan_limits to service_role;

create function public.set_superfight_fan_event(requested_event uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('superfight-fan-current-event',0));
  if not exists(select 1 from public.superfight_events where id=requested_event) then
    raise exception 'Event not found';
  end if;
  update public.superfight_events set fan_picks_current=false where fan_picks_current;
  update public.superfight_events set fan_picks_current=true where id=requested_event;
end; $$;

create function public.cast_superfight_fan_pick(requested_event uuid, requested_match uuid,
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
    or match_record.fighter_c_id is not null or match_record.fighter_d_id is not null then return 'unavailable'; end if;
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

create function public.superfight_fan_picks_snapshot(voter_hash text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'event',jsonb_build_object('id',e.id,'name',e.name,'voting_open',e.fan_picks_open),
    'matches',coalesce((
      select jsonb_agg(card.payload order by card.created_at,card.id) from (
        select m.id,m.created_at,jsonb_build_object(
          'id',m.id,
          'bout_type',m.bout_type,'match_weight_lbs',m.match_weight_lbs,
          'fighter_a',jsonb_build_object('id',a.id,'full_name',a.full_name,'gym',a.gym,'fan_photo_path',a.fan_photo_path),
          'fighter_b',jsonb_build_object('id',b.id,'full_name',b.full_name,'gym',b.gym,'fan_photo_path',b.fan_photo_path),
          'votes_a',(select count(*) from public.superfight_fan_votes v where v.match_id=m.id and v.fighter_id=a.id),
          'votes_b',(select count(*) from public.superfight_fan_votes v where v.match_id=m.id and v.fighter_id=b.id),
          'selected_fighter_id',(select v.fighter_id from public.superfight_fan_votes v where v.match_id=m.id and v.voter_hash=$1)
        ) payload
        from public.superfight_matches m
        join public.superfight_competitors a on a.id=m.fighter_a_id
        join public.superfight_competitors b on b.id=m.fighter_b_id
        where m.event_id=e.id and m.state='active' and m.fighter_c_id is null and m.fighter_d_id is null
          and a.record_state='active' and b.record_state='active'
      ) card
    ),'[]'::jsonb)
  ) from public.superfight_events e where e.fan_picks_current;
$$;

revoke all on function public.set_superfight_fan_event(uuid),
  public.cast_superfight_fan_pick(uuid,uuid,uuid,text,text), public.superfight_fan_picks_snapshot(text) from public,anon,authenticated;
grant execute on function public.set_superfight_fan_event(uuid),
  public.cast_superfight_fan_pick(uuid,uuid,uuid,text,text), public.superfight_fan_picks_snapshot(text) to service_role;

-- Storage is present on Supabase; plain Postgres test databases have no storage schema.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('superfight-fighter-photos','superfight-fighter-photos',true,3145728,array['image/webp'])
      on conflict(id) do nothing;
  end if;
  if to_regclass('storage.objects') is not null then
    -- Restrictive write policies protect this bucket even when another feature
    -- has installed a broad permissive Storage policy. Server service-role writes
    -- bypass RLS only after requireSuperfightAdmin has authorized the request.
    create policy fan_photos_server_insert on storage.objects as restrictive
      for insert to anon,authenticated with check(bucket_id <> 'superfight-fighter-photos');
    create policy fan_photos_server_update on storage.objects as restrictive
      for update to anon,authenticated using(bucket_id <> 'superfight-fighter-photos')
      with check(bucket_id <> 'superfight-fighter-photos');
    create policy fan_photos_server_delete on storage.objects as restrictive
      for delete to anon,authenticated using(bucket_id <> 'superfight-fighter-photos');
  end if;
end; $$;
-- Public reads use Storage's public object URLs. No anon/authenticated object write
-- policies are added: all uploads go through the existing server-side admin check.
commit;
