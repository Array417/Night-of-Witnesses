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
# Colima port forwarder：grpc 支援 UDP（自建 TURN 需要），但有已知隨機失效 bug
# （abiosoft/colima#1376：容器健康但 host 由非 loopback 連 mapped port 會 hang）。
# 策略：預設用 grpc；偵測到失效就自動退回 ssh。
PORT_FORWARDER="${PORT_FORWARDER:-grpc}"
COLIMA_CONFIG="${HOME}/.colima/default/colima.yaml"
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

# --- 確保 docker CLI 連到 Colima 嘅 daemon ---
# Colima 重啟後，Docker 嘅 context 有時會遺失／仍指向唔存在嘅 /var/run/docker.sock，
# 令 `docker compose up` 報 "failed to connect to the docker API"。
# 呢度只喺「現用 context 連唔到」先修正；如果本身通（例如 Docker Desktop）就完全唔郁。
COLIMA_SOCKET="${HOME}/.colima/default/docker.sock"

ensure_docker_daemon() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if [[ ! -S "${COLIMA_SOCKET}" ]]; then
    echo "[boot] 錯誤：Docker daemon 連唔到，亦搵唔到 Colima socket（${COLIMA_SOCKET}）。" >&2
    return 1
  fi
  echo "[boot] 偵測到 docker CLI 未指向 Colima，正在修正 context…"
  if ! docker context inspect colima >/dev/null 2>&1; then
    docker context create colima --description "Colima" \
      --docker "host=unix://${COLIMA_SOCKET}" >/dev/null
  fi
  docker context use colima >/dev/null
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  # 最後手段：只喺本次執行用環境變數，唔改動全域設定。
  export DOCKER_HOST="unix://${COLIMA_SOCKET}"
  docker info >/dev/null 2>&1
}

# --- Colima port forwarder 保護（見頂部 PORT_FORWARDER 說明）---
# 讀取 Colima 現用 port forwarder（grpc / ssh / none）
colima_port_forwarder() {
  [[ -f "${COLIMA_CONFIG}" ]] || return 0
  grep -m1 '^[[:space:]]*portForwarder:' "${COLIMA_CONFIG}" 2>/dev/null \
    | sed -E 's/^[^:]*:[[:space:]]*//' || true
}

# 等服務喺 loopback 通過健康檢查（最多 30 秒）
wait_for_loopback_health() {
  local i
  for i in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${EXTERNAL_PORT}/healthz" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# 由【非 loopback】位址探測：loopback 通但呢度唔通 = port forwarder 失效
lan_forward_works() {
  local ip="$1" i
  [[ -n "${ip}" ]] || return 1
  for i in $(seq 1 8); do
    curl -fsS --max-time 3 "http://${ip}:${EXTERNAL_PORT}/healthz" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

switch_colima_forwarder() {
  local mode="$1"
  echo "[boot] 重啟 Colima 並切換 port forwarder → ${mode}（容器會自動回復）…"
  colima stop >/dev/null 2>&1 || true
  colima start --port-forwarder="${mode}"
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
  echo "[boot] 未啟動，正在啟動 Colima（port forwarder: ${PORT_FORWARDER}）…"
  colima start --port-forwarder="${PORT_FORWARDER}"
else
  echo "[boot] Colima 已在運行（port forwarder: $(colima_port_forwarder)）。"
fi

if ! ensure_docker_daemon; then
  echo "[boot] 錯誤：無法連線 Docker daemon，請檢查 Colima（colima status）或 Docker 設定。" >&2
  exit 1
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
# 以 ${arr[@]+...} 展開：相容 macOS 內建 bash 3.2 的 set -u（空陣列展開會被視為未設定變數）
docker compose ${COMPOSE_ARGS[@]+"${COMPOSE_ARGS[@]}"} up -d --build

echo "[boot] 等待健康檢查…"
if ! wait_for_loopback_health; then
  echo "[boot] 錯誤：服務逾時未通過健康檢查。最近日誌：" >&2
  docker compose logs --tail=50 >&2
  exit 1
fi

# 偵測 Colima port forwarder 失效：loopback 通，但由區網位址連唔到。
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [[ -n "${LAN_IP}" ]] && ! lan_forward_works "${LAN_IP}"; then
  CURRENT_FWD="$(colima_port_forwarder)"
  if [[ "${CURRENT_FWD}" == "ssh" ]]; then
    echo "[boot] 警告：區網 ${LAN_IP}:${EXTERNAL_PORT} 仍然連唔到，請手動檢查 Colima。" >&2
  else
    echo "[boot] 偵測到 Colima '${CURRENT_FWD:-未知}' port forwarder 失效（loopback 通、區網唔通），自動改用 ssh…"
    switch_colima_forwarder ssh
    if ! ensure_docker_daemon; then
      echo "[boot] 錯誤：切換 forwarder 後仍連唔到 Docker daemon。" >&2
      exit 1
    fi
    docker compose ${COMPOSE_ARGS[@]+"${COMPOSE_ARGS[@]}"} up -d
    if ! wait_for_loopback_health; then
      echo "[boot] 錯誤：切換 forwarder 後服務未通過健康檢查。" >&2
      docker compose logs --tail=50 >&2
      exit 1
    fi
    if lan_forward_works "${LAN_IP}"; then
      echo "[boot] 已改用 ssh forwarder，區網連線正常（注意：ssh 唔支援 UDP，TURN 會自動改用 TCP）。"
    else
      echo "[boot] 警告：切換後區網仍連唔到，請手動檢查 Colima。" >&2
    fi
  fi
fi

echo "[boot] 服務已就緒。"
echo "[boot] 本地網址: http://localhost:${EXTERNAL_PORT}"
if [[ -n "${LAN_IP}" ]]; then
  echo "[boot] 區網網址: http://${LAN_IP}:${EXTERNAL_PORT}"
fi
echo "[boot] 互聯網:   http://<你的公網IP或DDNS>:${EXTERNAL_PORT}（需先在路由器設定 port forwarding）"
exit 0
