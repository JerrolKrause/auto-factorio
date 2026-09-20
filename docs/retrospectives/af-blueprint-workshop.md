# Blueprint workshop implementation retrospective

The implementation completed successfully at commit `970303fc9346d58da9966699b1b8b6e7b0a2fb3b`, with all 27 tasks, 415 tests, three browser flows, direct and character game probes, strict OpenSpec validation and clean project-process cleanup. Eight corrective review rounds found 30 unique issues (22 P1 and 8 P2); all were fixed, none were rejected and no actionable finding remained.

The apply was safe but inefficient. One candidate covered 25 requirements, 41 scenarios, three capabilities and 73 files. Component and fixture checks passed before the real dashboard composition could complete the workflow. Later reviews repeatedly exposed the same classes of boundary error: permissive or racy cancellation acknowledgement, split ownership of aggregate inference budgets, delta/effective learning-bundle confusion, fixture/production composition drift and stale completion status.

Durable corrections now live in the repository:

- External provider/game effects use the shared strict effect receipt contract. Missing, malformed, mismatched, contradictory or negative evidence remains unknown and holds recovery.
- Workshop inference uses one aggregate admission owner that partitions turns, tools, elapsed time and finite reported tokens before an adapter can start a provider turn.
- Learning assembly uses one canonical effective bundle containing cumulative files, controls, behavior classification and hash input; pinning rechecks the exact hash.
- The dashboard and acceptance tests use one production workshop composition root.
- `change:ready` checks a tracked acceptance map, vertical slicing, production entrypoints, effect recovery, ready source-matched verification/review contracts, task completion and handoff markers.
- The lifecycle reserves `final` for a reviewed-clean candidate, while this document retains review history outside the current implementation entry.

Future changes spanning more than two capabilities or four integration boundaries must use independently accepted vertical slices. Each effectful scenario needs negative and recovery cases before its slice closes. Verification remains evidence for its assigned coverage; it is not a substitute for production composition or independent review.
