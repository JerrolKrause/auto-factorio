# Workflow diagnostics

These are advanced, task-owned diagnostics. Ordinary startup remains `npm start` at localhost:3000. Install pinned dependencies and build before TypeScript probes. Preserve personal saves and existing servers; the probes refuse an unrelated project server and never stop it to make room.

## Operator recovery

`corepack.cmd pnpm operator:recovery-smoke` starts two isolated headless profiles sequentially and drives the real dashboard in installed Edge. It uses the same startup reconciliation as `scripts/dashboard.ts`, the real game control barrier, fresh-process receipt and production HTTP admission. Native and imported blocked owners must remain held on the same world, then disappear from the actual owner banner only after fresh-world attestation. The successor resolver deliberately fails before inference. Reopen/reimport, replay, original save/journal/budget hashes and exact profile cleanup are recorded under `.runtime/operator-recovery/`. This is admission evidence, not a successful workshop. Keep the unit source/registration/receipt matrix and focused browser regressions alongside it.

## Mechanical handoffs

Prepare assignments with `dev:contract prepare` and validate them before dispatch. Then generate the worker's draft:

```powershell
corepack.cmd pnpm dev:contract scaffold --assignment .runtime/task/assignment.json --output .runtime/task/result-draft.json
corepack.cmd pnpm dev:contract validate-return --assignment .runtime/task/assignment.json --result .runtime/task/result.json --events .runtime/task/returns.jsonl
node scripts/check-agent-contract.mjs .runtime/task/assignment.json .runtime/task/result.json --check-source --require-ready
```

The draft copies immutable identifiers/fingerprints and supplies version-correct fields; it starts blocked, unstable and unverified. Workers author observations, findings and final source stability. A structurally valid finding report may be returned without being ready. Reviewers remain read-only and return JSON for the author to persist unchanged. The final readiness check still requires independent current-source checks and the author's coverage judgment. `--events` records actual validation attempts, including malformed reports; local report-format failures measure correction rounds without inferring them from subprocess exit codes. Use one writer per event stream and retain failed attempts.

## Mutation proof

`corepack.cmd pnpm dev:mutation .runtime/task/mutation.json` accepts:

```json
{
  "source": "scripts/dev/example.mjs",
  "sha256": "replace-with-current-source-sha256",
  "mutationFile": ".runtime/task/mutated-source.bin",
  "tests": ["tests/example.test.mjs"],
  "testName": "exact named regression",
  "diagnostic": "expected assertion diagnostic",
  "timeoutMs": 30000,
  "exclusiveSourceAccess": true,
  "outputRoot": ".runtime/task/mutations"
}
```

Stop reviewers/verifiers before declaring exclusive source access. Do not start readers until restoration finishes; the helper also owns the shared `source-access` lease. Arguments are passed as arrays; Vitest JSON must contain executed assertions and the expected failed assertion. Zero selection, import/runtime errors, wrong failures and timeout are distinct non-passing results. Exact original bytes are saved and restored in `finally`, then the focused test must pass. Concurrent source drift refuses overwrite and leaves the backup for explicit reconciliation. Do not run a mutation during another verification or review. Reuse broad evidence only when restored dependency hashes match.

## Consumer and telemetry readiness

Run `corepack.cmd pnpm dev:consumer --loaded-root <root-of-loaded-skill> --loaded-version <loaded-version>`, optionally adding `--events .runtime/task/returns.jsonl`. Never persist a personal cache path in repository configuration. The diagnostic uses the explicit supported root override regardless of coinstalled providers, checks manifest version, profile sections/placeholders, expected scopes with LF and CRLF, and managed ChatGPT verification availability without inference. Unsupported CRLF parsing has the existing LF attribute workaround. Codex worker-hook enforcement remains unsupported until [upstream issue 75](https://github.com/JerrolKrause/agent-graph/issues/75) supplies an attested implementation. A ready dispatch check does not label unsupported telemetry or hooks healthy.

Interactive evidence uses the existing `appendEvent` / `dev:report` producer and reader plus validated contract, review and recovery artifacts. Return-attempt records link the source revision/fingerprint, guard, validation layer and report hash; detailed observations retain evidence references. Selected local streams distinguish unconfigured, failed/corrupt, empty and healthy. Empty or unavailable sources cannot imply zero escapes, healthy trends, total run counts or token savings; usage stays unknown.

Graph records writes require the orchestrator-owned sink. Graph records reads and scoreboard inputs require the approved records reader/artifact map, real producer records and citation tally. This interactive integration explicitly reports graph read/write and scoreboard **unsupported** with remediation. It does not install an arbitrary sink, invent graph records or create empty tallies. A graph producer-to-scoreboard round trip remains an upstream integration check; the local event round trip is a separate supported path. Once upstream releases the capability, adopt and validate its provenance/schema rather than duplicating the orchestrator here.

## Windows environment

`corepack.cmd pnpm dev:environment <current-private-sandbox-log>` reads at most the final MiB and emits only known signature counts and bounded metadata. An ACL setup failure occurs before application execution. The report leaves the underlying permission cause unresolved and recommends user/admin inspection of the specific private-log paths. The supported fallback is scoped `require_escalated` review for already-authorized work. No tool changes ownership, ACLs, Git trust or prerequisites. Keep the current failure distinct from historical owner incidents.

## One bounded gameplay trial

After deterministic verification and review, run `corepack.cmd pnpm workshop:default-trial --live --codex <absolute-managed-executable>`. This spends included managed usage: Astra/low only, one attempt, eight minutes, six turns, 24 tool calls, 60,000 reported tokens and 18,600 game ticks. The default brief is “create 15 green circuits per second”, starter assembly, direct construction, 600 settling ticks and five 3,600-tick windows. Library access and learning are disabled for this isolated validation; it is not a full run of all UI defaults.

The production HTTP/runtime path owns execution. Console and a task-local dashboard show live public activity. The probe records design/build/evaluation/final state, preserves its final save and unknown effects, then checks successor admission without a second inference. Held ownership requires an attested fresh game before retirement. Evidence and cleanup stay under `.runtime/default-workshop-trial/`. A successfully recorded trial can have no valid design; report API success, fuel/port feasibility and target throughput separately. No open-ended retry or model/billing fallback is permitted.
