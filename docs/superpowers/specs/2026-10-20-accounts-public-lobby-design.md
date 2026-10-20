# 帳戶、公開大廳與玩家戰績設計

日期：2026-10-20（Asia/Hong_Kong）

狀態：技術方向已確認；本文件待使用者審閱。

## 1. 目的與已確認範圍

讓《目擊者之夜》的玩家可以建立帳戶、登入、尋找公開房間、與朋友建立私人房間，以及查看由伺服器保存的個人戰績。管理員與玩家必須分開儲存及驗證。

使用者已確認採用 React + TypeScript + Material UI 前端，在既有 TypeScript／Node.js 遊戲服務旁加入 Python FastAPI 與 PostgreSQL。既有權威遊戲規則、WebSocket、WebRTC 語音、繁體中文及酒館視覺繼續使用。

交付包含：

- 登入、註冊、登出、忘記密碼、重設密碼。
- Dashboard、公開房間列表、開房時的公開／私人開關。
- 持久化個人對局、勝負及有用統計。
- 獨立管理員帳戶、登入入口及基本唯讀總覽。
- 根目錄 `db/migration/001_initial.sql`，一次建立完整初始 schema。
- `db/seed.py`、migration runner、Docker 開發／部署設定及操作文件。

未登入可瀏覽公開房間；建立或加入房間需要玩家帳戶。舊有匿名對局沒有穩定帳戶身份，無法補入個人歷史戰績。

## 2. 架構與責任

### 前端

使用 Vite 建置 React + TypeScript，MUI 提供表單、導覽、對話框、統計卡片與響應式排版。以自訂 theme 延續現有深木色、黃銅、羊皮紙視覺。卡牌、圓桌與動畫沿用已有圖片及 CSS，轉成 React components。

以 React 為所有使用者畫面的生命週期管理者，逐步替換現有 `renderHome`、`renderLobby`、`renderGame`、`renderResults` 的 DOM 掛載方式。遊戲規則與傳輸層維持 TypeScript，不重寫成 Python。

現有 `GameClient`、語音 controller 及 audio manager 透過 React effects 訂閱與清理。切換畫面或卸載時清除事件、計時器、拖曳及媒體資源，避免 React 開發模式重複掛載造成雙連線或重複音效。

### Node.js

- 唯一的即時遊戲權威，繼續執行 `RoomManager`、純函式 reducer、私密 projection。
- 維護正在運行的房間及公開清單。
- 綁定已驗證 user ID 與座位；判斷開局、結算、中斷及重新開局。
- 經內部 API 將房間及對局寫入 FastAPI。
- 提供前端靜態檔案，代理一般 `/api/*` 請求到 FastAPI；優先自行處理 `/api/rooms/public`。

### FastAPI

- 唯一的帳戶及資料庫存取服務。
- 處理密碼雜湊、session、密碼重設、玩家統計及管理員讀取權限。
- 接受經服務憑證驗證的 Node.js 對局寫入；不接受瀏覽器提交勝負。

### PostgreSQL

儲存帳戶、session、房間中繼資料、對局與參與者資料。即時手牌、未公開身份及語音不寫入房間列表，也不以完整 canonical state 提供 HTTP 存取。

瀏覽器只使用同一網站來源：靜態檔案與 `/api` 由 Node.js 對外提供，`/ws` 連接 Node.js。FastAPI、PostgreSQL 只在 Compose 內部網絡服務，保留目前 Caddy HTTPS 入口。

## 3. 使用者流程與 UI

### 導覽與版面

登入後的導覽提供「遊戲大廳」「我的戰績」及帳戶選單；帳戶選單包含暱稱、登出。訪客看見登入及建立帳戶按鈕。

Dashboard 頂部以精簡卡片顯示參加場數、勝場、敗場與勝率。主要區域為「公開大廳」，旁邊提供「建立房間」及「輸入邀請碼」；下方為最近對局。手機版依序排列，主要操作保留至少 44px 點擊範圍。

公開大廳參考線上桌遊的可加入桌列表模式：每間房顯示房主暱稱、關卡、人數／6、等待狀態及「加入」。提供只顯示可加入房間與關卡篩選、手動重新整理；前景頁面每五秒更新一次，離頁及背景時停止輪詢。空列表、載入、更新失敗及房間剛滿均有可理解提示。

### 建立及加入

