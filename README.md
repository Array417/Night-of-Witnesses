# 《目擊者之夜》多人網頁版 (Night of Witnesses)

一個支援公開部署、以邀請碼建立 3–6 人房間的繁體中文《目擊者之夜》權威伺服器網頁版。

---

## 聲明與守則 (Public Play & IP Notice)

- **非商業公開試玩**：公開部署時，任何人均可訪問網站及建立邀請碼房間；本專案不作商業用途或營利。
- **原創中立素材**：專案中所有介面視覺、按鈕、圖示與文字標籤皆為原創中立設計，嚴禁使用官方卡牌掃描圖、付費素材或逐字照抄出版品說明文字。
- **無官方背書**：本專案與原出版社（Swan Panasia / 新天鵝堡）無任何商業關係或官方背書。

---

## 系統需求

- **Docker Engine 與 Docker Compose**（例如 Docker Desktop，macOS 亦可用 Colima）
- **GNU Make**：Windows 可另外安裝，或在已安裝 Docker 與 make 的 WSL 環境使用。
- 所有 Dev 啟動、建置、型別檢查及自動化測試只可在 Docker 容器內執行；不要在主機直接執行 npm／Node.js。容器已包含 Node.js 與所需依賴，主機毋須安裝 Node.js。

---

## 本地 Dev（Docker-only）

### 一個指令建置及啟動

先啟動 Docker Engine，再在專案根目錄執行：

```bash
make start         # 建置 Dev 映像並背景啟動，等待健康檢查通過
make stop          # 停止並移除 Dev 容器、網路及 Dev 映像
```

