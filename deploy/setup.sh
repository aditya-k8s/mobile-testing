#!/usr/bin/env bash
# First-time server setup for Family Monitor on Ubuntu.
# Usage (from the project root):  ./deploy/setup.sh [public-ip]
set -euo pipefail
cd "$(dirname "$0")/.."

IP="${1:-20.68.130.169}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi

if [ ! -f .env ]; then
  echo "Creating .env with random secrets for $IP"
  umask 077
  cat > .env <<EOF
SERVER_IP=$IP
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
TURN_PASSWORD=$(openssl rand -hex 16)
ALLOW_REGISTRATION=true
FCM_SERVICE_ACCOUNT_FILE=
EOF
else
  echo ".env already exists, keeping existing secrets"
fi

# Host firewall (Ubuntu ufw). Cloud firewalls (e.g. Azure NSG) must allow the same ports.
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 80/tcp
  sudo ufw allow 3478/tcp
  sudo ufw allow 3478/udp
  sudo ufw allow 49160:49200/udp
fi

sudo docker compose up -d --build
sudo docker compose ps
echo
echo "Dashboard: http://$IP"
echo "Child app server address: http://$IP"
