# Accounts and Public Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method must be selected by the user before implementation.

**Goal:** 在既有遊戲上提供帳戶、公開大廳與可信的個人戰績，並以 React／MUI 管理所有使用者畫面。

**Architecture:** Node.js 繼續執行權威遊戲，FastAPI 管理帳戶與 PostgreSQL，瀏覽器透過同來源 `/api` 與 `/ws` 存取。Node.js 只經受保護的內部 API 驗證 session 及保存對局。React 重用現有遊戲與媒體邏輯，不重寫規則。

**Tech Stack:** TypeScript、既有 Vite／Node.js／ws／Zod、React、React DOM、MUI、Emotion；Python 3.13、FastAPI、Uvicorn、Psycopg 3、pwdlib／Argon2；PostgreSQL 17；Docker Compose；pytest／HTTPX、node:test、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-20-accounts-public-lobby-design.md`（使用者於 2026-10-20 確認）。

## Global Constraints

- 「保留現有 TypeScript／Node.js 遊戲服務旁加入 Python FastAPI 與 PostgreSQL」；遊戲規則仍由 Node.js 判定。
- 「根目錄 `db/migration/001_initial.sql`，一次建立完整初始 schema」；不得用 ORM 自動建表或拆多個初始版本。
- 「`db/seed.py`」；管理員電郵 `admin@now.com`，指定密碼經環境變數傳入，seed 重跑不覆寫。
- 「未登入可瀏覽公開房間；建立或加入房間需要玩家帳戶」。
- 「玩家與管理員採用各自獨立的 opaque session cookie」；玩家七日、管理員八小時。
- 「密碼不 trim，長度 12–128 字元」；Argon2id；重設 token 30 分鐘到期、一次性使用。
- 「公開房間 / Public room」預設關閉；公開清單前景每五秒更新，背景／離頁停止。
- 「勝率：`wins / (wins + losses)`」；零分母顯示「—」；無獲勝者與中斷獨立處理。
- 「同一房間的開局、玩家操作、離線／到期事件及結算串行處理」。
- 「所有安裝、啟動、建置、型別檢查及測試延續現有 Docker-only 約定」。
- 保持繁體中文、酒館風格、至少 44px 操作範圍、375／768／1280px 與 reduced-motion。
- 使用者未要求 branch、commit 或部署；本計畫不建立 branch、不 commit、不發布網站。

## Review Focus

1. 非 ASCII 暱稱、HTML 字串及電郵大小寫：正常保存與安全顯示，不改變密碼空白；由 Task 2／7 測試。
2. reset、logout 或 session 到期與既有 socket 交錯：下一個遊戲命令必須失敗，不能冒認舊座位；由 Task 5 測試。
3. 最後一票、重複訊息、rematch 及資料庫故障交錯：只產生一次完整戰績，未保存不能覆蓋；由 Task 4／6 測試。
4. 六碼房間代碼在重啟後重用：新舊 room UUID 分開，歷史與公開清單不混淆；由 Task 1／6 測試。
5. React StrictMode、頁面背景化與重新登入：只有一組 websocket／語音／輪詢資源，秘密不流入 DOM／URL；由 Task 7／8／9 測試。

## File Map and Execution Context

- `db/migration/001_initial.sql`、`db/migrate.py`、`db/seed.py`：schema、版本執行與初始化；`db/__init__.py` 只作 Python package 標記。
- `api/app.py`、`api/config.py`、`api/database.py`：FastAPI 建立、環境與每請求連線；`api/__init__.py` 作 package 標記。
- `api/security.py`、`api/auth.py`、`api/mail.py`：雜湊／session／CSRF、帳戶路由、SMTP。
- `api/history.py`、`api/internal.py`、`api/admin.py`：統計讀取、受保護生命週期寫入、管理員唯讀 API。
- `api/requirements.txt`、`api/requirements-test.txt`、`api/Dockerfile`、`api/tests/`：固定依賴、容器、資料庫整合測試。
- `src/shared/accounts.ts`：HTTP payload 的 Zod schemas／TypeScript 型別；`src/shared/protocol.ts` 擴充遊戲協定。
- `src/server/accounts.ts`：內部 FastAPI client；`src/server/room-queue.ts`：每房間順序；修改既有 `http.ts`、`socket.ts`、`rooms.ts`、`main.ts`、`project.ts`。
- `src/client/main.tsx`、`App.tsx`、`theme.ts`、`api.ts`、`auth.tsx`、`use-game.ts`、`components/`、`pages/`：React UI 與資源生命週期。
- `src/client/views/` 既有計算／拖曳／動畫可保留並重構成 hooks 所用工具；產品畫面改為 React components，不永久包裝舊 `render*` 作為 React 頁面。
- 修改 `package.json`、lockfile、tsconfig、Vite、index.html、styles、Compose、Dockerfile、Makefile、Playwright、bot 腳本與操作文件。

在現有指定專案工作；執行前用唯讀 git 指令確認 checkout、使用者變更及適用 AGENTS.md。不自動建立 worktree。只有設計文件為目前工作產物；Docker CLI 存在，但 2026-10-20 探測 Linux Engine named pipe 失敗，尚未執行任何程式基線測試。

依賴只在 Docker 內安裝。React／React DOM／react-is 使用相符 major；依 MUI 官方安裝方式加入 `@mui/material`、`@emotion/react`、`@emotion/styled`。在安裝當日選擇相容穩定版本並保存 npm lock；Python requirements 固定經實際安裝驗證的版本，不使用 dev／pre-release。

## Task 1: 可重跑的 PostgreSQL 001 與 API 容器

**Files:** Create `db/migration/001_initial.sql`, `db/migrate.py`, `db/__init__.py`, `api/app.py`, `api/config.py`, `api/database.py`, `api/__init__.py`, `api/requirements.txt`, `api/requirements-test.txt`, `api/Dockerfile`, `api/tests/conftest.py`, `api/tests/test_migrations.py`; modify `compose.dev.yml`, `.env.example`, `.gitignore`.

**Interfaces:** `db.migrate.apply_migrations(connection: psycopg.Connection, directory: Path) -> list[str]`; `api.database.connect() -> psycopg.Connection`; `api.app.create_app() -> FastAPI`; `GET /healthz` 為 process liveness，`GET /readyz` 檢查 PostgreSQL 及 001 已套用。Compose 名稱固定 `postgres`、`migrate`、`api`、既有 `dev`；測試使用獨立 `test-postgres` 與 test profile，不連正式 volume。

- [ ] 寫 `test_migration_is_atomic_and_repeatable`、`test_checksum_change_is_rejected`、`test_room_code_reuse_requires_closed_room`：空 DB 套用回傳 `['001']`、重跑 `[]`、錯誤 SQL 不留下半個 schema、checksum 修改拒絕、未關閉同碼失敗而已關閉同碼成功。
- [ ] 在 Docker Engine 可用後先執行既有 TypeScript／遊戲基線並記錄結果；不修與本需求無關的失敗。建立最小測試容器 wiring，執行 `docker compose -f compose.dev.yml --profile test run --rm api-test pytest api/tests/test_migrations.py -q`，確認新測試因尚未有 migration 而失敗。
- [ ] 實作規格第 4 節所有表、外鍵、狀態約束、索引及基本統計 view；`schema_migrations` 由 runner bootstrap。runner 使用 advisory lock 與 transaction；金鑰／密碼／token 不記錄到輸出。
- [ ] 加入 Python 容器及固定依賴、PostgreSQL healthcheck、一次性 migration、API readiness 與測試 DB。API 使用同步 Psycopg connection context，每請求明確 commit／rollback，不引入 ORM／pool 框架。
- [ ] 重跑同一測試檔，預期全通過；以 `docker compose -f compose.dev.yml config --quiet` 確認配置有效。

## Task 2: 玩家及管理員認證、seed

**Files:** Create `api/security.py`, `api/auth.py`, `api/admin.py`, `db/seed.py`, `api/tests/test_auth.py`, `src/shared/accounts.ts`; modify `api/app.py`, `api/config.py`, `.env.example`.

**Interfaces:** `hash_password(password: str) -> str`; `verify_password(password: str, password_hash: str) -> bool`; `resolve_user_session(token: str) -> dict | None`; `resolve_admin_session(token: str) -> dict | None`; `csrf_for_session(token: str) -> str`; `seed_admin(email: str, password: str) -> bool` 回傳是否新建。玩家 cookie `now_user_session`、管理員 `now_admin_session`。`auth/me` 回傳 `{user: {id, email, displayName}, csrfToken, expiresAt}`；管理員 me 使用 `admin` 欄位代替 `user`。

- [ ] 寫 `test_register_login_logout_and_email_normalization`、`test_admin_is_separate_and_seed_does_not_reset_password`、`test_password_boundaries_and_unicode_name`、`test_csrf_and_session_expiry`：七日／八小時、12／128 字界線、密碼前後空白原樣、電郵大小寫重複、中文／HTML 暱稱、錯誤來源／CSRF 拒絕、token 只存雜湊。
- [ ] 執行 `docker compose -f compose.dev.yml --profile test run --rm api-test pytest api/tests/test_auth.py -q`，確認缺少認證實作而失敗。
- [ ] 實作 register／login／logout／me 及 admin login／logout／me，Argon2id 雜湊、隨機 opaque session、可重現的 HMAC CSRF、期限及撤銷。登入錯誤共用提示；依可信 socket peer 與正規化電郵限流，不相信公開 X-Forwarded-For。
- [ ] 實作 seed，從環境讀入指定管理員密碼，不寫入 repo；以 unique email 與 transaction 保證重跑不改密碼。加入各 HTTP payload Zod schemas，暫不修改遊戲協定。
- [ ] 重跑同一測試檔，預期全通過；確認玩家 cookie 對 admin 路徑無效、反向亦然，兩個分頁的 csrf token 互不撤銷。

## Task 3: 真實可測試的忘記密碼

**Files:** Create `api/mail.py`, `api/tests/test_password_reset.py`; modify `api/auth.py`, `api/config.py`, `compose.dev.yml`, `.env.example`.

**Interfaces:** `send_password_reset(email: str, reset_url: str) -> None`；`POST /api/auth/forgot-password` 接收 `{email}`；`POST /api/auth/reset-password` 接收 `{token, password, confirmPassword}`。重設網址以設定的 `PUBLIC_APP_URL` 建構，不信任請求 Host。SMTP 使用 stdlib `smtplib`／`email.message`。

- [ ] 寫 `test_reset_token_expires_after_30_minutes_and_is_single_use`、`test_reset_revokes_all_sessions`、`test_unknown_email_has_same_response`、`test_reset_email_uses_configured_origin`、`test_missing_smtp_is_not_reported_as_sent`；Mailpit API 驗證郵件存在與連結，不從一般日誌取 token。
- [ ] 執行 `docker compose -f compose.dev.yml --profile test run --rm api-test pytest api/tests/test_password_reset.py -q`，確認失敗。
- [ ] 實作一次性雜湊 token、同 transaction 消耗 token／更新密碼／撤銷 session；並行重送只允許一個成功。重設申請限流，未知電郵回同訊息，SMTP 故障不能揭露帳戶是否存在。
- [ ] Dev／test profile 加入 Mailpit，Web UI 只綁定本機；正式要求 SMTP configuration，readiness／日誌明確顯示缺少寄信設定，不輸出 token 或郵件內容。
- [ ] 重跑同一測試檔，預期全通過；確認 URL query token 在成功／離頁後由前端清除的要求交給 Task 7。

## Task 4: 內部對局寫入與玩家統計 API

**Files:** Create `api/internal.py`, `api/history.py`, `api/tests/test_history.py`, `api/tests/test_internal.py`; modify `api/admin.py`, `api/app.py`, `src/shared/accounts.ts`.

**Interfaces:** 內部請求要求 `Authorization: Bearer <INTERNAL_API_SECRET>`。`POST /internal/instances` 接收 `{instanceId}`；`POST /internal/rooms` 接收 `{roomId, code, instanceId, createdByUserId, isPublic, createdAt}`；`POST /internal/rooms/{roomId}/close`；`POST /internal/matches` 接收 `{matchId, roomId, roundNumber, level, startedAt, players: [{playerId, userId, displayName}]}`；`PUT /internal/matches/{matchId}/result` 接收 `{endedAt, winningFaction, winningPlayerIds, reason, assignments: [{playerId, roleId, factionId, locationId}]}`；`PUT /internal/matches/{matchId}/abandon` 接收 `{endedAt, reason}`；`POST /internal/sessions/resolve` 接收 `{sessionToken}`，回 `{userId, displayName, expiresAt}`，無效回 401。

`GET /api/me/stats` 回 `{participated, inProgress, completed, abandoned, wins, losses, noWinner, winRate, currentWinStreak, bestWinStreak, totalPlaySeconds, averageCompletedSeconds, roles, factions}`，空勝率／平均為 null；lists 回 `{items, page, pageSize, total}`，pageSize 1–50。

- [ ] 寫 `test_start_and_result_are_transactional_and_idempotent`、`test_conflicting_duplicate_result_is_rejected`、`test_stats_count_no_winner_and_abandonment_separately`、`test_history_is_scoped_to_session_user`、`test_new_instance_abandons_previous_active_matches`。固定資料要求：2 win、1 loss、1 no_winner、1 abandoned、1 in_progress → participated 6、completed 4、winRate 約 2/3。
- [ ] 執行 `docker compose -f compose.dev.yml --profile test run --rm api-test pytest api/tests/test_history.py api/tests/test_internal.py -q`，確認失敗。
- [ ] 實作 session resolver 與內部 endpoint；以 row lock、唯一約束及單一 transaction 處理開始／完成／中斷，完成結果不能被其他結算覆蓋。驗證全部 player IDs 皆來自該局，outcome 由 winner IDs 產生；無 winners 時為 no_winner。
- [ ] 實作 stats、自己的分頁歷史及管理員 overview／users／matches。session／密碼雜湊不進任何 JSON，進行中角色不對玩家／admin 列表揭露。以 spec 的終了時間及 UUID 決定 streak 排序。
- [ ] 重跑同一測試組，預期全通過；額外對同一 match 並行送兩次相同 result，資料庫只保留一份。

## Task 5: Node.js 帳戶驗證、公開列表與安全代理

**Files:** Create `src/server/accounts.ts`, `tests/helpers/accounts.ts`, `tests/integration/account-socket.test.ts`, `tests/integration/public-rooms.test.ts`, `tests/integration/api-proxy.test.ts`; modify `src/server/http.ts`, `socket.ts`, `rooms.ts`, `main.ts`, `project.ts`, `src/shared/protocol.ts`, `state.ts`, `src/client/net.ts`, `scripts/add-bots.mjs`, affected existing test helpers.

**Interfaces:** `AuthenticatedPlayer = {userId: string; displayName: string; expiresAt: string}`；`AccountService.resolveSession(rawCookie: string): Promise<AuthenticatedPlayer>`，使用原生 fetch 並設 timeout。`RoomManager.createRoom(player: AuthenticatedPlayer, actionId: string, options: {isPublic: boolean})`、`joinRoom(code: string, player: AuthenticatedPlayer, actionId: string)`、`rejoinRoom(code: string, seatToken: string, userId: string)`；維持原本回傳的 welcome／projection 形狀並增加公開狀態。`create_room` 訊息使用 `{type, actionId, isPublic}`；`join_room` 使用 `{type, actionId, roomCode}`，暱稱由登入帳戶提供。`GameClient.createRoom(isPublic = false)`、`joinRoom(roomCode: string)`。

- [ ] 寫 `test_socket_requires_player_session_and_revalidates_commands`、`test_rejoin_rejects_other_user_even_with_seat_token`、`test_duplicate_user_cannot_take_another_seat`、`test_only_joinable_public_rooms_are_listed`、`test_proxy_blocks_internal_and_preserves_session_cookies`，含 reset／logout 與 socket 交錯、encoded path、兩個 Set-Cookie、後端逾時及滿房競爭。
- [ ] Docker 內執行新增三個 Node integration test 檔，確認認證／公開列表功能缺失導致失敗；純 RoomManager 測試可用固定 identity helper，不加正式匿名 bypass。
- [ ] 實作帳戶 bridge、upgrade Origin／session 驗證及命令再次驗證，FastAPI 不可用則拒絕修改；seat 保存 userId 並綁定重連。維護 userId→房間索引，移除／清房同步釋放；舊帳戶不能用 token 恢復別人座位。
- [ ] 增加 public flag、公開摘要與 Node `/api/rooms/public`，不輸出 user email、user ID、token、角色及手牌。HTTP 僅代理設定好的 FastAPI 來源及公開 `/api` path，不轉送外部指定目標或服務秘密，套用既有 security headers。
- [ ] 修改 bot 腳本與 wire test helper 以正式 register／login 取得 cookie；raw reducer／RoomManager 測試採 identity fixture。舊匿名測試契約改為登入契約，保留所有規則斷言。
- [ ] 重跑新增 integration 測試及既有 protocol／rooms／leave／socket 測試；預期全通過，資料庫不可用時沒有匿名回退。

## Task 6: 遊戲生命週期持久化與非同步順序

**Files:** Create `src/server/room-queue.ts`, `tests/integration/match-persistence.test.ts`; modify `src/server/accounts.ts`, `rooms.ts`, `socket.ts`, `main.ts`, `src/shared/state.ts`, `protocol.ts`, `src/server/project.ts`.

**Interfaces:** `RoomQueue.run<T>(roomCode: string, operation: () => Promise<T>): Promise<T>`；`AccountService.registerInstance(instanceId: string)`、`recordRoom(payload: RoomRegistration)`、`closeRoom(roomId: string)`、`startMatch(payload: MatchStart)`、`completeMatch(matchId: string, payload: MatchResult)`、`abandonMatch(matchId: string, endedAt: string, reason: string)` 全回 `Promise<void>`，payload 欄位與 Task 4 一致並由 `src/shared/accounts.ts` 定義。projection 增加 `historyStatus: 'none' | 'saving' | 'saved'`，不帶任何身份憑證。

- [ ] 寫 `test_failed_start_keeps_lobby_unchanged`、`test_last_vote_is_saved_once_before_rematch`、`test_retry_preserves_match_id_and_blocks_rematch`、`test_reused_room_code_has_distinct_history`、`test_room_queue_survives_rejection`，注入可控制延遲／失敗的 AccountService methods，斷言同時 start／vote／disconnect 不跳過版本檢查或重複寫入。
- [ ] Docker 內執行 `node --test tests/integration/match-persistence.test.ts`，確認失敗。
- [ ] 新增 room UUID／instance UUID／round number／match UUID，成功開始前保存 roster；候選 state 與持久化成功再提交的界線放在房間協調層，純 reducer 不直接 fetch 或查 DB。
- [ ] 所有會改房間的 command、斷線、重連、抽牌／討論 timer 及 expiry 走同一每房 queue；失敗不 poison 後續 queue。對局結果待保存時保留 snapshot，重試間隔 1／2／4／8／最多 30 秒，保存前禁止 rematch，程序終止清理 retry timer。
- [ ] 啟動時登記實例，正常關房／抽牌到期取消／停服保存中斷。若保存失敗則留有未完成 DB 對局，由下次 instance 登記清理。已保存結果可離房返回 Dashboard；未完成局沿用既有離房／重連限制，不能把進行中資料刪掉。
- [ ] 重跑該測試檔及 full-game／discussion integration 測試，預期全通過；確認 API 重啟不誤判 Node instance 死亡。

## Task 7: React／MUI 應用、帳戶頁與導覽

**Files:** Create `src/client/main.tsx`, `App.tsx`, `theme.ts`, `api.ts`, `auth.tsx`, `use-game.ts`, `pages/Login.tsx`, `pages/Register.tsx`, `pages/ForgotPassword.tsx`, `pages/ResetPassword.tsx`, `components/AppShell.tsx`, `tests/e2e/auth.spec.ts`; modify `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `src/client/session.ts`, `styles.css`, `playwright.config.ts`.

