# WINNER baseline and validation

WINNER is a fresh account: public name `winner`, ID `307`. No live results are claimed by this report. The optimized gameplay policy is the starting baseline; previous account performance is not transferred as WINNER evidence.

## Fresh synthetic baseline

| Field | Games | Mean score | Win rate | Invalid actions | CPU deadline misses |
|---|---:|---:|---:|---:|---:|
| strong | 200 | 80.905 | 24.0% | 0 | 0 |
| mixed | 200 | 128.480 | 98.5% | 0 | 0 |

Version: `sustainable-integer-v2-1a9f6cb84050`. Seed base: `258584107`. Source remained stable. Full seeds and metrics: [baseline.json](bots/bot-winner/baseline.json).

These 400 games exercise the current policy against synthetic opponents. They do not measure live network performance, establish strategy superiority, or promise a live win rate. No profile was promoted.

## Correctness and isolation

- New account cannot load the old account fallback token. Public name and ID are verified before saving credentials or joining games, including a disconnect before first authentication.
- Default play and watcher commands select winner/307. Credentials, telemetry and reports are stored separately. Public snapshots carry bot and venue metadata, checked before import and cache reuse.
- Existing safe reserves, serialized bid cancellation and native connection recovery are included. A rejected experimental endgame candidate is retained only as an opt-in profile.
- Fresh build and all 57 unit tests passed. Three collector fixtures, five real-reducer integration tests, socket-disabled startup, and pre-auth plus repeated reconnect tests passed. Source review has no unresolved important findings.

A former comparison test was sensitive to the six-millisecond production search budget under test-process contention. Its policy-equivalence fixture now uses a generous test-only budget; production decision budgets are unchanged.

## Live baseline

Run a single WINNER process and the public-result watcher from this repository. Collect 20–30 completed games before diagnosing strategy weaknesses; use version-attributed runtime traces to distinguish invalid actions, connection issues, acquisition quality and word timing. Test any subsequent candidate against this exact baseline on disjoint fresh paired games.

No live bot was started or stopped while preparing this repository. Personal credentials, environment files, previous match records and previous Git history are excluded from publication.
