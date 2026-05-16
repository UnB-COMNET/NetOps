#!/usr/bin/env bash
# =============================================================================
# NetOps Studio — Quick Update
# Rebuilds the frontend without reinstalling everything
# =============================================================================

set -euo pipefail

### ── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[netops]${NC} $*"; }
warn()  { echo -e "${YELLOW}[netops]${NC} $*"; }

### ── Resolve project root ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$APP_DIR/platform/frontend-next"

info "Project root: $APP_DIR"

### ── 1. Kill running instances ─────────────────────────────────────────────
info "Stopping running instances…"
pkill -f "desktop_app.py" 2>/dev/null || true
pkill -f "next.*start" 2>/dev/null || true
pkill -f "uvicorn.*platform.backend" 2>/dev/null || true
sleep 2
info "Instances stopped ✔"

### ── 2. Force rebuild the frontend ─────────────────────────────────────────
info "Cleaning Next.js cache…"
rm -rf "$FRONTEND_DIR/.next"
rm -f "$FRONTEND_DIR/.next/.build_stamp"

info "Building Next.js frontend…"
cd "$FRONTEND_DIR"
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run build

touch "$FRONTEND_DIR/.next/.build_stamp"
info "Frontend rebuilt ✔"

### ── 3. Summary ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   NetOps Studio — atualizado com sucesso!           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  → Agora você pode abrir o NetOps Studio normalmente"
echo "  → As alterações já estão aplicadas!"
echo ""
