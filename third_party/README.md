# Inspected upstream sources

No FLE or Agentic-Factorio source code, blueprint, game asset or dependency is included in AutoFactorio. Ignored inspection checkouts are under `.runtime/upstream/`; they are not a build input. The bounded original-adapter decision is [decision 003](../docs/decisions/003-compatibility-foundation.md).

Inspected on 14 September 2026:

| Project | Exact revision | Applicable notice evidence | Inspected paths |
| --- | --- | --- | --- |
| Factorio Learning Environment | `e2a829d22a635a9a111d21bf5523e09e903ae145` | [LICENSE](https://github.com/JackHopkins/factorio-learning-environment/blob/e2a829d22a635a9a111d21bf5523e09e903ae145/LICENSE): MIT, copyright 2025 Factorio Learning Environment Contributors; excludes Factorio assets/code | `fle/env/tools/agent/move_to/server.lua`, `fle/env/tools/agent/place_entity/server.lua`, `fle/env/tools/admin/request_path/server.lua` |
| Agentic-Factorio | `158dee786df204cf588a3c5e5120b2dd79aab695` | [README License section](https://github.com/matteomekhail/Agentic-Factorio/blob/158dee786df204cf588a3c5e5120b2dd79aab695/README.md#license) states MIT. Full tracked-tree search found no LICENSE, COPYING or NOTICE file. This is unresolved notice evidence for copying, not a claim of licensing permission. | `docs/PROTOCOL.md`, `mod/agentic-companion/scripts/actions/walk.lua`, `actions/build.lua`, `actions/build_plan.lua`, `scripts/tasks.lua`, `scripts/companion.lua`, `settings.lua`, `control.lua` (action paths relative to the mod's `scripts/`) |

Reproduce revision inspection with `git ls-remote <repository-url> HEAD`, then inspect the exact pinned revision above rather than assuming a later HEAD is equivalent. The action findings and benchmark exclusions are recorded in decision 003. Future code reuse must preserve applicable full notices and resolve ambiguous notice coverage first. The npm dependencies retain their own notices in their packages and exact resolutions in the lockfile; this document does not relicense them or the proprietary Factorio installation. AutoFactorio's project license remains unselected.
