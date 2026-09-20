# Decision 018: Visible default and workshop observability

## Decision

The supported `npm start` path launches a project-owned dedicated server and a visible Factorio client, waits for the connected `builder-1`, then reports the browser dashboard ready. Headless operation remains available only through the explicit `--headless` flag or `AUTOFACTORIO_HEADLESS=1`.

Legal-character workshop admission checks the connected builder during preflight, before any provider inference. Direct construction remains valid in headless mode. Missing character readiness is an actionable launch rejection and consumes no model turn.

Workshop preflight, provider invocations and game build/measurement operations publish bounded structured activity into the durable operator journal. Raw provider transport events remain in the ignored local evidence stream; the dashboard exposes phase, terminal failure reason, role, usage and external-operation outcomes without promising hidden reasoning. A definitively failed effect is persisted as `failed`; an uncertain effect remains `unknown` and holds the session. The selected workshop session in the evidence inspector follows durable updates instead of preserving the initial launch response.

## Rationale

The initial user experience is intended to be watched. A headless default concealed that Factorio was healthy and allowed Legal character to reach inference before discovering that no player actor existed. Visible readiness and pre-inference admission align startup behavior with character construction, while the explicit headless option preserves automation and direct-workshop use.

## Operational constraints

- Never stop or reuse an unrelated personal Factorio client. Observer discovery and cleanup remain restricted to project-owned profiles.
- A supplied profile reuses its matching observer. AutoFactorio cleans up only an observer it launched itself; ownership of the supplied server remains with its caller.
- Workshop launch returns HTTP 202: durable acceptance, not completion. Later failure remains prominent in the live row, activity history and evidence inspector.
- Provider prompts, credentials and hidden reasoning are not copied into public activity records.
