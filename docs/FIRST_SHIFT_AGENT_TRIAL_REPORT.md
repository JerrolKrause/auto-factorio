# First Shift agent trial report

Observed 16–17 September 2026 on Windows against Factorio/Space Age 2.0.77 and managed ChatGPT `gpt-6-astra` at low effort. Phase 12 passes its integration gate through complete trial evidence and an explicit bounded unsuccessful model outcome; neither inference run reached the S1 evaluator. Deterministic S1 correctness remains established separately by the passing reference and controls.

## Declared plan and provenance

Trial plan `s1-trials-v2` declares one unassisted team exercise with a fresh engineer context and one separately assisted team exercise. Each run permits 30 admitted turns, 90 seconds and 20 attempted tools per turn, concurrency ceiling two, 45 wall minutes, 30 game minutes and 600,000 reported cumulative tokens. The scheduler ran roles sequentially. Token enforcement uses provider telemetry after admitted work, so a final turn may carry the observed total beyond 600,000; no later turn is admitted.

Both retained v2 exercises pin fixture `ac4949f698744a005323b2fa1c63d36818d46c3446355f9866e0e9e6535bfe1e` and reference result `e8e03a68b2565127411dcc9344392d6893f6de36665f1e7a58af05ae76d0c0c2`. The reference passed 9/9 checks and the large-ledger pause/recovery check. Foreman instructions hash to `a96dba63fec0468ee1a09a8994081833496eb0faa15b5862ecaff0bfcc6ffa0a`; engineer instructions hash to `25a21f3ca28a2756ecf0d2ee17c8f0c647df52f96c79f37923b127ab7334ea47`. Manifests retain the complete reference source hashes and control-result checksums.

## Attempts and outcomes

| Attempt | Kind | Inference and usage | Outcome |
| --- | --- | --- | --- |
| `run-p3vB61` / `ec714fe8-48c7-4af1-9e43-6b52841aab3b` | Unassisted preflight | 0 turns; token usage unavailable because no session produced usage | Provider/game preflight passed and shut down with confirmed cancellation. |
| `run-HTzqN0` / `9c308adb-6ddc-4a63-8130-df5343490ba2` | Unassisted v1 | 0 turns; no reported usage | Integration failure: an empty catalog-only preflight thread was resumed even though Codex had no rollout. The defect was fixed and regression-tested; this is not a model outcome. |
| `run-sUy5Mj` | Reset/readiness attempt | No inference | Reset failed readiness before a trial manifest was created. Retained as operational evidence, not a trial result. |
| `run-72FiKw` / `cbbe3e98-611f-493a-b2e1-4da6e87362db` | Unassisted v1 | 7 turns; 461,942 reported tokens | Software/integration abort after heartbeat/recovery behavior; no evaluator request. The replacement had no command pending at binding, so it did not satisfy the fresh-session criterion. Shutdown was confirmed; exact-profile retirement is retained. |
| `run-k1d7Mq` / `1c3e5d72-ae9d-43a2-91a6-acd315ea0583` | Unassisted v2 | 6 admitted turns; last persisted total 504,701 reported tokens; turn 6 unfinished | User-stopped interrupted exercise. Separate engineer histories, a pending `s1-input-belt-01` at fresh-session binding, preserved cumulative budget, authorized reconstruction and a fresh tick-17866 observation are retained. The command was dispatched once after observation and completed 61 steps; later `s1-assemblers-02` was partial after two steps. No evaluator was requested. Process absence was later observed, but graceful shutdown, saved final state and disappearance cause remain unknown. |
| `run-yKOGBa` / `457465e2-3c96-4006-8e03-14b5f48478a2` | Assisted preflight | 0 turns; no reported usage | Both managed provider roles passed authentication/catalog preflight. The held game stopped with confirmed cancellation and supplied the validated reset boundary for the assisted exercise. |
| `run-QPIx3a` / `ef13aee0-e262-4e61-8fe7-b75e6536f816` | Assisted v2 | 8 turns; 624,141 reported tokens | Explicit bounded unsuccessful model outcome. The final engineer turn crossed the approximate 600,000-token threshold; admission then closed, interruption/cancellation were confirmed, and no ninth turn started. Three construction commands completed or partially completed and one pending command rolled back. The evaluator was not requested. |

These attempts were retained because their failure classes differ. No automatic sequence of retries was used to obtain a passing gameplay result, no API billing or model substitution occurred, and an interrupted/software attempt is not represented as stochastic model performance.

## Fresh-session continuation

The corrected unassisted v2 exercise held the first queued construction as durable unsent intent until the replacement engineer reconstructed its authorized assignment and read fresh world state. Evidence records the old and new engineer sessions, `s1-input-belt-01` pending at binding, cumulative budget before/at binding, and the replacement observation at tick 17866. The ordinary scheduler then released that same command once. Later receipts show its 61 steps completed; this proves queued-work continuation and reconciliation, not replacement during physical execution.

The exercise ended on the user's stop request before the runner wrote `trial-report.json`. Read-only verification therefore used the immutable manifest, provider events, game trace and stop record. It passed the fresh-session criterion while preserving the missing final cleanup/evaluator facts.

## Assisted-run provenance

The operator advice was developer-selected for the declared assisted exercise, not authored by the user:

> Check inserter directions and power before requesting verification.

It was delivered to the foreman at wall time `2026-09-17T13:37:32.995Z`, game tick 8224, after turn 1. The foreman explicitly interpreted it as requiring fresh direction and power evidence before verification, linked it to task `s1-automation`, revised the committed plan, and sent `s1-power-direction-check` to the engineer. Subsequent task and provider records preserve that resulting work. One sample does not establish that the advice improved performance.

## Gate result and limits

The final software gate passed 314 tests in 17 files plus build, lint and documentation checks. The source-matched S1 reference passed 9/9 checks and a 359,059-byte ledger recovery check. Eight earlier independent review rounds found five unique issues (one P1, four P2); all were fixed. Final closeout review found three further P2 failure-boundary defects. Follow-up review narrowed the cleanup defect to partial-setup resources, then found one additional P2 serialized-transport ordering issue in that fix. The final source gives acquired resources reverse order, idempotent cleanup with recorded outcomes and routes failure holding through the shared RCON FIFO; focused regressions cover partial setup and an in-flight poll. All nine unique review findings are fixed, none were rejected or remain, and the final source-matched review has no findings. Final trial-evidence verification first returned a failed exit interpretation, which the author rejected against the literal design rule; a new narrow contract then passed the complete-evidence-or-explicit-bounded-model-failure gate. Evidence is retained in `.runtime/phase12-final-verification/`, `.runtime/phase12-exit-verification/`, `.runtime/phase12-final-review/` through `.runtime/phase12-final-review-4/`.

The result establishes visible, separately scoped provider roles, assistance provenance, durable fresh-session reconstruction, bounded admission, honest failure classification and confirmed assisted-run shutdown. It does not claim that Astra completed S1, that the hint caused improvement, or that token counts map exactly to subscription allowance. Browser screenshot inspection was unavailable; authenticated dashboard data and provider activity were retained, so visual presentation remains unverified. Full private run logs, credentials, saves and provider transcripts stay in ignored project runtime data.
