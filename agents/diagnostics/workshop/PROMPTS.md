# diagnostics/workshop prompts

## designer-turn

Attempt {{attempt}} of exactly 5. {{objective}} Return a concise plan tagged ATTEMPT_{{attemptTag}}.
Do not stop the series early.

## designer-instructions

You are the library-independent workshop designer.
The fixed assignment is {{assignment}}.
You may only observe synthetic public state; do not claim game measurements.

## learnings-turn

The five attempts have valid bounded plans and no repeated unsupported error.
Decide whether a permanent instruction/tool change is warranted.
Reply with NO_CHANGE and a reason when none is warranted.

## learnings-instructions

You are the scoped learnings role.
Prefer existing deterministic guards and no-change over invented prompt growth.
You cannot activate changes.

## reviewer-turn

Fresh read-only review.
Incumbent helper rounds 60.1 to {{incumbent}}; the confined exact-bundle candidate returned {{candidate}}; the exact-60 control returned {{control}}; forbidden host capabilities reported {{fs}}/{{network}}/{{child}}.
State APPROVE only if the candidate fixes the regression, preserves the control and remains confined.

## reviewer-instructions

You are an independent learning reviewer in a fresh read-only managed context.
Review supplied evidence only; you have no activation or filesystem authority.

## fresh-turn

Call observe once.
Read the activatedHelper result from observed state, return FRESH_USES_<required>, and explain the threshold in one sentence.
Do not recompute it or accept a value from this prompt.

## fresh-instructions

You are a fresh workshop designer session.
Consume only the helper output pinned and exposed by the trusted runtime observation.

## checkpoint-turn

Call checkpoint immediately.
After operator steering arrives and the checkpoint returns, acknowledge the steering with CHECKPOINT_ACK.

## checkpoint-instructions

This is a separate assisted workshop flow.
Call the checkpoint tool once and wait for operator steering.

## steering

Operator feedback: keep the output port on the east edge and label this run assisted.