**Interfaces:** `apiRequest<T>(path: string, options?: RequestInit): Promise<T>` 固定同來源／credentials／JSON 與 CSRF header；`AuthProvider`／`useAuth()` 提供 `{user, csrfToken, loading, login, register, logout, refresh}`；`useGame()` 提供共用 GameClient、projection、status、error。原生 history/popstate 與 URL pathname 管理小型 route 集合，不另引入 router library；route 包含 `/login`、`/register`、`/forgot-password`、`/reset-password`、`/`、`/history`、`/room`、`/admin/login`、`/admin`。

- [ ] 寫 `register_login_logout_preserves_invite`、`reset_link_clears_token_and_invalidates_old_session`、`strict_mode_has_one_game_connection`、`unicode_name_is_rendered_as_text`；經真實 FastAPI 註冊新帳戶，未登入加入公開／邀請房先導向登入，成功返回原目標。
- [ ] 在 Docker 內安裝並鎖定 React／MUI／Emotion 與 types、設定 `jsx: react-jsx`，先執行 auth Playwright 測試，確認頁面缺失而失敗；不添加用來通過測試的假登入狀態。
- [ ] 實作 MUI theme、AppShell、accessible 表單、loading／錯誤狀態及返回導覽；前端輸入規則與 Task 2／3 相同，HTTP 錯誤不使用 alert()。
- [ ] 實作 session bootstrap、CSRF 與安全 return path（僅站內白名單）；不在登入畫面建立 WS。登出／切換帳戶清除座位並關閉 GameClient／voice，重設 token 不存 localStorage，成功後 replaceState 清理網址。
- [ ] 重跑 auth 測試與 `npm run check`／`npm run build`（全部容器內），預期通過；MUI／Emotion 不新增寬鬆 script CSP 或外部字型依賴。

