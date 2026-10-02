-- Event-specific competitor records retain weigh-ins when a bout is rematched.
-- Existing promoter RLS applies; public projections do not include this field.
alter table public.superfight_competitors
  add column official_weight_lbs numeric(6,2)
  check (official_weight_lbs is null or (official_weight_lbs > 0 and official_weight_lbs <= 9999));
notify pgrst, 'reload schema';
