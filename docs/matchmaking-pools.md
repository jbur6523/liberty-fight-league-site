# Matchmaking pools

Implemented in the canonical 2026-08-09 checkout, reconciled with origin/main at
`a2396b2`. The existing `admin-superfights.html` page is the Unmatched / Matched
promoter interface. Its table, competitor details, sorting, selection and match
agreement controls are reused for John Wick and Gauntlet.

`superfight_competitors.matchmaking_pool` is a non-null, constrained text column
with values `standard`, `john_wick`, and `gauntlet`. Both existing records and new
registrations default to `standard`. Match state remains on `superfight_matches`.
The authenticated, same-origin `move_pool` action updates only this column
(plus the existing automatic updated_at timestamp), restricted to an active
competitor ID. It never writes matches, confirmations, or weight preferences.

All three pools show available competitors: active registrations without an
active match. Pool counts count these competitors; Matched still counts active
matchups. Assignment is retained while matched, so unmatching restores a fighter
to the same pool. Suggested ordering runs independently within each pool.
Tab changes clear selection. Pool moves update the displayed counts after the
server confirms the write, then reload server data. Failed writes leave the
assignment intact and display an error. Refresh, sign-in, and other sessions
read assignments from the database.

## Validation — 2026-09-07

- `npm run check`: 38 tests pass, including application module imports and
  browser-script syntax checks. This JavaScript/static-site repository has no
  separate lint or TypeScript configuration.
- PostgreSQL tests (PGlite, development dependency) replay all repository
  migrations with Supabase auth scaffolding, then verify default/backfill,
  allowed values, profile preservation, match/confirmation preservation, and
  retained assignment after unmatching. Supabase-owned auth objects are stubbed
  and pgcrypto extension creation is omitted; PostgreSQL supplies UUID generation.
- Browser preview: moves standard → John Wick → Gauntlet → standard, correct
  menus/counts, refresh and independent-tab loading, sign-out/sign-in, clearing
  selection, no console errors. At 375px the tab row scrolls without shrinking
  labels or causing page overflow. Preview endpoints use sample data, not real
  registrations.
- `vercel build --prod`: passes against the linked existing site project.
- Migration `20260907173756_matchmaking_pools.sql` applied to the site's verified
  Supabase project `nfgoioginqxezmpqzkgz`. All 58 existing competitor records
  defaulted to standard. Before/after checksums of existing registration fields,
  all matches (6 active, 9 unmatched), and all confirmations were identical.
- Supabase security advisor findings predate this change (existing function
  search-path/execute-permission warnings and disabled leaked-password checking).
  No policies, grants, functions, or authentication settings changed here.

Apply the migration before deploying the API/UI. Application rollback can retain
the additive column and assignments; dropping it would discard assignments.
