# Workshop final-build evidence and operator evaluation

The user requested direct implementation without an OpenSpec change on 5 October 2026.

Each measured attempt captures its actual final surface through Factorio's screenshot API. Bounds include candidate entities and fixtures; the connected project client renders the image. The headless server cannot render images. Missing clients, timeouts and invalid images produce explicit unavailable evidence without discarding measurements or stopping design progression. Capture precedes scorer inference, so images appear in the run report before the next design. These images are operator evidence and are never supplied to gameplay models.

The runtime preserves complete PNG bytes under the run's own directory, records the image hash, game tick and capture time, and authenticates image requests through the existing local session. Historical images use the catalog's source-run identity and must still match their recorded hash. Legacy records do not acquire fabricated screenshots. The report gallery presents attempt order, measured throughput and the best eligible label; opening an image preserves the report page for comparison.

After reporting and bounded maintenance, the last measured attempt enters `observing` at the requested game speed. This is the last attempt, which can differ from the best eligible attempt. An unmeasured final rejection does not resume an older build. A plateau ends iteration normally and observes its final measured build. Fixed-window samples, eligibility and scores remain unchanged while production continues.

Observation retains workspace ownership and the operator game-control reservation. Lua records its owner, previous speed and terminal Stop so retries cannot restart a stopped factory. Stop confirms the exact observation pause, restores the prior speed and completes the already reported run; an unknown receipt retains a hold. Reconnection reuses the same observation identity. Shutdown releases the workshop reservation before requesting the ordinary operator pause. Bounded diagnostic launchers opt out and retain their automatic completion/cleanup behavior.

Acceptance covers actual graphical rendering, live authenticated browser galleries, unavailable/corrupt evidence, final-running ownership, exact Stop/recovery and Factorio speed, fixed samples and save/load. The dedicated no-inference diagnostic is `corepack.cmd pnpm game:workshop-observation-probe`; add `--observer` only with a free project graphical client. It uses separate ports and cleans only its own profile.
