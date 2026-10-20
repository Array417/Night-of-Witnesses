# Native execution ledger — plan: docs/superpowers/plans/2026-10-20-accounts-public-lobby.md

Approved spec: docs/superpowers/specs/2026-10-20-accounts-public-lobby-design.md

Ruling: Work in the user's specified checkout without creating a branch or commit, as the approved plan explicitly requires. The current branch is master; all changes remain reviewable and uncommitted.

Ruling: This Windows checkout has no usable Docker Engine. Write executable tests before implementation and attempt their Docker commands; continue independent implementation while keeping validation explicitly pending. Do not use host npm/Node/Python as a substitute for the project's Docker-only workflow.

Ruling: Use this durable ledger rather than POSIX skill scratch scripts on Windows; preserve it because no commits are being created.

Pre-flight: Tasks 1→2→3→4 share PostgreSQL, opaque sessions and transaction boundaries; one shared api.database connection helper, no ORM.
Pre-flight: Tasks 4→5→6 share internal API payloads; Node uses native fetch and explicit service authentication, never a browser-supplied identity.
Pre-flight: Tasks 5→7→8→9 share GameClient and projections; React owns subscriptions and view lifetimes.
Pre-flight: Tasks 1–9→10 share Compose dependencies; verification requires the Docker Engine named pipe to be available.

Baseline: docker info failed: dockerDesktopLinuxEngine pipe does not exist. No baseline test result claimed.

Environment update: user started Docker Desktop; approved Docker commands can now reach the engine. Baseline Node tests: 137 passed, 1 skipped, 0 failed. FastAPI/PostgreSQL tests: 10 passed. Public room/queue/persistence tests: 4 passed after observed missing-method/module failures.

Ruling: Keep backward-compatible playerName arguments and optional account metadata in the pure RoomManager API so existing rules/transport harnesses remain useful. The production entrypoint always requires AccountService and ignores client-supplied names in favor of the authenticated account. No environment flag exposes anonymous production play.

Ruling: A durable-start timeout keeps the lobby visible and retains a pending candidate/match UUID for idempotent retry. Lobby membership changes are blocked until the start is resolved; this prevents a committed-but-unacknowledged start from becoming a second match.

Tasks 1–10: implementation in progress; automated verification pending Docker availability.

Verification update: 13 PostgreSQL/API tests pass, including atomic rollback, immutable migration checksums, real session/reset semantics, idempotent results and all six match outcome states. Node regression: 142 passed, 1 skipped before the latest targeted proxy/Unicode checks; TypeScript passes.

Browser update: Desktop/mobile registration, private creation, public joining/reconnect and reset entry links pass. A real desktop three-player game completed and saved exactly one result for each account. Card detail lifetime regression reproduced in the original full-game test and corrected by resetting selection on hand/phase/actor changes rather than every animation version.

Ruling: Keep password-reset responses identical even when SMTP delivery fails, to avoid revealing which addresses exist. Missing SMTP configuration returns the same unavailable response for every address; actual delivery failure is recorded without tokens or email contents. Operators inspect Mailpit/SMTP logs for delivery failures.

Ruling: Normalize nickname length in both services to Unicode codepoints rather than JavaScript UTF-16 code units. A 24-emoji nickname reproduced the mismatch; the room/schema regression now pins the shared behavior.

Task 1: implemented and verified — migration repeat/checksum/rollback tests pass against isolated PostgreSQL 17.
Task 2: implemented and verified — player/admin separation, seed idempotency, hashing, cookies, CSRF and expiry covered by API tests; real seeded admin browser login passes.
Task 3: implemented and verified — reset single use/expiry/revocation API tests and real Mailpit delivery/new-password login pass on desktop/mobile.
Task 4: implemented and verified — authenticated history, no-winner/idempotent result and six-state statistics tests pass.
Task 5: implemented and verified — public filtering, account-bound reconnect, anonymous/revoked socket rejection and safe HTTP proxy checks pass.
Task 6: implemented and verified — durable-start retry preserves match UUID; queue recovers after errors; real 3-player desktop/mobile games record exactly one match per participant.
Task 7: implemented and verified — React/MUI auth/navigation, clean TypeScript check and browser authentication flows pass.
Task 8: implemented and verified — React lobby/table/draft/discussion/voting/results complete two real games; original Node voice/rules tests pass. Pointer logic preserves the original DOM node instead of reparenting a React-owned card.
Task 9: implemented and verified — real zero/populated statistics, default-private creation, public joining, reconnect, history and separate admin overview browser checks pass.
Task 10: local Compose healthy; development and production Compose configs valid; 144 Node tests passed, 1 optional TURN-container test skipped; 13 API tests passed; 12 desktop/mobile acceptance tests passed; TypeScript check passed. Production image build and independent review tracked below.

