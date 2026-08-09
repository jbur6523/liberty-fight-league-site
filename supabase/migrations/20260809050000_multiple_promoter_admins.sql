begin;

-- A promoter may authorize more than one Supabase Auth account. User IDs remain
-- unique so each account can belong to only one promoter authorization record.
alter table public.superfight_admin_users
  drop constraint if exists superfight_admin_users_promoter_id_key;

create index if not exists superfight_admin_users_promoter_id_idx
  on public.superfight_admin_users (promoter_id);

commit;
