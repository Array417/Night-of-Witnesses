# 《目擊者之夜》多人網頁版 (Night of Witnesses)

一個專供私人朋友群組遊玩的繁體中文《目擊者之夜》3–6 人權威伺服器網頁版。

---

## 聲明與守則 (Private Use & IP Notice)

- **非商業與私人使用**：本專案僅供私人朋友圈內部同樂使用，絕不用於商業用途、公開發行、營利或向不特定公眾提供服務。
- **原創中立素材**：專案中所有介面視覺、按鈕、圖示與文字標籤皆為原創中立設計，嚴禁使用官方卡牌掃描圖、付費素材或逐字照抄出版品說明文字。
- **無官方背書**：本專案與原出版社（Swan Panasia / 新天鵝堡）無任何商業關係或官方背書。

---

## 系統需求

- **Node.js**：`>= 24.12.0`（包含原生 TypeScript 執行環境）
- **或 Docker**：任何支援標準 OCI 容器的容器執行環境（如 Docker Desktop、Podman）

---

## 快速啟動 (Local Node.js)

### 1. 安裝相依套件與建置

```powershell
# 安裝相依套件
npm ci

# 執行型別檢查
npm run check

# 執行單元與整合測試
npm test

# 建置前端與後端
npm run build
```

### 2. 啟動服務

```powershell
# 使用預設設定啟動（監聽 127.0.0.1:3000）
npm run start
```

服務啟動後，瀏覽器前往 [http://127.0.0.1:3000](http://127.0.0.1:3000) 即可開始遊戲。

### 單人測試：加入 3 個測試玩家

先用瀏覽器建立房間並記下 6 碼房間代碼，再在另一個 PowerShell 視窗執行：

```powershell
npm run add-bots -- ABC123
```

預設會加入 `Bot 1`、`Bot 2`、`Bot 3`。也可以指定名稱：

```powershell
npm run add-bots -- ABC123 Alice Bob Charlie
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
- 若瀏覽器阻擋自動播放，請按「開啟語音播放」手動啟用。
- 麥克風需要 HTTPS（本機 `localhost` 除外）；未滿足時介面會提示無法使用。

---

## 音效與語音設定

- 右下角設定面板提供三個獨立滑桿：遊戲音效音量、對方語音音量（預設 0.8，範圍 0-1）、麥克風增益（預設 1，範圍 0-2）。
- 三者分開儲存在此瀏覽器的 `localStorage`，遊戲音效與語音偏好互不影響。

---

## 容器化部署 (Docker)

本專案提供多階段構建的 `Dockerfile`，以內建的非 root `node` 使用者運行，體積精簡且內建健康檢查。

### 1. 建置 Docker 映像檔

```bash
docker build -t night-of-witnesses:latest .
```

### 2. 啟動容器

```bash
# 本地限定綁定 (推薦)
docker run --rm -d \
  --name now-game \
  -p 127.0.0.1:3000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e ORIGIN=http://localhost:3000 \
  night-of-witnesses:latest
```

### 3. 檢查容器狀態與健康度

```bash
curl.exe -fsS http://localhost:3000/healthz
# 預期回傳: {"ok":true}
```

### 4. 停止容器

```bash
docker stop now-game
```

---

## 網路拓撲與私密連線配置

1. **網路邊界控制**：
   - 本遊戲不設公開房間清單、無搜尋配對機制，僅能透過 6 碼邀請代碼或連結進房。
   - **邀請碼不能取代網路存取控制**：建議僅將服務綁定於本機（`127.0.0.1`），或透過私有虛擬網路（如 **Tailscale**、WireGuard 或家用語音通訊伺服器內部網路）供受信任的朋友連線。
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

---

## 測試驗證指令

```powershell
# 型別驗證
npm run check

# 單元與協定測試 (TAP 格式輸出)
npm test

# 端到端瀏覽器測試 (Playwright Chromium)
npm run test:e2e
```
