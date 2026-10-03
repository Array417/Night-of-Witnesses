# Architecture: Night of Witnesses

Authoritative-server web board game for 3-6 players.
Built for private friend groups; the UI is Traditional Chinese.
One Node process serves the static client and runs the game
authority over WebSocket.
All room state is in-memory; a restart ends all active games
(see Limitations).

## Stack

- Runtime: Node.js `>= 24.12.0`, TypeScript (strict), ESM.
- Server deps: only `ws` (WebSocket) and `zod` (message validation).
  No database, no web framework, no auth provider.
- Client build: Vite (`vite.config.ts`).
  Server build: `tsc -p tsconfig.server.json`.
  Type check: `npm run check` (client + server projects).
- Tests: `node --test` over `tests/unit/**` and `tests/integration/**`;
  Playwright (Chromium) over `tests/e2e/**`.
- Deploy: multi-stage `Dockerfile` running as non-root `node`,
  with a `/healthz` check.
  Env contract (`README.md`): `HOST` (default `127.0.0.1`),
  `PORT` (default `3000`), `ORIGIN` (WebSocket allowlist,
  comma-separated supported), `RTC_ICE_SERVERS_JSON` (default `[]`,
  JSON array of ICE server configs for voice; invalid input
  falls back to no ICE servers).

## Directory structure

- `src/shared/` - Single source of truth, imported by both sides.
  - [`state.ts`](src/shared/state.ts) - `CanonicalGameState`
    (never sent on the wire) and `PlayerProjection`
    (per-viewer safe subset).
  - [`game.ts`](src/shared/game.ts) - `createGame()` / `reduceGame()`
    pure rules reducer plus the `GameAction` discriminated union.
  - [`rules.ts`](src/shared/rules.ts) - Roles, factions, levels (L1-L8),
    player locations, and seeded setup/deal tables.
  - [`protocol.ts`](src/shared/protocol.ts) - Zod schemas for every
    client/server WebSocket message, including `rtc_signal`
    (voice signaling) and the `welcome` ICE server list.
  - [`discussion.ts`](src/shared/discussion.ts) -
    `DISCUSSION_DEADLINE_MS` (15 s) plus pure consent helpers
    over the connected-player denominator: `connectedPlayerIds`,
    `hasDiscussionMajority` (strict, more than half),
    `isDiscussionUnanimous` (all connected, at least one),
    `clearDiscussion`.
- `src/server/` - Authority and transport.
  - [`main.ts`](src/server/main.ts) - Env parsing (including
    `parseIceServersEnv` for `RTC_ICE_SERVERS_JSON`: max 8 entries,
    `stun:`/`stuns:`/`turn:`/`turns:` URLs only, invalid input
    yields `[]` without logging credentials), `RoomManager` wiring,
    HTTP + WebSocket bootstrap, graceful shutdown on SIGINT/SIGTERM.
  - [`http.ts`](src/server/http.ts) - Static serving for `dist/client`,
    `/healthz`, upgrade routing to the `/ws` endpoint.
  - [`socket.ts`](src/server/socket.ts) - `attachWebSocketServer()`:
    origin check, handshake timeout, rate limiting (game 20/10 s,
    rtc 120/10 s in a separate bucket), zod parsing,
    per-viewer broadcast after each accepted action, authenticated
    `rtc_signal` targeted relay (discussion phase only, never
    broadcast, never logged), and the discussion deadline sweep
    (default every 250 ms, broadcasts only rooms whose deadline
    actually expired).
  - [`rooms.ts`](src/server/rooms.ts) - `RoomManager`: room lifecycle,
    seats/tokens, action dispatch with idempotence, reconnect grace,
    discussion deadline arming (strict majority arms once via server
    time; the armed deadline is never reset or extended) and
    unanimous-consent fast path (`maybeForceDiscussionVote` on
    consent/disconnect/rejoin, connected denominator).
  - [`project.ts`](src/server/project.ts) - `projectForViewer()`:
    canonical state to viewer-safe projection. Server-only;
    the client never imports it.