## Task 8: 遊戲 React components 與媒體生命週期

**Files:** Create `src/client/pages/Room.tsx`, `components/game/Lobby.tsx`, `Game.tsx`, `GameTable.tsx`, `DraftControls.tsx`, `DiscussionControls.tsx`, `VotingControls.tsx`, `Results.tsx`, `GameMenu.tsx`; modify `src/client/views/` 中的拖曳／動作／卡牌工具及 `src/client/audio/voice-controls.ts`, `src/client/main.ts` 的舊掛載；更新相關 e2e helpers。

**Interfaces:** 所有遊戲 components 消費同一 `{projection: PlayerProjection; client: GameClient}`；`Room` 按 phase 選擇畫面；`useGame` 為唯一 transport 訂閱者。副作用由 effect cleanup 處理，純 seating／card-art／規則工具繼續共用。React 內不重新 `innerHTML` 插入 product view。

- [ ] 先更新 `tests/e2e/draft-flow.ts` 及登入 helper，保留抽牌、傳牌、聲稱、討論同意、能力、投票與結果斷言；加入 `react_remount_disposes_voice_and_drag` 及 `result_returns_to_dashboard_after_save`。
- [ ] 執行 game-draft／game-phases／results-recovery／discussion-voice 選定 browser 測試，確認新 React route 尚未提供完整畫面而失敗。
- [ ] 依 lobby→table／draft→discussion／vote→results 次序搬成真正 React components，重用 card art、CSS tokens、純規則與 motion 時間，使用穩定 player／card keys。傳牌對話框維持 focus trap、Escape 與取消恢復。
- [ ] 把音效 Menu、mic、收聽、音量與討論 timer 的訂閱移至對應 effects，離 phase 關 mic；不因 dashboard rerender 重設音量。結果只按 winner IDs 顯示自己的勝負，並顯示 historyStatus 保存狀態。
- [ ] 完成遷移後移除不再呼叫的舊主程式掛載與 view renderer；保留仍有明確 consumer 的工具及 showcase。保留測試需要的 `window.__NOW__` 觀察能力但不暴露 session token／管理員秘密。
- [ ] 重跑上述測試、interaction-privacy／responsive-a11y 及 voice unit 測試，預期通過；檢查 375／768／1280px 與 reduced-motion。

