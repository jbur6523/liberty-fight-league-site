# Superfight Supabase changes

The migration in `migrations/20260808220000_superfight_foundation.sql` is intended for the **existing** Liberty Fight League Supabase project. It does not create, link, or seed a project.

## Before applying

1. Inspect the existing project's tables, migrations, Auth users, extensions, RLS policies, and naming conventions.
2. Confirm that none of the `superfight_` object names collide with existing objects.
3. Link this repository to the existing project without committing `.env` files, access tokens, or service-role values.
4. Run the migration against a disposable branch/local database first, then review Supabase's database linter output.
5. Take the normal production backup/snapshot before applying the reviewed migration.

## Migration implications

- Adds six tables, five enum types, seven trigger/helper functions, indexes, and RLS policies.
- Enables RLS and revokes anonymous table access for every new table.
- Does not add an event, weight options, competitor data, Auth user, or admin membership.
- Prevents hard deletion of competitors and match history through the authenticated role.
- Creates two fighter confirmation rows automatically when a promoter creates a match.
- Prevents a competitor from belonging to more than one active match.
- Keeps match participants immutable; change an opponent by unmatching and creating a new match.

## First promoter authorization

The first promoter must already be a user in the existing Supabase Auth project and have an active row in the existing `public.promoters` table. Bootstrap that user through a trusted server-side process or the Supabase SQL editor by inserting their Auth UUID and promoter UUID into `public.superfight_admin_users`. The promoter row remains the source of truth for active/disabled status. Do not put an email or UUID in a committed migration.

Later promoter access can be managed by an already-authorized promoter or another trusted server-side process.

## Runtime configuration

The eventual Vercel server functions will need `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the existing Vercel project. The service-role value is server-only and must never use a public/client-prefixed variable name.
