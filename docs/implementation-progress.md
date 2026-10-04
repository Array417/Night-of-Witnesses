# Room, card and voice implementation

Approved brief: user-provided implementation plan, 2026-10-04.

Ruling: work on codex/room-cards-voice in the existing clean checkout so the user's running project receives the changes directly; no extra worktree or approvals needed.

Tasks: leave lifecycle; TURN and voice diagnostics; pointer drag; persistent menu and centering; 17 generated illustrations; regression checks and review.

Baseline native WebRTC test passed before changes. Cross-network production verification remains dependent on deployment and router configuration.

Implemented: lobby leave with seat/token removal and host succession; lost-acknowledgement reconnect recovery; opaque original-node pointer drag (mouse/touch/Guest Room, cancel and rerender cleanup); persistent Menu controls; safe vertical centering; role/location/back art consumers; truthful per-peer voice state, playback recovery, sender failure and enable-cancellation fixes; coturn profile and five-hour signed credentials.

Review: two issues reproduced and corrected (obsolete mic enable stopping a newer stream, and room closure missing active drag cleanup). Regression tests cover both.

Verification so far: TypeScript check and production build pass; 131 unit/integration tests pass; desktop core suite 28 passed / 2 device-specific skips; mobile Menu/discussion/room/results suite 18 passed. Native WebRTC receives real tone with mic off on listener, respects gain/mic toggles, reconnects and tears down after discussion.

Live HTTPS/WSS probe found zero ICE servers and the old server rejecting leave. Docker Compose configuration validates, but Docker Desktop daemon is unavailable on this host. No production update or public TURN relay acceptance has been performed. Deployment steps are in voice-deployment.md.

Art: all 17 new original-style illustrations are delivered as WebP (~1 MB total). Full prompts and reference provenance are saved in card-art-prompts.json and public/art/README.md. Images decode successfully in both desktop/mobile Chromium; hand cards, detail and result views were inspected at 375/768/1280px. Older graphic-novel assets are not shipped.

Full browser regression: 150 passed, 8 skipped, 8 failed. The failures exposed two additional integration issues: drawer state/CSS diverging at the viewport boundary, and an empty persistent voice alert colliding with form alerts. Both corrected; all 46 tests in the affected files passed on the fresh build, including every formerly failing case, artwork integration and the new 768px drawer regression.

Final focused visual/media verification: 14 passed across both browser projects, covering all artwork, six-player responsive seating, unobscured drawer opener, opponent card backs, mobile results and native audio/reconnect/teardown. TypeScript, production build, Compose config and git diff whitespace checks pass. No outstanding local test failure remains from the reported regression cases; public relay testing remains pending deployment.
