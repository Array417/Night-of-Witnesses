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
3. **記憶體架構與升級維護**：
   - 為極大化隱私與最小化基礎架構依賴，所有遊戲房間資料均保存於伺服器記憶體中。
   - **重啟即結束**：當容器重啟或伺服器程序重載時，當前進行中的遊戲房間將立即結束。
   - 本系統**不具備亦不需要資料庫備份**。一局遊戲約 10 分鐘，建議於局與局之間進行日常維護。

---

## 環境變數合約

| 變數名稱 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `HOST` | `127.0.0.1` | 伺服器監聽之網路介面位址（容器內部設為 `0.0.0.0`） |
| `PORT` | `3000` | 伺服器監聽之通訊埠 |
| `ORIGIN` | `http://${HOST}:${PORT}` | 允許發起 WebSocket 連線的來源網址（支援逗號分隔多個來源） |

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
