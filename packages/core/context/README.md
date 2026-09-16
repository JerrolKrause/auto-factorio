# Bounded gameplay context

Read [Decision 010](../../../docs/decisions/010-bounded-context.md) for policy and tradeoffs, and the [capability spec](../../../openspec/specs/bounded-context/spec.md) for required behavior. [Context tests](../../../tests/context.test.ts) exercise authorization, revocation, bounds, replacement and current recipe availability.

| Entry point | Responsibility |
| --- | --- |
| [CoordinationGateway](../../tools/src/coordination.ts) | Authenticate tool calls; finish asynchronous results before closing attempt accounting. |
| [AgentContext](service.ts) | Build bounded briefings/detail/world responses; record the exact delivered observation. |
| [ContextArchive](archive.ts) | Authorize current records before search/counts/pages; filter references and retain transitive sources. |
| [permits](authorization.ts) | Evaluate one visibility label; independent source labels must all permit access. |

When adding reference fields, update both projection filtering and provenance recognition; test access revocation after facts have been flattened into text. When changing replacement composition, retain component continuations and record only the final delivered composite. Local comments explain these constraints at the relevant branches; avoid copying the full policy into each file.
