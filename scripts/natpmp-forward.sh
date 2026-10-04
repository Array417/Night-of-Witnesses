#!/usr/bin/env bash
# 《目擊者之夜》用 NAT-PMP 以命令列方式建立/更新路由器 Port Forwarding
# 路由器要支援 NAT-PMP（多數家用路由器都有）。此腳本由 LaunchAgent 定時執行以續期。
set -euo pipefail

# LaunchAgent 的 PATH 精簡，補上 Homebrew（natpmpc）位置
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

# 要對外開放的 port（空白分隔）。80/443 供 Caddy HTTPS，8213 供直接 HTTP。
PORTS="${PORTS:-8213 80 443}"
PROTOCOL="${PROTOCOL:-tcp}"          # tcp / udp
LIFETIME="${LIFETIME:-604800}"       # 7 日，逾時前自動續期

# 優先用 en0 的 DHCP 路由器位址，否則用預設閘道
GATEWAY="${GATEWAY:-$(ipconfig getoption en0 router 2>/dev/null || true)}"
if [[ -z "${GATEWAY}" ]]; then
  GATEWAY="$(route -n get default 2>/dev/null | awk '/gateway:/{print $2; exit}')"
fi

if ! command -v natpmpc >/dev/null 2>&1; then
  echo "[natpmp] 找不到 natpmpc，請先執行：brew install libnatpmp" >&2
  exit 1
fi

if [[ -z "${GATEWAY}" ]]; then
  echo "[natpmp] 無法判斷路由器閘道位址。" >&2
  exit 1
fi

STATUS=0
for PORT in ${PORTS}; do
  OUT="$(natpmpc -g "${GATEWAY}" -a "${PORT}" "${PORT}" "${PROTOCOL}" "${LIFETIME}" 2>&1 || true)"
  echo "[natpmp $(date '+%Y-%m-%d %H:%M:%S')] gateway=${GATEWAY} ${PROTOCOL} 對外 ${PORT} -> 本機 ${PORT}"
  echo "${OUT}"
  if ! echo "${OUT}" | grep -q 'Mapped public port'; then
    echo "[natpmp] 錯誤：port ${PORT} 未成功建立轉發。" >&2
    STATUS=1
  fi
done

exit "${STATUS}"
