#!/usr/bin/env bash
# Prepares a fresh Ubuntu VPS for Aureum (PHASE3 block 3.18, item 1; choices in
# docs/decisions/0036-vps-deploy.md). Idempotent: safe to run again.
#
#   sudo bash setup.sh base     # packages, Docker, deploy user, ufw, fail2ban
#   sudo bash setup.sh harden   # SSH: key only, no root login (run after testing the deploy user)
#
# Env: DEPLOY_USER (default aureum), LIVEKIT_UDP_PORT (default 7882, final choice in item 4).
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-aureum}"
LIVEKIT_UDP_PORT="${LIVEKIT_UDP_PORT:-7882}"

log() { printf '\n==> %s\n' "$*"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "run as root (sudo bash $0 $*)" >&2
    exit 1
  fi
}

base() {
  export DEBIAN_FRONTEND=noninteractive

  log "packages"
  apt-get update -q
  apt-get upgrade -yq
  apt-get install -yq ca-certificates curl gnupg ufw fail2ban python3-systemd unattended-upgrades

  log "time zone"
  timedatectl set-timezone America/Sao_Paulo

  log "unattended security upgrades"
  # The stock 50unattended-upgrades only allows the -security origin; no automatic reboot.
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  systemctl enable --now unattended-upgrades # shutdown guard; apt-daily-upgrade.timer does the runs

  log "docker log rotation"
  install -d -m 0755 /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF

  log "docker engine + compose (official apt repo)"
  if ! command -v docker >/dev/null 2>&1; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # shellcheck disable=SC1091
    codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
  systemctl restart docker # picks up daemon.json

  log "deploy user: $DEPLOY_USER"
  if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$DEPLOY_USER"
  fi
  usermod -aG sudo,docker "$DEPLOY_USER"
  # Key-only SSH, so passwordless sudo; the docker group is root-equivalent anyway.
  echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
  chmod 0440 "/etc/sudoers.d/90-$DEPLOY_USER"
  visudo -cf "/etc/sudoers.d/90-$DEPLOY_USER" >/dev/null
  home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
  if [ ! -s "$home/.ssh/authorized_keys" ]; then
    install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "$home/.ssh/authorized_keys"
  fi

  log "ufw"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 7881/tcp
  ufw allow "$LIVEKIT_UDP_PORT/udp"
  ufw --force enable

  log "fail2ban (sshd)"
  cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
backend = systemd
EOF
  systemctl enable fail2ban
  systemctl restart fail2ban

  log "done. Next: test 'ssh $DEPLOY_USER@<ip> sudo true', then run: sudo bash $0 harden"
}

harden() {
  home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  if [ ! -s "$home/.ssh/authorized_keys" ]; then
    echo "$DEPLOY_USER has no authorized_keys; refusing to lock SSH down" >&2
    exit 1
  fi

  log "sshd: key only, no root login"
  # 00- so it wins over 50-cloud-init.conf (sshd keeps the first value it reads).
  cat > /etc/ssh/sshd_config.d/00-aureum.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $DEPLOY_USER
EOF
  sshd -t
  systemctl reload ssh
  log "done. Keep this session open and test a new login before closing it."
}

case "${1:-}" in
  base) require_root "$@"; base ;;
  harden) require_root "$@"; harden ;;
  *) echo "usage: $0 base|harden" >&2; exit 2 ;;
esac
