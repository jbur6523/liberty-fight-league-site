-- Organizational assignment is independent of registration and match state.
-- Existing and newly registered competitors safely enter the standard pool.
alter table public.superfight_competitors
  add column matchmaking_pool text not null default 'standard'
  constraint superfight_competitors_matchmaking_pool_check
  check (matchmaking_pool in ('standard', 'john_wick', 'gauntlet'));

comment on column public.superfight_competitors.matchmaking_pool is
  'Persistent promoter matchmaking pool; preserved while matched and restored on unmatch.';