瀏覽器前往 [http://localhost:3000](http://localhost:3000)。Dev 只啟動遊戲服務，
主機端只綁定 `127.0.0.1:3000`，不啟動 Caddy／coturn、不需要網域或 TURN 設定。
`compose.dev.yml` 使用獨立 project `night-of-witnesses-dev` 及映像
`night-of-witnesses-dev:latest`，不沿用正式部署的環境參數；`make stop` 不會停止部署服務或刪除正式映像／憑證。
停止或重啟 Dev 會清空該容器記憶體中的房間。`make stop` 不清除 Docker build cache。

程式及素材在建置時複製進映像；修改後重新執行 `make start` 套用，不提供 hot reload。

### 開發與測試指令（全部在容器內）

```bash
make help          # 指令說明
make build         # 只建置 Dev 映像並安裝容器內依賴
make install       # make build 的別名，不安裝主機依賴
make build-start   # make start 的別名
make check         # 建置後，在一次性容器中執行型別檢查
make test          # 建置後，在一次性容器中執行單元及整合測試
make test-e2e      # 在一次性容器安裝 Chromium 及系統依賴，執行 headless 測試
make test-manual   # 啟動 Dev，按提示用主機瀏覽器開三個視窗手動測試
```

自動化測試容器結束後會自動移除，測試不需要先啟動 Dev；E2E 的下載及系統依賴安裝亦只在容器內發生。
測試報告不會自動同步回主機，請以命令輸出查看結果。

### 單人測試：加入 3 個測試玩家

先用瀏覽器建立房間並記下 6 碼房間代碼，再在另一個 PowerShell 視窗執行：

```bash
docker compose -p night-of-witnesses-dev -f compose.dev.yml exec dev npm run add-bots -- ABC123
```

預設會加入 `Bot 1`、`Bot 2`、`Bot 3`。也可以指定名稱：

```bash
docker compose -p night-of-witnesses-dev -f compose.dev.yml exec dev npm run add-bots -- ABC123 Alice Bob Charlie
```

Bot 會自動準備、輪流選牌傳牌、在討論階段同意結束討論，以及在投票階段投票；請保持這個視窗運行。
你仍需要用瀏覽器中的房主玩家按「開始遊戲」。按 `Ctrl+C` 會讓測試玩家離線。

---

## 討論結束共識

- 討論階段沒有房主「進入投票」按鈕：每位連線玩家（含房主）各自按下同意，同意後不可收回。
- 全部連線玩家都同意時立即進入投票；過半數連線玩家同意時，伺服器啟動 15 秒倒數，時間到自動進入投票，倒數不會重設或延長。
- 斷線與重連會按當下連線人數重新計算；斷線玩家不能同意。
- 以伺服器的 `discussionConsents` 與 `discussionDeadlineAt` 為準，客戶端只顯示進度（已同意 / 連線中人數）。

---

## 語音通話（討論階段限定）

- 原生 WebRTC 全網狀連線，3–6 人房間；既有 WebSocket 只轉發信令（僅限討論階段、僅傳給目標玩家），伺服器不錄音、不保存任何語音。
- 麥克風預設關閉，需自行開啟並授權瀏覽器麥克風；離開討論階段或斷線時自動關閉。
- 收聽別人毋須開啟自己的 mic；若瀏覽器阻擋播放，在 Menu 按「開啟語音播放」。語音狀態依實際逐玩家連線更新。
- 麥克風需要 HTTPS（本機 `localhost` 除外）；未滿足時介面會提示無法使用。

---

## 音效與語音設定

- 所有階段的 Menu 集中靜音、環境聲、mic 開關、恢復播放及三個獨立滑桿：遊戲音效音量、對方語音音量（預設 0.8，範圍 0-1）、麥克風增益（預設 1，範圍 0-2）。
- 三者分開儲存在此瀏覽器的 `localStorage`，遊戲音效與語音偏好互不影響。
- 自建 TURN 及跨網絡驗收見 [語音部署說明](docs/voice-deployment.md)。

## 房間與卡牌操作

- 等待畫面的「← 返回大廳」正式離房並清除重連座位；房主交接給最早加入的在線玩家，空房自動移除。
- 當前回合可以用滑鼠或觸控拖動整張自己的卡，目標亮起後放下，確認公開宣稱才傳牌；Escape 或無效落點會還原。點選及鍵盤操作亦可使用。
- 角色、場地及卡背採用新生成的原版漫畫風插畫，圖片來源及生成紀錄見 [美術說明](public/art/README.md)。對手未公開卡牌使用統一卡背。

---

## 公開部署（macOS／Colima）

本專案提供多階段構建的 `Dockerfile`，以內建的非 root `node` 使用者運行，體積精簡且內建健康檢查。

### 一鍵部署（Colima + Docker Compose，對外 8213）

macOS 冇原生 Docker Engine，唔想裝 Docker Desktop 可以用 **Colima**（純 CLI 的 Linux VM）：

```bash
# 只需安裝一次
brew install colima docker docker-compose docker-buildx

# 複製環境設定，並填入公網 ORIGIN（見下方）
cp .env.example .env

# 一鍵啟動（會自動啟動 Colima、建置、開服、等待健康檢查）
make deploy         # 等同 ./scripts/docker-boot.sh

# 其他指令
./scripts/docker-boot.sh --logs       # 追蹤日誌
make stop-server                    # 等同 ./scripts/docker-boot.sh --stop
./scripts/docker-boot.sh --forward     # 用 NAT-PMP 命令列建立路由器 port forwarding
./scripts/docker-boot.sh --autostart  # Colima 登入自動啟動 + 安裝 port forwarding 續期服務
```

`docker-compose.yml` 將對外（主機）`8213` 對應到容器內部 `3000`，容器設 `restart: unless-stopped`。

`make deploy` 原樣呼叫現有 macOS／Colima 腳本，預設啟動遊戲及 Caddy；不會自動建立 DNS 或 router port forwarding。
先將網域 DNS 指向公網 IP、設定 `.env` 的 `ORIGIN`，並修改 `Caddyfile` 的網域。
`make stop-server` 保留正式映像及 Caddy 憑證，也不刪除 DNS 或 router 轉發。

要同時部署 coturn，先填好 `.env` 的 `TURN_HOST`、`TURN_EXTERNAL_IP`、`TURN_SHARED_SECRET`，再使用：

```bash
COMPOSE_PROFILES=voice make deploy
COMPOSE_PROFILES=voice make stop-server
```

coturn 另需開放／轉發 `3478` TCP+UDP 及 `49160–49200` UDP；既有 `--forward` 腳本不會替你配置這些 TURN 端口。

> **Port 與網址提醒**：只有 `80` (http) / `443` (https) 可以省略 port。用 8213 時網址一定要打 port，例如 `http://<公網IP或DDNS>:8213`。另外語音麥克風需要 **HTTPS**，用純 HTTP 玩時遠端語音會不可用，建議之後加反向代理（如 Caddy）走 443。

### 路由器 Port Forwarding 設定（外部 → 本機）

到路由器管理頁的 **Port Forwarding / Virtual Server（虛擬伺服器）** 新增一筆：

| 欄位 | 值 |
| :--- | :--- |
| 名稱 / Name | `NightOfWitnesses` |
| 通訊協定 / Protocol | `TCP`（WebSocket 亦走 TCP；如需最保險可選 `TCP+UDP`） |
| 外部端口 / External Port | `8213` |
| 內部端口 / Internal Port | `8213` |
| 內部 IP / Internal IP | 這台 Mac 的區網 IP（`ipconfig getifaddr en0`） |
| 啟用 / Enable | 是 |

設定後，外部網址為 `http://<公網IP或DDNS>:8213`。請同時把該網址填入 `.env` 的 `ORIGIN`，否則 WebSocket 會被來源檢查（CSWSH）擋下：

```dotenv
ORIGIN=http://1.2.3.4:8213
# 或用 DDNS 網域：
# ORIGIN=http://now.example.com:8213
```

### 無 UI 方法：用命令列 NAT-PMP 開 Port Forwarding（不在家都做到）

若路由器支援 **NAT-PMP**（多數家用路由器預設開啟），唔使登入管理頁，可以由呢部 Mac 用命令列要求路由器開放端口：

```bash
# 安裝一次
brew install libnatpmp

# 立即建立/更新轉發（對外 8213 -> 本機 8213 TCP，續期 7 日）
./scripts/docker-boot.sh --forward
```

或直接執行（可用 `-g` 指定閘道）：

```bash
natpmpc -g 192.168.0.1 -a 8213 8213 tcp 604800
```

> `docker-boot.sh --autostart` 會額外安裝一個每 30 分鐘自動續期的 LaunchAgent，
> 令路由器重開或 Mac 重開後，短時間內自動重新建立轉發。
> 日誌位於 `~/Library/Logs/nightofwitnesses.natpmp.log`。

**注意**：若路由器停用 UPnP / NAT-PMP，命令列方法就無法使用，仍須登入管理頁設定。
另外若 Mac 裝有 Tailscale，UPnP 的 SSDP 廣播可能被路由去 `utun` 而失敗，
此時改用上面的 NAT-PMP（unicast，唔受影響）即可。

### Caddy 自動 HTTPS（推薦，開埋語音功能）

`docker-compose.yml` 內建 `caddy` 服務，會自動向 Let's Encrypt 申請及續期憑證，並自動處理 WebSocket upgrade。啟用後對外網址為 `https://<你的DDNS域名>`（預設 443，免打 port）。

1. 編輯 `Caddyfile`，改成你嘅 DDNS／域名：
   `mcslimeserver.ddnsgeek.com { reverse_proxy now-game:3000 }`
2. 確保路由器已把 **80 同 443** 轉發到本機（NAT-PMP 腳本已預設包含：`./scripts/docker-boot.sh --forward`）。
3. 啟動：`make deploy`；用 `docker compose logs -f caddy` 睇簽證進度（成功會見 `certificate obtained successfully`）。
4. 於 `.env` 設定 `ORIGIN=https://<你的DDNS域名>`（可同時保留 http 版本）。

> **為何要 HTTPS？** `crypto.randomUUID()` 同麥克風（`getUserMedia`）只喺安全來源（HTTPS / localhost）可用。
> 純 HTTP 下建立房間會爆 `crypto.randomUUID is not a function`；本專案已加 fallback（`src/client/uuid.ts`）令 HTTP 都玩到，
> 但**語音仍然必須 HTTPS**。跨網路語音另需 STUN/TURN（見 `RTC_ICE_SERVERS_JSON`）。

---

## 公開部署（Render Web Service）

本遊戲包含 Node.js 伺服器及 WebSocket 房間服務，須建立 **Web Service**，不能選用只託管靜態檔案的服務。

1. 以本 repository 的 `master` branch 建立 Web Service，選擇根目錄的 `Dockerfile`。
2. 設定 `ORIGIN` 為部署後的完整 HTTPS 網址，例如 `https://your-service.onrender.com`；容器內的 `HOST` 維持 `0.0.0.0`。健康檢查路徑設為 `/healthz`。
3. 部署完成後檢查首頁、`/healthz`，並從兩個瀏覽器視窗測試建立與加入房間、開始、結束及重新開始。瀏覽器會透過同一網站的 WSS 連接 `/ws`。

Render 免費實例閒置後會休眠，重新啟動或重新部署會清空記憶體中的房間；進行中的局數會中斷。房間只存在單一伺服器實例，未加入跨實例共享狀態。公開網路上的 WebRTC 語音仍需另外設定可用的 STUN/TURN，否則不保證接通。

---

## 網路拓撲與連線配置

1. **網路邊界控制**：
   - 本遊戲不設公開房間清單、無搜尋配對機制，僅能透過 6 碼邀請代碼或連結進房。
   - **邀請碼不能取代網站存取控制**：公開部署時任何人都可訪問首頁及建立房間；若要限制訪客，應另外設定存取控制。私人部署可只綁定本機（`127.0.0.1`），或使用 **Tailscale**、WireGuard 等私有網路。
2. **反向代理與 HTTPS/WSS 終端**：
   - 若透過網際網路遠端連線，必須在前端架設反向代理（如 Caddy、Nginx），負責 **HTTPS** 與 **WSS (WebSocket Secure)** 憑證終端與加密。
   - 傳輸時請透過環境變數 `ORIGIN` 設定允許連線的合法來源網址（例如 `ORIGIN=https://now.your-private-domain.ts.net`），以防止跨來源 WebSocket 劫持 (CSWSH)。
   - 語音麥克風亦需 HTTPS（本機 `localhost` 除外），否則語音功能無法使用。
3. **記憶體架構與升級維護**：
   - 為極大化隱私與最小化基礎架構依賴，所有遊戲房間資料均保存於伺服器記憶體中。
   - **重啟即結束**：當容器重啟或伺服器程序重載時，當前進行中的遊戲房間將立即結束。
   - 本系統**不具備亦不需要資料庫備份**。一局遊戲約 10 分鐘，建議於局與局之間進行日常維護。
4. **語音 NAT 穿透（ICE）**：
   - 預設不設 ICE 伺服器，僅同區網通常可用；跨網路語音需要自行提供 STUN/TURN，否則不保證連通，也未經 NAT/TURN 實測驗證。
   - 以環境變數 `RTC_ICE_SERVERS_JSON` 設定（見下表），格式錯誤時退回無 ICE 伺服器。
   - ICE 清單會傳給房間內所有客戶端：TURN 帳密請用短期臨時憑證，切勿使用長期管理員密鑰。
   - 範例（佔位符，非真實憑證）：
     `[{"urls":["stun:stun.example.org:3478"]}, {"urls":["turn:turn.example.org:3478"], "username": "TEMP-USER", "credential": "TEMP-CREDENTIAL"}]`

---

## 環境變數合約

| 變數名稱 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `HOST` | `127.0.0.1` | 伺服器監聽之網路介面位址（容器內部設為 `0.0.0.0`） |
| `PORT` | `3000` | 伺服器監聽之通訊埠 |
| `ORIGIN` | `http://${HOST}:${PORT}` | 允許發起 WebSocket 連線的來源網址（支援逗號分隔多個來源） |
| `RTC_ICE_SERVERS_JSON` | `[]` | 語音用 ICE 伺服器清單（JSON 陣列，最多 8 筆，僅 `stun:`/`stuns:`/`turn:`/`turns:`；帳密會傳給客戶端，請用短期 TURN 憑證） |
| `TURN_HOST` | 空白 | 自建 TURN 的公網域名或 IPv4；啟用時外部 ICE 清單最多 6 筆 |
| `TURN_SHARED_SECRET` | 空白 | 伺服器及 coturn 共用簽名秘密；只在伺服器保存 |
| `TURN_EXTERNAL_IP` | 空白 | coturn 對外公網 IPv4，供 Docker Compose 使用 |

---

## 測試驗證指令

```bash
# 型別驗證
make check

# 單元與協定測試 (TAP 格式輸出)
make test

# 端到端瀏覽器測試 (Playwright Chromium)
make test-e2e
```