## Task 9: Dashboard、公開大廳、個人戰績與管理員頁

**Files:** Create `src/client/pages/Dashboard.tsx`, `History.tsx`, `AdminLogin.tsx`, `AdminOverview.tsx`, `components/PublicRooms.tsx`, `CreateRoomDialog.tsx`, `StatsCards.tsx`, `MatchHistory.tsx`, `tests/e2e/dashboard.spec.ts`, `tests/e2e/admin.spec.ts`; modify `App.tsx`, `api.ts`, `src/client/views/home.ts` 舊入口與 e2e home tests。

**Interfaces:** Task 4 stats／history response schemas 與 Task 5 public rooms 回 `{rooms: [{roomCode, hostName, level, playerCount, maxPlayers, createdAt}]}`。`PublicRooms` 僅消費安全摘要；公開 flag 由 create dialog 傳給 `GameClient.createRoom(isPublic)`。admin csrf／identity 使用獨立 state，不共用玩家認證。

- [ ] 寫 `public_toggle_is_private_by_default`、`public_room_disappears_when_full_or_started`、`empty_stats_show_dash_and_real_history_updates`、`polling_stops_when_hidden_or_unmounted`、`admin_and_player_sessions_are_isolated`；斷言 API 回應外的假統計不出現在 UI。
- [ ] Docker 內執行 dashboard／admin Playwright 檔，確認功能缺失導致失敗。
- [ ] 實作頂部戰績卡、中間公開大廳、建立／邀請碼操作及最近對局；登入後載入自己的真實 stats，空帳戶顯示零或「—」，不用 demo 值。公開房前景五秒更新，請求取消／版本檢查防止舊回應覆蓋新列表。
- [ ] 實作 history 分頁、角色／陣營樣本數、連勝及時長；結果離房後刷新。快速加入前處理登入／連線狀態，房間已滿或已開始顯示提示並重新整理。
- [ ] 實作獨立 admin login／唯讀 overview 與分頁 users／matches，對 401／403 導向正確身份登入頁，不能以隱藏按鈕代替後端授權。
- [ ] 重跑該測試組及 auth／home route 測試，預期通過；手機列表不溢出、鍵盤可操作、頁面切換後沒有多餘輪詢。

