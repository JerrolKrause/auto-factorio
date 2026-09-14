## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/windows-distribution/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§1, 8, 11–12; REQUIREMENTS: Deferred scope; IMPLEMENTATION_HANDOFF: Milestone 4. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M4, phase 18) using the smallest affected modules: scripts; launcher; mod packaging; README; CI; retention/backup controls.

**Non-Goals:** Bundled game binaries/assets, public hosting and automatic prerequisite upgrades. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Package a local Node launcher and installable mod; copy mod files to a controlled directory and let the user supply Factorio/Space Age. Use the actual repository scripts and pinned lockfile rather than inventing installer success commands.

2. Provide a release matrix for S1–S5 with reference/negative/control evidence and tested fingerprints. Public CI runs deterministic software/fake tests; licensed live tests stay local or on a suitable private runner.

3. Implement retention and disk-pressure checks around artifact references and in-progress capture. Backups use the existing consistent driver operation; no silent evidence loss or unsafe automatic fallback is acceptable.

## Risks / Trade-offs

Windows paths, native driver packaging and write permissions → exercise clean data-directory setup on Windows. Disk exhaustion → expose recording state and preserve truthful incomplete evidence.

## Migration Plan

Prerequisite: `af-17-retrospectives-branches` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Windows setup/launch/reset/control/backup smoke and all five scenario release gates pass, software commands are accurate, licenses/provenance are recorded and known model limitations remain explicit.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.