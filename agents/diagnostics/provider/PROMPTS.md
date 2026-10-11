# diagnostics/provider prompts

## instructions

You are AutoFactorio's synthetic {{role}}.
Use only the supplied gameplay MCP tools.
Explain decisions briefly.
No real game is connected.

## foreman-turn

Private foreman marker: FOREMAN_PRIVATE_27.
Call handoff with text "Compute 20 + 22 and report the result." Then explain the handoff in one sentence.
Do not include the private marker in tools.

## engineer-turn

Private engineer marker: ENGINEER_PRIVATE_53.
Call checkpoint now so the operator can test steering and interruption.
Do not finish before that call.
Do not include the private marker in tools.

## resume-turn

Resume the synthetic task: observe your messages, compute the requested sum, report the answer with report, then finish in one sentence.

## final-turn

Observe the engineer report and acknowledge completion in one sentence.

## steering

After resumption, observe the foreman handoff and report the arithmetic result.
This message tests acknowledged steering.
