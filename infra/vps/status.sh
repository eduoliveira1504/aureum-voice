#!/usr/bin/env bash
# One-screen health of the VPS (PHASE3 block 3.18, item 8): CPU, memory, disk, this month's
# traffic and the containers. Read-only. Run on the VPS: bash ~/aureum/infra/vps/status.sh
set -uo pipefail

cd "$(dirname "$0")/../.."
C=(docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml)

section() { printf '\n== %s\n' "$*"; }

section "host"
echo "$(hostname) · up $(uptime -p | sed 's/^up //') · $(nproc) vCPU · load $(cut -d' ' -f1-3 /proc/loadavg)"
top -bn1 | awk -F',' '/^%Cpu/ { for (i = 1; i <= NF; i++) if ($i ~ /id/) { gsub(/[^0-9.]/, "", $i); printf "CPU in use: %.0f%%\n", 100 - $i } }'

section "memory"
free -h | awk 'NR == 1 || /^Mem|^Swap/'

section "disk"
df -h / | awk 'NR == 2 { print "/: " $3 " used of " $2 " (" $5 "), " $4 " free" }'
[ -d "$HOME/backups" ] && echo "backups: $(du -sh "$HOME/backups" | cut -f1) in $(find "$HOME/backups" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l) day(s)"
docker system df --format '{{.Type}}: {{.Size}} ({{.Reclaimable}} reclaimable)'

section "traffic this month"
if command -v vnstat >/dev/null 2>&1; then
  # Counts from when vnstat was installed; the first minutes say "No data".
  vnstat -m 1
else
  echo "vnstat not installed"
fi

section "containers"
"${C[@]}" ps --format 'table {{.Service}}\t{{.Status}}'
echo
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}'

section "last backup"
if systemctl list-timers aureum-backup.timer --no-legend 2>/dev/null | grep -q .; then
  journalctl -u aureum-backup.service -n 50 --no-pager -o cat 2>/dev/null | grep -E '^(ok|FAILED)' | tail -1
  systemctl list-timers aureum-backup.timer --no-legend | awk '{ print "next: " $1, $2, $3 }'
else
  echo "backup timer not installed (sudo bash infra/vps/setup.sh backup)"
fi
