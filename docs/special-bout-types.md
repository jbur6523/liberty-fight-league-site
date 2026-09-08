# Special final bout types

The matchmaking confirmation dialog supports Gi, No-Gi, John Wick (two competitors), and Gauntlet (two to four competitors total). Selecting Gauntlet reveals optional third and fourth competitor selectors. The fourth selector requires a third competitor and prevents a duplicate selection.

Shared weight options and format warnings are recalculated across every selected competitor. If their weight preferences do not overlap, the promoter enters an agreed weight. Existing public registration and offer forms continue to collect Gi/No-Gi preferences.

Gauntlets are one match record with optional fighter_c_id and fighter_d_id. All participants receive their own confirmation links, appear in the Matched view and participant status pages, and are excluded from unmatched pools and public offers. A Gauntlet is fully accepted only after every participant accepts. Unmatch releases everyone together and preserves confirmation history.

Migrations add the two enum values, optional participant columns, four-participant validation, confirmation creation, and a service-only match-creation function. Existing two-person records are preserved.

Validation: npm run check includes PostgreSQL tests for two-, three-, and four-person matches, duplicate fighters, active-match conflicts, offer availability, all confirmation responses, unmatching, and function permissions. The local browser preview checks the selectors and four-person rendering; it uses sample data.