## Task 10: 完整 Compose、文件及最終驗收

**Files:** Modify `docker-compose.yml`, `compose.dev.yml`, `Dockerfile`, `api/Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example`, `Makefile`, `README.md`, `ARCHITECTURE.md`, `DESIGN.md`, `docs/implementation-progress.md`, `scripts/add-bots.mjs`, `playwright.config.ts`; add `docs/database-operations.md`。

**Interfaces:** `make migrate`、`make seed`、`make test-api`、既有 `make check`／`make test`／`make test-e2e`／`make start`。API tests 使用獨立 test DB；seed 命令要求 seed password 環境變數，標準啟動不覆寫管理員。正式 postgres／api 不 publish port；Mailpit 只在 dev／test。

- [ ] 完成正式 Compose 的 migration→API readiness→Node startup 依賴、資料 volumes、non-root Python runtime 與內部服務 secrets；Makefile 測試啟動所需 DB／API，移除會跳過新相依服務的舊 `--no-deps` 用法。
- [ ] 更新 README 的「無資料庫／無公開房間／匿名玩家」過時說明；文件列出完整 `.env`、指定管理員 seed 的安全操作、Mailpit／SMTP、migration checksum、PostgreSQL 備份／還原與重啟中斷規則。不得把指定管理員明文密碼寫到文件或測試。
- [ ] 在 Docker 中執行開發及正式 `compose config --quiet`、乾淨 image build、001 空 DB／重跑、seed／重跑；在獨立 test volume 模擬重啟 Node／API 與 DB 故障恢復，不對使用者正式資料做清空或 `down -v`。
- [ ] 執行 TypeScript check／production build、全部 Python API 測試、Node unit／integration 測試、Playwright desktop／mobile；若有失敗，區分基線與本次回歸，只修本需求造成的問題。
- [ ] 實際以三個獨立帳戶完成一局並在 DB／Dashboard 核對一次結算、勝負與歷史；以 Mailpit 完成 reset；視覺檢查 dashboard、auth、lobby、table、results。記錄執行命令、結果及未能驗證的環境項目。
- [ ] 按選定執行方式完成整體 code review，重點檢查身份邊界、proxy、交易、queue、React cleanup；必要修正後重跑受影響測試。只在取得實際通過輸出後宣告可用，不 commit 或公開部署。

## Self-Review and Handoff

規格第 1–3 節由 Task 5／7／8／9 實作；第 4 節由 Task 1；第 5 節由 Task 4／6；第 6 節由 Task 2／3／4／5；第 7 節由 Task 1／2／3／10；第 8–9 節由所有 task 的針對測試及 Task 10 驗收。五項 Review Focus 均有具名測試。

此計畫包含連續相依的 schema、API、Node 協定及 React 狀態，建議 Native：由目前 agent 依序實作，在完成後作一次獨立整體 review。使用者亦可選 subagent-driven，按 task 分派實作與 review；在選定前不派遣 agent、不寫產品程式。

參考官方文件：[MUI installation](https://mui.com/material-ui/getting-started/installation/)、[Psycopg transactions](https://www.psycopg.org/psycopg3/docs/basic/transactions.html)、[FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)。
