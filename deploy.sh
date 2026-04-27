#!/usr/bin/env bash
set -euo pipefail

VPS="ijohnson@146.190.140.112"
VPS_DIR="/opt/portfolio"

echo "==> Pushing to GitHub..."
git push origin main

echo "==> Deploying on VPS..."
ssh "$VPS" "cd $VPS_DIR && git pull origin main && docker compose up -d --build"

echo "==> Done. https://thunderborn.dev"
