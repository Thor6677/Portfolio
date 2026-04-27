#!/usr/bin/env bash
# Deploy the portfolio site to the VPS.
#
# FIRST-TIME SETUP (run once before the first deploy):
#   ssh ijohnson@146.190.140.112 "mkdir -p /opt/portfolio/www"
#   scp docker-compose.yml nginx.conf ijohnson@146.190.140.112:/opt/portfolio/
#   ssh ijohnson@146.190.140.112 "cd /opt/portfolio && docker compose up -d"
#
#   Then in the vigilant-vps repo — push the thunderborn.conf change and
#   recreate the nginx container to pick up the new bind-mounted conf file:
#   (nginx -s reload reads the old inode; only a container recreate works)
#   ssh ijohnson@146.190.140.112 "cd /opt/vigilant && docker compose up -d --force-recreate nginx"
#
# ROUTINE DEPLOYS: just run this script.
set -euo pipefail

VPS="ijohnson@146.190.140.112"
VPS_DIR="/opt/portfolio"

echo "==> Building..."
npm run build

echo "==> Syncing to $VPS:$VPS_DIR/www/..."
rsync -avz --delete dist/ "$VPS:$VPS_DIR/www/"

echo "==> Done. https://thunderborn.dev"