- `src/client/` - Thin rendering client; it holds no game logic.
  - [`main.ts`](src/client/main.ts) - Projection-driven view router
    (home / lobby / game / results) plus phase-change
    announcements and audio cues.
  - [`net.ts`](src/client/net.ts) - `GameClient`: socket lifecycle,
    auto-rejoin from the saved seat, single in-flight action guard,
    backoff retry, voice controller lifecycle (disposed on
    explicit disconnect/leave).
  - [`voice/`](src/client/voice/) - Native WebRTC full-mesh voice:
    `mesh.ts` (`VoiceMesh`, max 5 peers, so 6-player rooms),
    `controller.ts` (mic opt-in, discussion-phase activation only),
    `signaling.ts` (`MAX_SIGNAL_PAYLOAD_CHARS` 6000, client-side
    welcome ICE validation), `prefs.ts` (per-browser voice
    preferences), `mic.ts`/`peer*.ts` (capture pipeline, peer
    connections, remote audio sinks). No recordings, no server
    audio persistence.
  - [`views/discussion-consent.ts`](src/client/views/discussion-consent.ts) -
    Per-player consent progress (`agreed / connected`) with
    irreversible consent button, docked into the table view.
  - `audio/`, `ui/dom.ts`, `showcase/` - Sound cues and manager
    (`audioManager`, game sound prefs separate from voice prefs),
    voice panel and settings disclosure
    ([`voice-controls.ts`](src/client/audio/voice-controls.ts):
    mic toggle, autoplay listen control, game-sound / received-voice /
    mic-gain sliders), tiny DOM helper, static markup showcase.
  - [`session.ts`](src/client/session.ts) - `localStorage` seat
    persistence and `?room=` URL sync.
  - [`views/`](src/client/views/) - `home.ts`, `lobby.ts`,
    `game*.ts` (table, draft, phases, cards, seating),
    `discussion-consent.ts` (consent progress), `results*.ts`.
- `tests/` - `unit/` (rules, reducer, protocol, audio),
  `integration/` (rooms, socket, full game, bots),
  `e2e/` (browser flows: draft, phases, results, responsive/a11y).
- [`scripts/add-bots.mjs`](scripts/add-bots.mjs) - CLI helper
  (`npm run add-bots -- CODE`) joining scripted test players
  to a live room for solo testing. Bots auto-ready, draft,
  consent to end discussion (`advance_to_vote`), and vote;
  the host still starts the game from a browser.

## Main modules and responsibilities

### Rules core ([`src/shared/game.ts`](src/shared/game.ts))

`reduceGame(state, action)` is pure and version-checked.
Every version-bearing action must carry
`baseVersion === state.version`, otherwise it throws `RulesError`
and the client must resync. Action inventory by phase:

- Lobby: `add_player` (max 6, unique names), `set_ready`,
  `select_level` (host only, validated against player count),
  `kick` (host only, lobby only, never self).
- `start_game` (host only): requires 3-6 players, a level valid
  for the count, and every player ready. Deals via seeded
  `createSetup`, assigns locations, and serves the first player
  two cards.
- `choose_and_pass` (draft, current actor only): keeps one card,
  passes the other to an unserved player who then draws from
  the deck; the final player's leftover goes face-down
  to the Guest Room and the phase becomes `discussion`.
- `advance_to_vote` (discussion only, every connected player
  including the host): per-player irreversible consent to end
  discussion. The reducer records the consent, stays pure (it
  never touches the clock), and transitions to `voting`
  immediately on unanimous consent of all connected players;
  a duplicate consent is an idempotent no-op with no version bump.
  Disconnected players cannot consent. The timed path (strict
  majority arming a 15 s server deadline) lives in `RoomManager`,
  not the reducer.
- Abilities (discussion only): `butler_peek` (once; a peeking
  butler must abstain from voting) and `detective_send`
  (once; resolves the round immediately, skipping voting).
- `cast_vote` (voting only, occupied locations only): once all
  eligible connected voters have voted, `resolveRound` runs
  inside the reducer (lawyer cancellation, ballot tally,
  boiler occupants, winning faction).
- `rematch` (host only, after resolution): roster kept,
  round state reset, phase back to `lobby`.

### State model ([`src/shared/state.ts`](src/shared/state.ts))

