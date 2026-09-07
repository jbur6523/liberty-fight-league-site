# Available Matches and Offers

Public route: `/offers`. Promoter route: `/admin/superfights`, fifth tab **Offers**.

The public page reuses the matchmaking stylesheet, logo, belt colors, buttons,
and dialogs. Cards contain first name, belt/experience, registered weight-class
labels (including their limits), and Gi/No-Gi/Both. The detail endpoint adds only
Instagram and gym. Phone, email, age, division, notes, last name, raw application
weight, status slug/token, and confirmation links are never returned publicly.
Only active standard-pool competitors without an active match, in events with
applications open, are available. Empty/missing weight preferences are labeled
as still to be agreed; the app does not invent a class from someone's weight.

## Competitor reuse

The Instagram-first form uses the existing normalization helper: handles,
`@handles`, and Instagram profile URLs normalize to a lowercase handle. Lookup
is exact and case insensitive within the target's event. The server repeats the
lookup at submission time; it never trusts a client-supplied competitor ID.
Existing relevant public fields prefill the form without exposing private
application fields. Existing records are not overwritten by public offers.
Optional current weight on an existing offer is stored on the offer itself.

A new handle creates one event competitor with first name, Instagram, belt or
experience, current weight, gym, and Gi/No-Gi preference. White/unranked experience
uses a nullable `experience_level` column without changing existing belt enums.
New offerers enter standard Unmatched immediately. Existing pool assignments
are preserved. Withdrawn/merged registrations require promoter review rather
than silently creating another competitor. Registrations are event-scoped;
the same Instagram can legitimately register for another event.

An event/normalized-Instagram unique index prevents concurrent duplicate active
registrations, including through the old application/quick-add endpoints.
Transaction locks, a unique submission key, and one pending offer per pair make
retries idempotent. Different people can offer against the same competitor.
Invalid/self/unavailable/already-matched submissions are rejected before saving.

## Offer decisions

`superfight_offers` links the target and offering competitor using event-checked
foreign keys; it never copies the target record. States are pending, denied,
matched, or closed. Multiple offers group under the target in the admin tab.

**Make Match** opens the existing weight/bout-type dialog, including shared-class
selection, manual weight, and format-conflict confirmation. The existing match
validation remains in place. One transaction creates the ordinary match and
confirmation records, marks the selected offer matched, and closes conflicting
pending offers for either competitor. The normal Matched count/view is reused.

**Deny Offer** removes the pending offer from the admin list by marking it denied.
It does not change competitor records, pools, registrations, or matches. A new
offerer therefore stays in Unmatched; the target remains publicly available.
Unmatching does not resurrect already resolved offers.

## Email notifications

Notifications use Resend's API and the promoter email already linked through
`superfight_admin_users`/`promoters` (currently Contact@JZPromotion.com). They include
target, submitter, Instagram, offered/current weight, belt/experience, gym, and
Gi/No-Gi. Plain-text email avoids user-supplied HTML, and an offer-derived
idempotency key prevents duplicate delivery during retries.

Required server-only settings: `RESEND_API_KEY`, `SUPERFIGHT_NOTIFY_FROM` (verified
sender), and `CRON_SECRET`. The scheduler secret has been provisioned for the
existing production Vercel project. **The sending service/key and verified sender
remain unconfigured pending the owner's choice. Email delivery is not yet live.**

Offers are saved even if email fails. Notification state/attempts are persisted,
the admin UI exposes Retry email notification, and a protected five-minute cron
retries five pending notifications at a time, up to twelve attempts. Configuring
the sender enables delivery of pending offers. A failed notification never rolls
back a competitor or offer. Instagram on a public offer is self-reported; the
promoter should confirm identity and details before matching.

## Database and security

Migration: `20260907210427_public_match_offers.sql`, applied to the site's existing
Supabase project `nfgoioginqxezmpqzkgz`. It adds offers, a short-lived rate-limit
table, the optional experience column, uniqueness constraints, and service-only
submission/match/rate-limit functions. New tables have RLS enabled and no anon or
authenticated grants. Service-role-only access is intentional; the advisor's
two “RLS enabled, no policy” informational findings describe this default-deny
design. Existing security warnings are unchanged.

Public mutations use same-origin checks, a honeypot, request validation, and
database-backed IP-HMAC rate limits. Raw IP addresses are not stored. Public
requests cannot call the mutation RPCs directly with anon/authenticated keys.
Admin reads and decisions retain existing promoter session authorization.

Migration checksums confirmed all 61 existing competitor records and existing
match records unchanged. No real competitor was used to submit a test offer.

## Verification

- `npm run check`: 41 tests pass, including imports and JavaScript syntax checks.
- PostgreSQL/PGlite: full migration replay, defaults, record reuse, retry
  idempotency, multiple offers, profile preservation, denial, availability,
  white/unranked experience, real match/confirmation creation, competing-offer
  closure, duplicate Instagram protection, role grants, and rate limits.
- Public serializer tests verify exact allowed fields and absence of private
  data; email tests verify notification content, recipient lookup, and
  idempotency headers using a mock provider.
- Local browser preview: new and existing Instagram flow, prefill, repeated
  handle without duplicate registration, denial with Unmatched preserved,
  normal match dialog and updated counts, and public removal only after match.
- Mobile at 375px: public cards fit, five admin tabs scroll horizontally, no
  page overflow; no browser errors during either workflow.
- `vercel build --prod` passes. This static JavaScript project has no separate
  lint or TypeScript configuration. Apply migrations before deploying the API.
- Actual outbound email delivery awaits sender configuration; provider tests
  use a mock and must not be described as a real delivered-email test.