- 建立房間對話框顯示玩家暱稱與「公開房間 / Public room」開關，預設關閉。
- 公開房才會列在大廳；加入仍經伺服器核對狀態、人數及帳戶。
- 私人房沿用六碼邀請碼／連結，不會出現在公開列表。
- 已開始、已滿、已移除，或沒有在線玩家的房間不出現在可加入清單。
- 等待房顯示公開／私人標記；維持現有房主、準備、關卡、踢人、離房與房主交接行為。
- 同一帳戶不能同時佔據同一房間多個座位，亦不能同時參與多間正在運行的房間；重新連線恢復自己的座位。
- 分享邀請連結後，未登入者先登入，再返回原邀請目標。

開房後改變公開狀態不屬於第一版範圍；開房時的選擇適用於該房間生命週期。

### 登入與註冊

玩家登入欄位為電郵及密碼，附「忘記密碼」及「建立帳戶」。註冊要求電郵、1–24 字暱稱、密碼及確認密碼；前後端都驗證輸入。

電郵去除首尾空白並正規化大小寫；暱稱保留使用者輸入的大小寫。密碼不 trim，長度 12–128 字元。暱稱不作身份憑證，玩家帳戶以 UUID 識別。房內暱稱衝突需明確提示，不能冒認其他 user ID。

註冊成功後建立玩家 session 並進入 Dashboard。帳戶設定不加入未要求的社交登入、頭像上傳或公開排行榜。

### 忘記密碼

輸入電郵後一律顯示相同確認訊息，避免洩漏帳戶是否存在。重設 token 使用安全亂數，資料庫只存雜湊，30 分鐘到期，一次性使用。

重設頁要求新密碼及確認密碼。成功後撤銷所有舊玩家 session 與其他尚未使用的重設 token，要求重新登入。無效、已使用或過期 token 顯示重新申請入口。

開發環境使用 Mailpit 查看真實寄出的測試郵件；正式環境透過 SMTP 設定寄送。正式環境缺少郵件設定時健康檢查與日誌清楚報告，介面不虛報已寄出成功。token、密碼及完整重設連結不寫一般日誌。

### 管理員

管理員使用 `/admin/login`，成功後進入基本唯讀總覽，顯示玩家數、已完成／中斷對局數及分頁的玩家／對局列表。玩家 session 不能讀取管理員 API；管理員 session 不能用來佔玩家座位。

初始帳戶電郵按 `admin@now.com` 處理，將原訊息的反斜線視為格式轉義。密碼使用使用者指定值，透過 seed 環境變數傳入，僅儲存 Argon2id 雜湊。seed 可重跑且不覆寫既有管理員密碼，不提供公開管理員註冊。

## 4. 資料模型

全部主鍵使用 UUID，時間使用 PostgreSQL `timestamptz` 並以 UTC 儲存；前端按使用者時區顯示。電郵各自在玩家與管理員表內不分大小寫唯一，兩種身份沒有共享密碼或隱含權限。

| 表 | 主要欄位與用途 |
| --- | --- |
| `users` | `id`, `email`, `display_name`, `password_hash`, `is_active`, `created_at`, `updated_at`, `last_login_at` |
| `system_admins` | `id`, `email`, `display_name`, `password_hash`, `is_active`, `created_at`, `updated_at`, `last_login_at` |
| `user_sessions` | `id`, `user_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at` |
| `admin_sessions` | `id`, `system_admin_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at` |
| `password_reset_tokens` | `id`, `user_id`, `token_hash`, `created_at`, `expires_at`, `used_at` |
| `rooms` | `id`, `code`, `server_instance_id`, `created_by_user_id`, `is_public`, `created_at`, `closed_at`；房主當前身份以 Node.js 即時狀態為準 |
| `matches` | `id`, `room_id`, `round_number`, `level`, `status`, `started_at`, `ended_at`, `winning_faction`, `result_reason`, `abandon_reason` |
| `match_players` | `match_id`, `player_id`, `user_id`, `display_name_snapshot`, `role_id`, `faction_id`, `location_id`, `outcome` |
| `schema_migrations` | `version`, `checksum`, `applied_at`，由 migration runner 管理 |

`matches.status` 為 `in_progress`、`completed`、`abandoned`。`match_players.outcome` 為 `pending`、`win`、`loss`、`no_winner`、`abandoned`。開局先記錄參與者，角色與位置可於結算時補上，中斷抽牌的角色可為空。

約束包括：

- `(room_id, round_number)` 唯一；每次真正開局產生新 match UUID。
- 同一對局內 `user_id` 及 `player_id` 各自唯一，防止重複計算。
- session／重設 token 雜湊唯一；外鍵、非空、狀態值及有效時間皆有約束。
- 同一六碼房間代碼只允許一間未關閉房間，歷史房間可重用該代碼。
- 為玩家對局歷史、房間回合、有效 session、token 及對局狀態建立相應索引。
- 以 SQL view 產生基本玩家統計，避免額外維護易不同步的累加計數表。