Canonical state holds all hidden data: full decks
(`playableCards`, `setAsideCards`, `removedCards`),
`pendingCards`, `keptRoles`, `guestRoomCard`, `votes`, `result`.
The header comment states it is never sent over the wire
or logged in full.
`PlayerProjection` exposes only what one viewer may see:
public roster and role list, own hand (`ownCards`, only while
it is the viewer's draft turn), own kept role and ballot,
butler peek (only the peeking butler), detective target,
testimony trail, discussion consent state (`discussionConsents`,
`discussionDeadlineAt`, both server-authoritative canonical fields
also present on `CanonicalGameState`), and `result` only in
`resolution`/`game_over`.

### Room authority ([`src/server/rooms.ts`](src/server/rooms.ts))

- Caps: `MAX_ROOMS = 100`; 6-char codes from an unambiguous
  alphabet; no public listing, join by code only.
- Seats: per-player `seatToken`, bounded 128-entry action-id
  log for idempotent retries.
- Timeouts: 90 s reconnect grace, 10 min empty-room TTL,
  4 h max room age (clock injectable via `getTime` in tests).
- `disconnectPlayer` marks `connected = false` but keeps
  the roster slot; `rejoinRoom` restores it with the seat token.
  Voting eligibility already skips disconnected players.
- Discussion end (server-authoritative, see
  [`src/shared/discussion.ts`](src/shared/discussion.ts)):
  each `advance_to_vote` consent triggers `maybeArmDiscussionDeadline`,
  which arms `discussionDeadlineAt = serverTime + 15 s` once strict
  majority of connected players has consented, and never resets or
  extends it. Unanimous connected consent transitions to `voting`
  immediately via `maybeForceDiscussionVote` (also re-evaluated on
  disconnect/rejoin against the connected denominator, without
  touching an armed deadline). Otherwise `checkAllDiscussionDeadlines`
  (driven by the socket sweep) forces `voting` when the armed
  deadline expires. Every forced transition clears consent state
  and bumps `version`.

### Projection gate ([`src/server/project.ts`](src/server/project.ts), [`src/server/socket.ts`](src/server/socket.ts))

Every outbound update is `projectForViewer(state, playerId)`
computed separately per socket and broadcast to the whole room
after each accepted action. Canonical state is never serialized
to clients. Hidden information is withheld until the rules
permit disclosure: own draft hand only on the viewer's turn,
butler peek only after the viewing butler has peeked,
full result only at resolution; the guest-room card is never
projected to any viewer before the result.

### Transport ([`src/shared/protocol.ts`](src/shared/protocol.ts), [`src/server/socket.ts`](src/server/socket.ts), [`src/client/net.ts`](src/client/net.ts))

- Frames: JSON text only (binary frames are rejected),
  8 KB max payload, 20 messages per 10 s per socket.
- Handshake: 10 s timeout to send `create_room`/`join_room`/
  `rejoin`; 20 s ping heartbeat; `ORIGIN` allowlist enforced
  on HTTP upgrade (strictly the `/ws` path).
- Client discipline: one in-flight action at a time, stamped
  with the projection `version`; stale versions are rejected
  with an error event so the UI resyncs on the next projection.
- Server messages: `welcome` (seat plus the validated ICE server
  list), `projection` (full viewer-specific snapshot),
  `rtc_signal` (targeted relay of one peer's offer/answer/ice
  payload, discussion phase only), `error` (coded, e.g.
  `STALE_VERSION`, `INVALID_TOKEN`, `INVALID_PHASE` for out-of-phase
  signaling, `RATE_LIMITED`), `ping`, `room_closed` (e.g. on
  graceful shutdown).
- Voice transport: the existing WebSocket carries only signaling
  between authenticated room members; audio itself flows peer to
  peer over native WebRTC and is never recorded or persisted
  server-side. Signaling is rejected outside `discussion`
  (server and client both gate on the phase), self-targets and
  disconnected targets are rejected, and oversized payloads
  (over 6000 chars) are dropped.

### Client views ([`src/client/main.ts`](src/client/main.ts), [`src/client/views/`](src/client/views/))

Views render from the latest projection; a new projection
replaces the view outright, while views can retain local
interaction state (menu collapsed/drawer persistence,
role-reveal toggle).
Draft interaction is owned by a single coordinator
(`game-draft.ts`); discussion/voting controls dock into
the table view (`game-table.ts`, `game-phases.ts`).
A viewer's own role renders only inside that viewer's
private panel behind an explicit reveal toggle; other players'
roles remain hidden until the result is revealed.
Result cards render only from resolution data
(`game-cards.ts`, `results*.ts`).
Discussion adds two projection-driven pieces: the consent section
(`discussion-consent.ts`: `agreed / connected` progress against
the connected denominator, irreversible per-player consent button)
and the mic panel (`audio/voice-controls.ts`: mic opt-in toggle,
autoplay listen control, mic off by default). Persistent settings
live outside `#app` in the audio shell: game sound volume
(`audioManager`, `night-of-witnesses.audio.v1`, default master
0.4) separate from received-voice volume (default 0.8, range 0-1)
and mic gain (default 1, range 0-2, `night-of-witnesses.voice.v1`);
all three are per-browser `localStorage` preferences.

## Runtime and data flow

```
browser view -> GameClient.dispatchAction (version-stamped)
  -> ws JSON -> socket.ts (origin, rate limit, zod parse)
  -> RoomManager.dispatchAction (seat check, idempotence)
  -> reduceGame (pure, version-checked, may resolve round)
  -> broadcast projectForViewer(state, each playerId)
  -> views rerender from the new projection
```

Phase transitions:

```
lobby -> draft -> discussion -> voting -> resolution
                  discussion -> voting  (unanimous connected
                    consent, or armed 15 s deadline expiry via
                    the 250 ms server sweep; disconnect/rejoin
                    re-evaluates against the connected denominator)
                  discussion -> resolution  (detective_send)
resolution -> lobby  (rematch; roster kept)
```

The client renders both `resolution` and `game_over` with
the results view. Authority is split by action: the host gates
`start_game`, `select_level`, `kick`, and `rematch`;
ending discussion is per-player consent (`advance_to_vote`,
host included, no host shortcut); `choose_and_pass` is turn-gated
to the current draft actor; `butler_peek` and `detective_send`
are role-gated; `set_ready`, `cast_vote`, and joining act
per player.

Persistence and reconnection: the seat (`roomCode`,
`seatToken`) survives in `localStorage`, so a dropped socket
auto-rejoins on `onopen` and receives a fresh projection.
Nothing survives a server restart: rooms, seats, and games
live only in the `RoomManager` maps.

## Dependencies

- Runtime: only `ws` and `zod`. Rules, state types, setup tables,
  and message schemas live in `src/shared/` and are imported
  by both ends, so client and server compile against the same
  definitions. The per-viewer projection itself
  ([`src/server/project.ts`](src/server/project.ts)) is server-only:
  clients receive projections but cannot shape them.
- Build/test: `typescript`, `vite`, `@playwright/test`,
  `@types/node`, `@types/ws`.
- External services: none by default. The trust boundary is the room code
  plus seat token plus the `ORIGIN` check; accordingly the
  README recommends localhost binding or a private network
  (e.g. Tailscale) rather than public exposure. Voice needs
  no voice server: signaling rides the existing WebSocket and
  audio is peer to peer, but cross-network voice needs ICE
  help (see deployment prerequisites below).

## Voice deployment prerequisites (verified)

- Secure context: `getUserMedia` requires HTTPS (or localhost).
  Without it the controller reports unavailable and the settings
  panel shows the HTTPS hint; mic stays off.
- Default ICE is `[]`: same-LAN calls usually work, anything
  behind NAT generally does not. There is no universal
  cross-network voice success without a TURN server.
- Configure via `RTC_ICE_SERVERS_JSON`, e.g.
  `[{"urls":["stun:stun.example.org:3478"]}, {"urls":
  ["turn:turn.example.org:3478"], "username": "TEMP-USER",
  "credential": "TEMP-CREDENTIAL"}]` (placeholders, not real
  credentials). Validation caps: 8 servers, `stun:`/`stuns:`/
  `turn:`/`turns:` schemes, 512-char field limits; invalid input
  yields `[]`. The list is delivered to clients in `welcome`,
  so TURN credentials are visible to room members: use short-lived
  TURN credentials, never long-lived admin secrets.
- Browser behavior callers should expect: mic permission prompt
  on opt-in, mic off by default and torn down on phase exit or
  disconnect, and an explicit listen control when autoplay blocks
  remote audio playback.

## Extension considerations

- New actions: add a variant to `GameAction`
  ([`src/shared/game.ts`](src/shared/game.ts)), a reducer case,
  the zod schema ([`src/shared/protocol.ts`](src/shared/protocol.ts)),
  projection fields if viewers need them, then unit plus
  integration tests. The `never`-exhaustive switch forces
  compile-time coverage.
- New roles/levels: extend `ROLES`/`FACTIONS` and the setup
  tables in [`src/shared/rules.ts`](src/shared/rules.ts) plus
  the lobby roster fallback in `project.ts`; keep
  `isValidLevelForPlayerCount` consistent or `start_game`
  will reject the level.
- Client work: add a renderer under `src/client/views/`
  driven only by projection fields; disclose hidden information
  only through the server projection policy.
- Scaling: the in-memory `RoomManager` is the ceiling
  (100 rooms x 6 players). Extra instances would need sticky
  routing plus shared state, and long-lived games would need
  durable snapshots; neither exists today, so do not assume them.

## Limitations (verified)

- Restart wipes rooms: no snapshot, replay log, or database.
- Reconnect works only within the 90 s grace window and within
  the same process lifetime; invalid tokens clear the saved
  seat client-side.
- Single-process authority: max 100 rooms, 6 players each,
  no horizontal scaling path without redesign.
- No implied guarantees: no durable persistence, no matchmaking,
  and invite codes are not network access control.
- Voice is best-effort: native WebRTC full mesh capped at 5 peers
  (6-player rooms), no recordings, no server audio persistence,
  no claimed NAT/TURN reliability. Default empty ICE means
  LAN-only in practice; cross-network voice requires operator
  provided STUN/TURN that was never tested here.
- Mic is discussion-phase only and opt-in: it starts off, needs
  a browser permission grant in a secure context, and is torn
  down on phase exit and on disconnect. Autoplay policies may
  block remote audio until the user presses the listen control.