Ruling: Consolidate the planned scenario names into focused runnable tests and full real-game journeys instead of duplicating a test per internal implementation detail. This keeps existing regression coverage while exercising the actual HTTP/DB/WebSocket/browser boundaries.

Final independent Native review: no Critical findings; seven Important findings. Runtime fixes address deduplicated rematch/start side effects, serialized abandonment before the next start, account-row locking across login/reset, signed per-client IP forwarding (including Caddy), queued socket-close cleanup, and persistence-safe capacity eviction. Six Node regressions and a controlled PostgreSQL concurrency regression first failed, then passed after these fixes; proxy tests likewise reproduced shared-IP limits before the signed-forwarding fix.

Review coverage ruling: retire anonymous-home and exact old drawer/animation geometry assertions rather than force old DOM into React. Migrate shared authenticated game helpers and preserve focused native WebRTC, keyboard/pointer/touch, privacy, reconnect, six-player responsive and reduced-motion coverage alongside account acceptance in the default browser command. The legacy suite remains explicitly opt-in and is not claimed green.

Post-review verification: 151 Node tests passed, 1 optional TURN-container test skipped; 16 API/PostgreSQL tests passed; TypeScript passed. Development stack rebuilt healthy. Production images built successfully before review; final-source rebuild and expanded browser regressions pending below.

Final verification: default browser command completed 24/24 desktop/mobile cases in 2.9 minutes, including real registration/private/public rooms, result persistence/rematch, Mailpit reset, admin isolation, keyboard focus restoration, native mouse/touch drawing and transfer, six-player layouts/privacy/reconnect, and native WebRTC bytes/energy/gain/mic-stop/re-offer/phase-exit disposal. The native touch draw test first failed because browser panning cancelled the gesture; applying touch-action:none to the draw pile made it pass. Public-directory requests now cancel obsolete/manual/background/unmounted work, with a controlled completion-order browser check.

Final-source TypeScript check and production Node/FastAPI image builds passed. Both Compose configs and the Caddy configuration validate. Local development remains healthy at localhost:3000 with Mailpit at localhost:8025; existing seed/migration replay is idempotent. All seven Important review findings are addressed; no additional review cycle was dispatched. No branch, commit or public deployment created. Integration ruling: leave the changes in the requested checkout as approved, rather than presenting a branch/merge menu.

Environment limits: public cross-network TURN and real external SMTP delivery are not proven by local tests. Production still requires its HTTPS origin/public URL and SMTP configuration; Mailpit is development-only. Legacy anonymous/exact-layout browser cases remain explicitly excluded as documented, not represented as passing.

## Approved follow-up: card backs, level information, shared login

User approved the bounded in-chat design: constrain all React card-back artwork and animations, explain each valid level using the actual full role pool, remove the public admin-entry/separate login form, and determine admin permission server-side through the common login. Separate account tables/sessions and existing credentials remain unchanged; no schema migration is needed.

Regression evidence: overflowing image width was 512px versus a 26px parent; the option label and public admin-link assertions also failed before implementation. Public level previews now count every setup zone from a fixed, independent preview setup, exposing counts only, not real hidden assignments. All 152 Node tests pass (one existing optional TURN skip); all 18 PostgreSQL/API tests pass, including credential-derived roles, same-email/different-password isolation, opposite-session revocation, role injection rejection and reset/login serialization. TypeScript passes.

Visual QA found a second pile defect: computed MUI position was relative rather than absolute. A new failing position/centering assertion reproduced it; the high-specificity pile rule now restores absolute positioning while retaining the final-actor Guest Room offset. Desktop/mobile full verification is tracked below.

Focused independent review found no Critical/Important/Minor issue in the approved scope. Declined items are the previous feature's broader diff, unchanged schema, credentials/traces and live deployment, all legitimately outside this follow-up. Source review does not substitute for the pending browser run.

Test-harness ruling: the enlarged browser suite creates more than 60 accounts per source in ten minutes, correctly triggering real registration limits. Do not weaken those production limits or drop scenarios. make test-e2e now runs desktop/mobile as separate batches, recreating only the development API before each batch to reset in-memory throttles, preserving database contents and sessions. This brief API restart is documented for test operators.

Follow-up final verification: make test-e2e exited 0 with 15/15 desktop cases and 15/15 mobile cases, including the new centered/contained pile, eight descriptive level options and full-pool counts, shared administrator login/reload/logout, ordinary-user denial, full games/rematches, native dragging and WebRTC. Final TypeScript check passes; all 152 Node tests and 18 API tests pass (one existing optional TURN-container skip). Final production images built successfully without deploying. Screenshots of centered piles at 375/1280px and level details on desktop/mobile were visually inspected. Local Dev services are updated; database tables, seed credentials and production rate limits are unchanged. No commit or branch created.