不加入排行榜、評分／ELO、好友、付費或完整棋譜資料表。

## 5. 戰績定義與資料一致性

- **參加場數**：已成功持久化開局的對局數，包含進行中、完成與中斷；僅進入等待房不計算。
- **完成場數**：`completed` 對局數；另顯示進行中及中斷數以解釋總數。
- **勝場／敗場**：依現有 `result.winningPlayerIds` 判定，不能僅比較陣營，也不能相信客戶端。
- **無獲勝者**：`winningPlayerIds` 為空的完成局，所有參與者記為 `no_winner`，獨立顯示。
- **勝率**：`wins / (wins + losses)`；分母為零時顯示「—」。中斷及無獲勝者局不進分母。
- **連勝**：依結束時間與 match UUID 排序，勝增加、敗歸零；中斷及無獲勝者局略過。
- **遊玩時間**：已完成或中斷局的 `ended_at - started_at` 加總；平均時長只採完成局。
- **角色／陣營表現**：只使用完成局，列出場次、勝場及相同定義的勝率；樣本數始終可見。
- **最近對局**：分頁列出日期、關卡、人數、角色、結果、時長及結算原因；只讀取自己的紀錄。

Node.js 成功開局前，FastAPI 必須先以單一 transaction 保存對局及參與者。資料庫不可用時維持等待房並回報可重試錯誤，不開始一局無法記錄的遊戲。

結算時使用相同 match ID 原子更新結果及所有參與者。重送相同結算不增加場數；同一 match ID 的衝突結果拒絕寫入。結果寫入成功後才宣告戰績已保存。

若結算時資料庫暫時不可用，Node.js 保留待保存結果，畫面顯示「戰績保存中」並以有界退避重試；保存成功前禁止 rematch 覆蓋結果。若 Node.js 在結果持久化前中止，重啟後該局記為中斷，不捏造勝負。

同一房間的開局、玩家操作、離線／到期事件及結算串行處理，避免非同步驗證或寫入讓兩個操作同時通過同一版本檢查。延續現有 action ID 去重與 baseVersion 檢查。

Node.js 啟動時以新的 server instance ID 註冊，在單實例部署前提下關閉前一個遊戲實例的未關閉房間，並把未完成局標成中斷。FastAPI 自身重啟不結束仍在運行的 Node.js 對局。

## 6. API 與驗證邊界

### 對瀏覽器公開的 API

| 方法與路徑 | 行為 |
| --- | --- |
| `POST /api/auth/register` | 建立玩家並登入 |
| `POST /api/auth/login` | 玩家登入 |
| `POST /api/auth/logout` | 撤銷目前玩家 session |
| `GET /api/auth/me` | 玩家身份與 session 的 CSRF token |
| `POST /api/auth/forgot-password` | 申請重設郵件 |
| `POST /api/auth/reset-password` | 使用一次性 token 更新密碼 |
| `GET /api/rooms/public` | Node.js 提供即時、安全的公開房間摘要 |
| `GET /api/me/stats` | 玩家自己的統計 |
| `GET /api/me/matches` | 玩家自己的分頁對局列表 |
| `POST /api/admin/auth/login` | 管理員登入 |
| `POST /api/admin/auth/logout` | 管理員登出 |
| `GET /api/admin/auth/me` | 管理員身份與 CSRF token |
| `GET /api/admin/overview` | 管理員唯讀摘要 |
| `GET /api/admin/users` | 管理員分頁玩家列表，不含認證秘密 |
| `GET /api/admin/matches` | 管理員分頁對局列表，不含未公開角色 |

### 內部 API

FastAPI 的 `/internal/*` 提供玩家 session 驗證、遊戲實例登記、房間建立／關閉、對局開始／完成／中斷。以 Compose 內部網絡及服務憑證保護，Node.js HTTP proxy 明確拒絕公開存取 `/internal/*`，不能用任意代理路徑繞過。

玩家與管理員採用各自獨立的 opaque session cookie，設為 HttpOnly、SameSite=Lax；正式 HTTPS 設 Secure。玩家 session 期限七日、管理員八小時。資料庫只存 token 雜湊；身份憑證不放 URL 或 localStorage。

修改資料的 HTTP 請求驗證允許來源、JSON Content-Type 及已登入 session 的 CSRF token。CSRF token 由獨立服務秘密及目前 session token 以 HMAC 派生，經 `auth/me` 回傳並作固定時間比較；多個分頁可使用同一有效 session，不因讀取身份而互相撤銷 token。註冊、登入及密碼重設這些尚未登入的路徑仍驗證來源及 JSON Content-Type，並限制嘗試頻率。密碼使用 Argon2id，登入錯誤不透露電郵是否存在。

