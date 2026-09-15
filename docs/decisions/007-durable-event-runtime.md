# 007: Durable event runtime and conservative receipt recovery

Status: phase 05 implementation. Exact gates and remaining limits are recorded in the [handoff](../IMPLEMENTATION_HANDOFF.md). Requirements R11, R14 and R16 remain unchanged.

## Storage boundary

Use the already pinned Windows-tested better-sqlite3 13.0.3 driver. One runtime connection owns a local database, WAL and projection reads; exclusive SQLite locking prevents a second runtime writer and releases on process death. FULL synchronous commits, a versioned migration and append-only SQL triggers protect event history. Each event has a monotonic sequence, schema version, run/epoch, independent clocks, actor/task, causation/correlation and explicit visibility. A transaction inserts the event, all affected projection rows and any command outbox row together. Rebuild applies only versioned recorded projection changes, with no game or model calls.

The core execution port imports no SQLite, RCON or provider implementation. `apps/runtime/durable-runtime.ts` composes the journal, artifact files, existing budget controller and existing game/lifecycle adapters. Run manifests, task ownership, plans, messages and expenditure are authoritative independently of provider transcripts. This phase adds storage for the current contracts; it does not add scheduling, a dashboard or general ownership fencing.

## Dispatch and replacement

Commit command intent and its pending outbox before dispatch. Commit the sending boundary before entering the game transport. A transport error or database acknowledgement failure leaves an unresolved command. Every replacement closes admission and consults the current game ledger. An absent receipt after possible dispatch is unknown, including across mismatched epochs; it blocks conflicting work. A never-sent intent remains distinguishable from a possibly executed command.

The phase 04 neutral/disarmed/pause and explicit reconcile/arm protocol remains authoritative. A verified managed checkpoint supplies the rollback ledger, so newer database receipts cannot invent effects in its older world. Retain superseded intents and receipt history as evidence; fresh authorization uses a new command identity. There is no automatic replay of suspended or rolled-back work.

Budget mutations persist before admitted work or stop callbacks escape the controller. Replacement retains cumulative turns, tool attempts, elapsed time and deduplicated reported usage; it also accounts for the interval since the last durable budget update. Unfinished provider turns remain closed with unconfirmed interruption/cancellation until separately reconciled. The probe uses synthetic counters and consumes no model inference.

## Evidence and backups

Write immutable UUID-addressed artifact bytes, flush them, then commit checksum/size/media type/purpose/visibility references. A crash can leave an unreferenced file, never a successful reference to a partially written payload. The observation helper returns exactly its recorded sanitized agent response; richer operator telemetry has a separate operator artifact. Credentials supplied by the composition root and recognized credential fields/forms are redacted before event or JSON artifact persistence. Binary managed save payloads remain operator-only.

Every referenced payload is checksum-checked on recovery. Missing or corrupt evidence is explicit and prevents a complete recovery/checkpoint claim. Visibility metadata and scoped artifact reads are present; the general authenticated history/search/context service remains phase 08. These operator-internal journal/projection APIs must not be exposed as gameplay archive tools.

The driver's online backup operation captures database/WAL state while the single writer accepts event production. Open that completed database snapshot to enumerate its artifact references, copy verified immutable bytes, and publish a manifest with its event cursor and completeness. Missing payloads make the bundle explicitly incomplete. Copying the live main database alone is never the backup path. Retention/garbage collection, branch navigation and disk-pressure UI remain later phases; evidence is not automatically deleted.

## Validation

Deterministic checks exercise transaction failure, abrupt process exit before projection and after commit, single-writer exclusion, append-only protection, rebuild equality, send/acknowledgement boundaries, unknown receipts and epochs, artifact visibility/redaction/integrity, model-independent budget recovery, and online backup with event production. The live probe kills a separate Node runtime after a real chest placement but before durable acknowledgement, then reconciles the receipt and inventory debit. It captures and reloads a managed held checkpoint, verifies rollback against the saved ledger, and requires explicit re-arm plus fresh intent. See the handoff for executed results; a successful compiler or fake test alone never passes that live gate.
