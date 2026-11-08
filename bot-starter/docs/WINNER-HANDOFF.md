# WINNER handoff

Active project: /Users/jayesquivel-savage/WINNER. Bot: winner, ID307. Dedicated fresh private GitHub repository requested by the user. New repository contains a source snapshot, no old account credentials, telemetry or Git history. Original /Users/jayesquivel-savage/scrabblebot remains separate.

Default gameplay optimized.json is preserved; endgame-candidate.json remains disabled after an inconclusive earlier experiment. New account has no live baseline yet. Fresh 400-game synthetic baseline is documented in reports/WINNER-BASELINE.md, not a live performance claim.

Fixes: account-scoped credentials/data/reports, strict public name/ID validation before persistence or play (also pre-auth reconnect), provenance-tagged public snapshots, serial bid cancellation, accurate pending/acknowledged price inference, native connection recovery and replay guards.

All tests use fixtures/simulations and open no live bot socket. Run npm test, npm run test:collector, build, reducer integration, startup and reconnect before changes. New strategy experiments must compare with the actual optimized current policy using fresh held-out seeds; no automatic deployment.

Keep user tokens out of chat and Git. The supplied credential was not copied into this repository. First live launch requires a replacement credential supplied locally, as described in the root README. Subsequent launches use .token-winner.
