# Decision 009: durable agent coordination

Date: 16 September 2026. Scope: phase 07, `af-07-agent-coordination`.

The coordinator composes the existing SQLite journal, budget, durable command outbox and acknowledged ownership controller. Stable instances retain their role definition, instruction text, permitted tools/observations, actor permissions and provider-session lineage. Team and solo use the same contracts; a bodyless synthetic specialist exercises extension without changing coordination. Definitions pin the already-tested Astra/low configuration; there is no provider fallback.

Task revisions are immutable commitments in event history. Revision changes immediately invalidate scheduler admission; the pump acknowledges old ownership release before granting replacement work. Dependencies and parent links reject cycles. Message delivery and assignment share one journal transaction; duplicate IDs must carry the same envelope. Runtime-issued gateway credentials bind instance, provider session, generation, epoch and admitted turn. Credentials are ephemeral and never persisted. Restart reconstructs graph, messages and histories, while interrupted turns require reconciliation and spent budgets remain spent.

Completion criteria currently verify either a completed command receipt for the current task/revision/epoch or delivery of a specified scoped message by the task owner. Message delivery proves communication only; it is not evidence of production. Scenario measurements and scoring belong to later phases. Claims without the exact qualifying evidence cannot enter verification. Managed epoch changes require revised assignments and invalidate old succeeded dependencies.

The deterministic pump handles message delivery, dependency waits, grants/revokes, receipt reconciliation, command dispatch and failure transitions. It preserves intent order within the existing conservative single execution lane. A failed batch fences its queued remainder. Run exhaustion closes admission synchronously; provider interrupts are requested without blocking game cancellation. An unconfirmed revoke holds resources and retries its durable request ID. Host code can run the pump on a bounded timer and surface errors; it never invokes a model to poll.

Exact tool inputs/results remain in durable per-agent history. Observation responses omit prior response records to prevent recursive expansion; authorized observation groups further restrict returned sections. Full paging, retrieval and context-size controls remain phase 08. The new gateway is a programmatic runtime boundary exercised with synthetic sessions; the phase 02 synthetic HTTP MCP probe remains separate. No live provider-backed gameplay or new model trial is claimed in phase 07.

Validation and failed-trial evidence are recorded in the [implementation handoff](../IMPLEMENTATION_HANDOFF.md). Initial roles are described under [agents](../../agents/teams/README.md).
