#!/usr/bin/env bash
# 《目擊者之夜》Docker 一鍵啟動（macOS + Colima，無需 Docker Desktop）
#
# 用法:
#   ./scripts/docker-boot.sh              # 啟動 Colima + build + 開服
#   ./scripts/docker-boot.sh --autostart  # 額外設定 Colima 登入時自動啟動（開機自動開服）
#   ./scripts/docker-boot.sh --logs       # 追蹤容器日誌
#   ./scripts/docker-boot.sh --stop       # 停止容器
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

EXTERNAL_PORT="${EXTERNAL_PORT:-8213}"
SUPPORT_DIR="${HOME}/Library/Application Support/NightOfWitnesses"
LAUNCH_AGENT="${HOME}/Library/LaunchAgents/com.nightofwitnesses.natpmp.plist"
AGENT_LABEL="com.nightofwitnesses.natpmp"

# --- 確保 docker compose 外掛可用（Homebrew 安裝後有時未 link）---
ensure_compose_plugin() {
  if docker compose version >/dev/null 2>&1; then
    return 0
  fi
  local src
  src="$(command -v docker-compose || true)"
  if [[ -n "${src}" ]]; then
    mkdir -p "${HOME}/.docker/cli-plugins"
    ln -sf "${src}" "${HOME}/.docker/cli-plugins/docker-compose"
  fi
  docker compose version >/dev/null 2>&1
}

install_natpmp_agent() {
  # 將續期腳本放到非 TCC 保護目錄（LaunchAgent 讀唔到 ~/Desktop）
  mkdir -p "${SUPPORT_DIR}" "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs"
  cp "${ROOT}/scripts/natpmp-forward.sh" "${SUPPORT_DIR}/natpmp-forward.sh"
  chmod +x "${SUPPORT_DIR}/natpmp-forward.sh"

  cat > "${LAUNCH_AGENT}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SUPPORT_DIR}/natpmp-forward.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/nightofwitnesses.natpmp.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/nightofwitnesses.natpmp.log</string>
</dict>
</plist>
PLIST

  launchctl bootout "gui/$(id -u)/${AGENT_LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "${LAUNCH_AGENT}"
  launchctl enable "gui/$(id -u)/${AGENT_LABEL}"
  launchctl kickstart -k "gui/$(id -u)/${AGENT_LABEL}"
}

case "${1:-}" in
  --stop)
    echo "[boot] 停止 ${EXTERNAL_PORT} 服務…"
    docker compose --profile voice down
    exit 0
    ;;
  --logs)
    docker compose logs -f --tail=100
    exit 0
    ;;
  --forward)
    echo "[boot] 立即以 NAT-PMP 建立/更新路由器 port forwarding（80/443/8213）…"
    mkdir -p "${SUPPORT_DIR}"
    cp "${ROOT}/scripts/natpmp-forward.sh" "${SUPPORT_DIR}/natpmp-forward.sh"
    chmod +x "${SUPPORT_DIR}/natpmp-forward.sh"
    "${SUPPORT_DIR}/natpmp-forward.sh"
    exit 0
    ;;
  --autostart)
    echo "[boot] 設定 Colima 於登入時自動啟動（開機自動開服）…"
    brew services start colima
    echo "[boot] 安裝 NAT-PMP 續期 LaunchAgent（每 30 分鐘）…"
    install_natpmp_agent
    echo "[boot] 完成。日誌：${HOME}/Library/Logs/nightofwitnesses.natpmp.log"
    exit 0
    ;;
esac

echo "[boot] 檢查 Colima（Docker Linux VM）狀態…"
if ! colima status >/dev/null 2>&1; then
  echo "[boot] 未啟動，正在啟動 Colima…"
  colima start
else
  echo "[boot] Colima 已在運行。"
fi

if ! ensure_compose_plugin; then
  echo "[boot] 錯誤：找不到 docker compose。請先執行：brew install docker-compose" >&2
  exit 1
fi

# 若未有 .env 但有 .env.example，提供提示
if [[ ! -f .env && -f .env.example ]]; then
  echo "[boot] 提示：未找到 .env，將用 docker-compose.yml 預設值（只適合本地測試）。"
  echo "[boot]       要開放互聯網，請執行：cp .env.example .env 並填入公網 ORIGIN。"
fi

echo "[boot] 建置映像檔並啟動容器（對外 ${EXTERNAL_PORT} -> 容器 3000）…"
# Read resolved settings without printing the TURN shared secret.
COMPOSE_CONFIG="$(docker compose --profile voice config --format json)"
COMPOSE_ARGS=()
if printf '%s' "${COMPOSE_CONFIG}" | grep -qE '"TURN_SHARED_SECRET": "[^"]+"'; then
  for SETTING in TURN_HOST TURN_EXTERNAL_IP; do
    if ! printf '%s' "${COMPOSE_CONFIG}" | grep -qE "\"${SETTING}\": \"[^\"]+\""; then
      echo "[boot] 錯誤：自建語音中繼需要設定 ${SETTING}。" >&2
      exit 1
    fi
  done
  COMPOSE_ARGS=(--profile voice)
  echo "[boot] 已啟用自建 TURN 語音中繼（3478 TCP/UDP；49160–49200 UDP）。"
else
  echo "[boot] 未設定自建 TURN；跨網絡語音需於 RTC_ICE_SERVERS_JSON 設定可用的外部 TURN。"
fi
unset COMPOSE_CONFIG
docker compose "${COMPOSE_ARGS[@]}" up -d --build

echo "[boot] 等待健康檢查…"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${EXTERNAL_PORT}/healthz" >/dev/null 2>&1; then
    echo "[boot] 服務已就緒。"
    echo "[boot] 本地網址: http://localhost:${EXTERNAL_PORT}"
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
    if [[ -n "${LAN_IP}" ]]; then
      echo "[boot] 區網網址: http://${LAN_IP}:${EXTERNAL_PORT}"
    fi
    echo "[boot] 互聯網:   http://<你的公網IP或DDNS>:${EXTERNAL_PORT}（需先在路由器設定 port forwarding）"
    exit 0
  fi
  sleep 1
done

echo "[boot] 錯誤：服務逾時未通過健康檢查。最近日誌：" >&2
docker compose logs --tail=50 >&2
exit 1
