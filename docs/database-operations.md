# 帳戶與 PostgreSQL 操作

所有程式啟動、建置及測試均在 Docker 內執行；主機只需 Docker Engine／Compose，Make 可選。

## 本地開發

先複製 `.env.example` 為 `.env`。為 `POSTGRES_PASSWORD`、`INTERNAL_API_SECRET`、`CSRF_SECRET` 各設定一組不同、至少 32 字元的安全亂數；資料庫密碼建議用十六進位，避免 URL 特殊字元需要編碼。填入初始 `SEED_ADMIN_PASSWORD`，預設管理員電郵為 `admin@now.com`。`.env` 已被 Git 及 Docker build context 排除。

```powershell
docker compose -f compose.dev.yml up -d --build --wait dev
docker compose -f compose.dev.yml --profile tools run --rm seed
```

遊戲在 http://localhost:3000；Mailpit 在 http://localhost:8025。玩家在網站註冊；玩家及管理員均使用 `/login`，後端驗證管理權限後自動導向 `/admin`，舊 `/admin/login` 會轉至共用登入。兩種帳戶資料表及 session 仍分開；切換身份會撤銷目前瀏覽器的另一種 session，不讓普通玩家沿用管理權限。普通註冊不能指定管理員角色。Dev 的所有重設郵件只送到 Mailpit。

管理員身份取決於 `system_admins` 中有效帳戶及正確密碼，不寫死電郵。若管理員與玩家有相同電郵，依各自密碼辨識；若兩者電郵與密碼完全相同，管理員身份優先。管理員帳戶仍非遊戲玩家帳戶，不能以管理 session 加入遊戲。

## Migration 與 seed

`db/migration/001_initial.sql` 一次建立完整初始 schema，包括玩家、管理員、sessions、重設 tokens、房間、對局、參與者及基本統計 view。`db/migrate.py` 以 PostgreSQL advisory lock、單一 transaction 及 SHA-256 checksum 記錄版本。相同 migration 重跑不變；已套用內容被修改時拒絕執行。

```powershell
docker compose -f compose.dev.yml run --build --rm migrate
docker compose -f compose.dev.yml --profile tools run --rm seed
```

seed 只新增不存在的管理員，既有密碼不會被改回初始值。指定密碼經環境變數傳入，資料庫只保存 Argon2id 雜湊。不要把真實密碼放進 migration、README 或命令列參數。

未來 schema 修改應新增下一個 migration，不能改寫已套用的 001。首次建立資料庫時不可先以其他工具建出部分相同表。

## 正式設定

`docker-compose.yml` 使用獨立 PostgreSQL volume，API 與資料庫沒有公開 host port。Node.js 對外提供前端、WebSocket、公開房清單及公開帳戶 API 代理；`/internal/*` 不會代理到 FastAPI。Caddy 的 HTTPS 入口繼續沿用。

日常本地 Docker 開發及測試用 `compose.dev.yml`；正式部署用 `docker-compose.yml`（`docker compose` 預設讀取它）。兩者 project、資料庫 volume 及映像分開；正式環境不包含 Mailpit，也不啟用測試服務。

Caddy 覆寫客戶端 IP header，並以內部 secret 識別代理；Node 只接受經此識別的 IP，其他連線用實際 TCP peer。Node 再以 HMAC 簽署 IP 給 FastAPI，讓每位客戶端獨立限流，瀏覽器偽造的 forwarding headers 無效。若更換入口代理，必須維持此信任邊界；不要把內部 secret 放進前端或對外回應。

必填：`POSTGRES_PASSWORD`、`INTERNAL_API_SECRET`、`CSRF_SECRET`、`PUBLIC_APP_URL`、`ORIGIN`、`SMTP_HOST`。設定 `SMTP_PORT`、`SMTP_FROM`，按郵件供應商設定 `SMTP_USER`、`SMTP_PASSWORD`、`SMTP_TLS=starttls`（587）或 `tls`（465）。`none` 只適用內部測試郵件服務。