WebSocket 在 upgrade 驗證 Origin 及玩家 session，連線身份以伺服器驗證結果為準，不接受訊息自行指定帳戶。每個遊戲命令再次驗證 session；無有效 session 或 FastAPI 不可用時不執行狀態修改。語音信令沿用既有房內對象限制並定時驗證 session，撤銷／到期後關閉連線。

座位 token 繼續只作座位重連憑證，必須同時匹配登入 user ID。切換帳戶或登出時清除舊座位及語音資源，不能只靠舊 localStorage token 恢復別人的位置。登出等同斷線，遊戲中依現有重連／到期規則處理。

回應採用一致錯誤格式及繁體中文提示。列表一律限制分頁大小，私密 API 不容許用請求參數指定其他玩家來越權查詢。

## 7. Migration、seed 與部署

資料庫目錄固定為專案根目錄 `db/`，其中 `migration/001_initial.sql` 包含全部初始建表、索引、約束及統計 view，不拆成多個初始版本。

`db/migrate.py` 在 transaction 與 PostgreSQL advisory lock 中套用尚未執行的 migration，以版本及 checksum 防止重複執行或靜默修改已套用檔案。這是供 migration 使用的一個 runner，不與 ORM 自動建表並用。

`db/seed.py` 透過 `SEED_ADMIN_EMAIL` 及 `SEED_ADMIN_PASSWORD` 建立初始管理員；電郵預設為 `admin@now.com`，密碼由使用者設定，不把指定明文密碼寫入版控。`.env.example` 說明填入使用者指定值的方式，seed 重跑不更新舊帳戶。

Python 服務放在根目錄 `api/`，依賴以版本固定的 requirements 檔案管理，使用 Psycopg 與明確 SQL 讀寫，不另加一套 ORM migration 系統。

Compose 服務包含 PostgreSQL、一次性 migrate、FastAPI、既有 Node.js 及開發用 Mailpit。seed 以明確命令執行，非每次啟動重設管理員。PostgreSQL 使用持久化 volume，標準停止指令不刪除資料。開發與正式環境使用不同 project／volume。

Node.js 等待 FastAPI readiness，FastAPI readiness 驗證資料庫及 schema 已就緒。更新 `.env.example`、README、ARCHITECTURE、DESIGN、Dockerfile、Compose 及 Makefile，說明新服務、migration、seed、SMTP、資料備份與還原。

所有安裝、啟動、建置、型別檢查及測試延續現有 Docker-only 約定。若本機 Docker daemon 不可用，記錄實際阻擋，不以主機執行代替容器驗證。

## 8. 驗收與測試

- 空 PostgreSQL 套用 001 成功；重跑無副作用；checksum 不符會拒絕。
- seed 建立可登入管理員，重跑不覆寫密碼；玩家不能進管理員 API。
- 註冊、重複電郵、大小寫電郵登入、登出、session 到期與撤銷正常。
- Mailpit 收到重設郵件；token 到期、重用及其他帳戶越權均失敗；重設後舊 session 失效。
- 私人房不出現在公開清單；公開房的開局、滿員、關閉及無人在線會更新列表。
- 多帳戶從大廳加入、邀請碼加入、重連及房主交接正常，座位不能跨帳戶重用。
- 正常勝敗、無獲勝者、中斷、重複結算、rematch、新舊房碼重用都有正確場數。
- 統計與持久化對局一致；重啟 Node.js 或 FastAPI 不會刪除已保存戰績。
- 資料庫故障不會產生假的開局、重複戰績或錯誤的已保存提示。
- TypeScript 檢查、前後端 build、Python API／PostgreSQL 整合測試、既有規則測試及 Playwright 主要流程通過。
- React 遷移保留抽牌／傳牌、私密角色、投票、結果、觸控／鍵盤、語音及音量偏好的行為；375px、768px、1280px 與 reduced-motion 均可操作。

舊測試中直接匿名開房的 helper 與測試 bot 腳本需改成建立／登入測試玩家，再使用同一正式驗證流程；不加入繞過驗證的正式環境開關。

## 9. 已知限制與實作順序

第一版仍是一個 Node.js 遊戲實例；即時房間不支援多副本共享，也不恢復重啟前的未完成牌局。PostgreSQL 保存已完成戰績及中斷紀錄，不能被描述成即時牌局恢復功能。

建議依序完成資料庫與 FastAPI 帳戶、Node.js 帳戶及對局接駁、React／MUI 畫面遷移、公開大廳與戰績頁，最後執行容器整合與瀏覽器驗收。實作計畫在本規格確認後另行編寫，不在這份設計中假設未執行的驗證已通過。
