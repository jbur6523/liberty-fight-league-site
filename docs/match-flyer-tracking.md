# Matched flyer tracking

The Matched quick action saves `superfight_matches.flyer_completed` through the
existing promoter-only matches API. The boolean defaults to false for existing
and new matches. Confirmation responses and matching state are independent.
Unmatching preserves the historical match's flag; a new matchup starts false.

Apply `supabase/migrations/20260912135301_match_flyer_tracking.sql` to the site's
existing Supabase database **before deploying the application changes**. The API
now selects the new column. No new policies, grants, functions, or credentials
are required; existing match authorization remains in effect.

Run `npm run check` for the module/syntax checks and test suite. There is no
separate build or TypeScript step in this static JavaScript project. The flyer
tests execute the migration in PostgreSQL (PGlite), exercise the admin API, and
check the UI's save, toggle, repeated-click, and error behavior.

For browser verification, run `npm run preview` and open
`http://127.0.0.1:4173/admin-superfights.html`, then choose Matched. The preview
uses demo data stored in its server process; production uses the database.

## Verified production target

On September 12, 2026, the Vercel production `SUPABASE_URL` for
`liberty-fight-league-site` was verified as
`https://nfgoioginqxezmpqzkgz.supabase.co` (project `nfgoioginqxezmpqzkgz`).
Use this project explicitly: the connector's project listing returned a different
project and did not enumerate this accessible production database.

Migration `20260912135301_match_flyer_tracking.sql` was applied to this database
and recorded in its migration history. The local filename matches the version
assigned by Supabase. Verification found all 27 existing matches preserved,
including 15 active matches, with the new flag defaulted to false.