`PUBLIC_APP_URL` 是重設連結的可信來源，也決定正式 cookie 是否使用 Secure；正式網站應設為 HTTPS。`ORIGIN` 須列出瀏覽器實際來源，可逗號分隔。API 的 `/readyz` 會檢查 DB、001 版本及郵件配置；缺少設定時 Node 不會啟動成匿名服務。

正式 seed：

```powershell
docker compose --profile tools run --rm seed
```

## 保存、重啟與統計定義

帳戶與戰績保留在 PostgreSQL；一般 `down`／`make stop` 不移除 volume。不要對要保留的資料使用 `down -v`。

即時牌局仍存在單一 Node 記憶體，無多副本共享及牌局恢復。Node 重啟後把前一實例的未完成局記為中斷；FastAPI 自身重啟不取消 Node 中仍在運行的牌局。已完成戰績不受服務重啟影響。

開局資料保存成功後才進入遊戲；對局結果由權威伺服器保存，以 match UUID 防止重送重複計算。結果尚未保存時禁止重新開局。中斷不算敗局，無獲勝者獨立統計，勝率只計勝／敗；等待房不計參加場數。

## 備份與還原

備份不要經 PowerShell 二進位重新導向，直接在 PostgreSQL 容器產生檔案再複製：

```powershell
docker compose exec postgres pg_dump -U now -d now -Fc -f /tmp/now-backup.dump
docker compose cp postgres:/tmp/now-backup.dump ./now-backup.dump
```

備份含玩家電郵及認證雜湊，請以私密、加密儲存處理，不提交到 repository。還原會覆寫目標資料，先確認正確環境及備份，停止遊戲及 API，然後由操作者明確執行：

```powershell
docker compose stop now-game api
docker compose cp ./now-backup.dump postgres:/tmp/now-backup.dump
docker compose exec postgres pg_restore -U now -d now --clean --if-exists --no-owner /tmp/now-backup.dump
docker compose up -d api now-game
```

Dev 使用相同命令時加上 `-f compose.dev.yml`，遊戲服務名稱為 `dev`。還原操作不會在自動測試或正常啟動時執行。

## 測試

```powershell
docker compose -f compose.dev.yml --profile test run --build --rm api-test
docker compose -f compose.dev.yml run --build --rm --no-deps dev npm run check
docker compose -f compose.dev.yml run --rm --no-deps dev npm test
make test-e2e
```

API 測試使用獨立的 `test-postgres`、`now_test` 資料庫及 tmpfs，不能指向 Dev／正式 DB。瀏覽器測試對 Dev 建立帶隨機電郵的測試玩家，不會清空既有玩家。

`make test-e2e` 將桌面／手機分批執行，每批前重建並等待 Dev API healthy，清除上一批的記憶體限流計數，但不清空資料庫或撤銷已保存 sessions。大量測試註冊不需要降低正式限流。測試時 Dev API 會短暫重啟，請勿同時手動測試牌局。直接執行 browser-test 時可加 `npm run test:e2e -- --project=chromium` 或 `--project=mobile-chromium` 選批次；連續重跑也可能觸發正常限流。

預設瀏覽器回歸為 `accounts-dashboard.spec.ts`、`react-gameplay.spec.ts` 及 `voice-media.spec.ts`：包含桌面／手機帳戶、真實三人結算及重開局、鍵盤、原生滑鼠／觸控拖牌、六人 375／768／1280px、reduced motion、秘密 DOM 檢查，以及真正 Chromium WebRTC 音訊、重連和資源釋放。

舊的匿名首頁、drawer 及精確 DOM／翻牌動畫斷言不再對應 React UI，保留為歷史參考，不宣稱它們通過。底層規則、協定及語音的全部 Node 測試仍照常執行。需要檢視舊 Playwright 案例時，可在容器設定 `LEGACY_E2E=1`，但它們尚未全部遷移，不能當作目前驗收指令。
