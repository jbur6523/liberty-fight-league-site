alter table public.superfight_competitors
  add column city text check (city is null or char_length(city) between 1 and 100),
  add column state text check (state is null or state ~ '^[A-Z]{2}$'),
  add column distance_from_sf_miles integer check (distance_from_sf_miles >= 0);

comment on column public.superfight_competitors.distance_from_sf_miles is
  'Approximate straight-line miles from submitted city to downtown San Francisco; null when unknown.';
