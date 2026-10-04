# 自建語音中繼及驗收

目前本機真實 WebRTC 收音測試正常。HTTPS 只解決瀏覽器安全來源；不同網絡玩家仍可能需要 TURN 中繼。

2026-10-04 線上探測：`https://mcslimeserver.ddnsgeek.com` 的 HTTPS／WSS 可連線，但 `welcome.iceServers` 為空陣列，沒有 STUN／TURN 憑證；舊版 `leave` 回覆 `ACTION_FAILED / Unhandled action`。探測只建立一個診斷座位，隨後斷線，未收音或修改既有玩家房間。需部署本次新版後重新驗收，這些結果並未重現或排除所有 mic／播放問題。

## 部署

在部署主機 `.env` 設定 `ORIGIN=https://你的遊戲域名`、`TURN_HOST=你的遊戲域名`、`TURN_EXTERNAL_IP=目前公網IPv4`、`TURN_SHARED_SECRET=隨機秘密`。不要將秘密提交到 Git。

產生秘密：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`。

執行 `docker compose --profile voice up -d --build`。coturn 提供 STUN 與 TURN UDP/TCP，遊戲伺服器沿用 `welcome.iceServers` 發給已加入玩家 5 小時有效的簽名憑證；不是將共享秘密發到客戶端。既有 `RTC_ICE_SERVERS_JSON` 可保留最多 6 筆外部 ICE 設定。

路由器及主機防火牆需轉發／開放 **3478 TCP、3478 UDP、49160–49200 UDP**，外部與內部中繼端口必須相同。Caddy 繼續處理 80/443 網頁入口，TURN 不經 HTTP reverse proxy。若公網 IP 改變，更新 `TURN_EXTERNAL_IP` 後重新啟動 coturn。CGNAT 下需要可被公網存取的部署主機。

UDP 與 TCP 中繼均使用 3478；此版本不新增 TURN TLS。禁止 3478 的網絡仍可能需要另外配置可達的 TURN 服務。

## 驗收

1. 用 HTTPS 建立 3 人房間；至少一人使用手機流動數據，另一人使用 Wi-Fi。
2. 到討論階段，在 Menu 開 mic；其他人保持 mic 關閉也應聽到聲音。
3. 若播放被阻擋，從 Menu 按「開啟語音播放」。
4. Menu →「語音與音效設定」→「檢查語音連線」顯示權限、AudioContext 狀態、逐玩家 ICE／訊令狀態及收發 bytes。連通玩家的 inboundBytes／outboundBytes 應持續增加。
5. 開關 mic、重新整理其中一位玩家，驗證可恢復；進入投票後 mic 音軌應停止。

強制中繼驗證：在獨立測試瀏覽器啟動頁面前，把原生 RTCPeerConnection 包裝為 `new NativeConnection({ ...config, iceTransportPolicy: 'relay' })`，保持完整的原生媒體路徑。先跑 `tests/e2e/turn-relay.spec.ts` 的 TURN relay 案例（需 `TURN_TEST_HOST`、`TURN_TEST_SECRET`）；候選類型須為 `relay` 且音訊 bytes／能量增加。不要把測試用 relay 限制套用到正式玩家。

本機測試與設定檢查不代表已完成公網驗收；部署端開端口及實際不同網絡測試是最後一步。

參考：[coturn Docker](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md)、[TURN REST 驗證](https://github.com/coturn/coturn/blob/master/README.turnserver)。
