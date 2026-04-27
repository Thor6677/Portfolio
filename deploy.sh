#!/usr/bin/env bash
set -euo pipefail

VPS="ijohnson@146.190.140.112"
VPS_DIR="/opt/portfolio"
NGINX_CONF_SRC="deploy/thunderborn.conf"
NGINX_CONF_DEST="/opt/vigilant/nginx/thunderborn.conf"

echo "==> Pushing to GitHub..."
git push origin main

echo "==> Syncing nginx vhost..."
# Only recreate the nginx container if the conf actually changed
REMOTE_HASH=$(ssh "$VPS" "md5sum $NGINX_CONF_DEST 2>/dev/null | cut -d' ' -f1" || echo "")
LOCAL_HASH=$(md5 -q "$NGINX_CONF_SRC")
if [ "$REMOTE_HASH" != "$LOCAL_HASH" ]; then
  echo "  thunderborn.conf changed — updating and recreating nginx"
  scp "$NGINX_CONF_SRC" "$VPS:$NGINX_CONF_DEST"
  ssh "$VPS" "cd /opt/vigilant && docker compose up -d --force-recreate nginx"
else
  echo "  thunderborn.conf unchanged — skipping nginx"
fi

echo "==> Deploying portfolio..."
ssh "$VPS" "cd $VPS_DIR && git pull origin main && docker compose up -d --build"

echo "==> Checking startup logs..."
ssh "$VPS" "docker logs portfolio --tail=20"

echo "==> Done. https://thunderborn.dev"
