#!/usr/bin/env bash
set -euo pipefail

VPS="ijohnson@146.190.140.112"
VPS_DIR="/opt/portfolio"

echo "==> Building..."
npm run build

echo "==> Syncing to $VPS:$VPS_DIR/www/..."
rsync -avz --delete dist/ "$VPS:$VPS_DIR/www/"

echo "==> Done. https://thunderborn.dev"
