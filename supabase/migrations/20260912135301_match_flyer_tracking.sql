-- Flyer production is independent of matchmaking and fighter confirmations.
alter table public.superfight_matches
  add column flyer_completed boolean not null default false;
