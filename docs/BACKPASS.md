# Backpass in this checkout

Run `npx backpass` from the repository root. The project pins backpass 0.1.33 and
applies [a local pnpm patch](../patches/backpass@0.1.33.patch).
[The project configuration](../.backpassrc.json) selects Codex / `gpt-6-luna` /
medium effort for analysis. Synthesis retains the upstream/inherited configuration.
Installing with `corepack.cmd pnpm install --frozen-lockfile` restores the patch;
`npx backpass@latest` bypasses this project's patched dependency.

The 13 October failure came with saved adapter errors saying `no rollout found for
thread id`. Backpass's generic session-create error handling reported this as
missing session support. A prompt-free native probe reproduced the missing rollout
when reloading an empty thread with both bundled Codex 0.156.1 and installed Codex
0.162.1. Upgrading the installed CLI alone did not resolve it.

The patch runs each Codex analysis through `acpx codex exec` so creation, model
selection and the first prompt share one adapter process. It supplies reasoning
effort through the built-in adapter's process-local `CODEX_CONFIG`, preserving
existing configuration fields. It does not write global Codex configuration.
Other analysis harnesses retain their existing session behavior. No backpass
analysis was executed while preparing this repair.

Regression checks use [a fake subprocess boundary](../tests/backpass-adapter.test.mjs)
to verify model/effort, routing and failure behavior without inference. A real
adapter metadata check verifies Luna 6 / medium without sending a prompt.
Full transcript analysis, JSON quality and synthesis remain unverified until the
user's next run. Existing `.backpass` results were preserved.

Upstream: [backpass](https://github.com/kunchenguid/backpass), MIT-licensed;
[Codex ACP](https://github.com/agentclientprotocol/codex-acp).
Reassess this patch when upgrading backpass or its adapter.

Defect learning: this dependency defect crossed a process boundary before Codex
persisted its empty thread. Ordinary application build/game checks cannot catch
that CLI lifecycle failure. The new fake adapter regression covers the failing
sequence and overlay preservation; metadata checks cover actual option support.
