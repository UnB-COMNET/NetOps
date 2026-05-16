#!/usr/bin/env bash
# =============================================================================
# NetOps Studio — Installer
# Clique duas vezes neste arquivo no gerenciador de arquivos, OU execute:
#   bash desktop/install.sh
# =============================================================================

# ── Se não estiver rodando dentro de um terminal, re-executa dentro de um ────
# Isso garante que o clique duplo pelo gerenciador de arquivos abra um terminal.
if [[ ! -t 0 ]]; then
    SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
    # Tenta os emuladores de terminal mais comuns
    for TERM_EMU in gnome-terminal x-terminal-emulator xterm konsole xfce4-terminal lxterminal mate-terminal; do
        if command -v "$TERM_EMU" &>/dev/null; then
            case "$TERM_EMU" in
                gnome-terminal) exec gnome-terminal -- bash "$SELF" ;;
                konsole)        exec konsole -e bash "$SELF" ;;
                *)              exec "$TERM_EMU" -e bash "$SELF" ;;
            esac
        fi
    done
    # Fallback: abre via xdg-terminal (se disponível)
    if command -v xdg-terminal &>/dev/null; then
        exec xdg-terminal bash "$SELF"
    fi
    # Último recurso: executa sem terminal (erros vão para /tmp/netops_install.log)
    exec bash "$SELF" >> /tmp/netops_install.log 2>&1
fi

set -euo pipefail

### ── Colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[netops]${NC} $*"; }
warn()  { echo -e "${YELLOW}[netops]${NC} $*"; }
error() { echo -e "${RED}[netops ERROR]${NC} $*" >&2; }

### ── Resolve project root (works regardless of CWD) ─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
info "Project root: $APP_DIR"

### ── 1. System prerequisites check ─────────────────────────────────────────
info "Checking system packages …"
MISSING_PKGS=()
for pkg in python3 python3-venv python3-gi gir1.2-webkit2-4.0; do
    if ! dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
        MISSING_PKGS+=("$pkg")
    fi
done

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    warn "Installing missing system packages: ${MISSING_PKGS[*]}"
    if command -v sudo &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y "${MISSING_PKGS[@]}"
    else
        error "sudo not available. Please run as root or install manually: ${MISSING_PKGS[*]}"
        exit 1
    fi
else
    info "All system packages present ✔"
fi

### ── 1b. Node.js / npm prerequisite ─────────────────────────────────────────
info "Checking Node.js / npm …"
NODE_MIN=18
NPM_OK=false
if command -v node &>/dev/null; then
    NODE_VER="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
    if [[ "$NODE_VER" -ge "$NODE_MIN" ]]; then
        info "Node.js $NODE_VER detected ✔"
        NPM_OK=true
    else
        warn "Node.js $NODE_VER is too old (need ≥ $NODE_MIN). Trying to install a newer version …"
    fi
else
    warn "Node.js not found. Installing via NodeSource …"
fi

if [[ "$NPM_OK" == false ]]; then
    if command -v sudo &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN}.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        error "sudo not available. Please install Node.js ≥ $NODE_MIN manually: https://nodejs.org"
        exit 1
    fi
    info "Node.js installed ✔"
fi

### ── 2. Create / refresh Python venv ───────────────────────────────────────
VENV="$APP_DIR/.venv"
info "Setting up Python virtual environment …"

# Always recreate with --system-site-packages so 'gi' (GTK) is accessible.
# If the existing venv was created WITHOUT --system-site-packages we must
# rebuild it — cheapest signal: pyvenv.cfg contains "include-system-site-packages = false"
NEED_RECREATE=false
if [[ -f "$VENV/pyvenv.cfg" ]]; then
    if grep -q "include-system-site-packages = false" "$VENV/pyvenv.cfg"; then
        warn "Existing venv lacks --system-site-packages — rebuilding …"
        NEED_RECREATE=true
    fi
else
    NEED_RECREATE=true
fi

if [[ "$NEED_RECREATE" == true ]]; then
    rm -rf "$VENV"
    python3 -m venv --system-site-packages "$VENV"
    info "Created venv at $VENV ✔"
else
    info "Existing venv OK ✔"
fi

PY="$VENV/bin/python"
PIP="$VENV/bin/pip"

### ── 3. Install / upgrade pip packages ─────────────────────────────────────
DESKTOP_REQS="$APP_DIR/requirements-desktop.txt"
REQ_STAMP="$VENV/.requirements_stamp"

# Rebuild only if any requirements file is newer than the stamp
REQS_CHANGED=false
if [[ ! -f "$REQ_STAMP" ]]; then
    REQS_CHANGED=true
elif [[ "$APP_DIR/requirements.txt" -nt "$REQ_STAMP" ]]; then
    REQS_CHANGED=true
elif [[ -f "$DESKTOP_REQS" ]] && [[ "$DESKTOP_REQS" -nt "$REQ_STAMP" ]]; then
    REQS_CHANGED=true
fi

if [[ "$REQS_CHANGED" == true ]]; then
    info "Installing Python dependencies …"
    "$PIP" install --quiet --upgrade pip
    "$PIP" install --quiet -r "$APP_DIR/requirements.txt"
    if [[ -f "$DESKTOP_REQS" ]]; then
        "$PIP" install --quiet -r "$DESKTOP_REQS"
    fi
    touch "$REQ_STAMP"
    info "Python dependencies installed ✔"
else
    info "Python dependencies up to date ✔"
fi

### ── 3b. Pre-create runtime directories ───────────────────────────────────
info "Creating runtime directories …"
# Persistent experiments folder (survives reinstalls, safe to keep)
mkdir -p \
    "$APP_DIR/experiments/registry" \
    "$APP_DIR/experiments/runs" \
    "$APP_DIR/experiments/run_metrics"
# Temporary working directories for the backend
mkdir -p \
    "$APP_DIR/temp/experiments/registry" \
    "$APP_DIR/temp/experiments/runs" \
    "$APP_DIR/temp/experiments/run_metrics" \
    "$APP_DIR/temp/configs"
info "Runtime directories ready ✔"

### ── 4. Build the Next.js frontend ─────────────────────────────────────────
FRONTEND_DIR="$APP_DIR/platform/frontend-next"
NPM_STAMP="$FRONTEND_DIR/node_modules/.install_stamp"
BUILD_STAMP="$FRONTEND_DIR/.next/.build_stamp"

# npm must run as the owner of node_modules, not as root, to avoid EACCES.
# Detect the real user: prefer SUDO_USER, fall back to stat on the project dir.
REAL_USER="${SUDO_USER:-}"
if [[ -z "$REAL_USER" ]]; then
    REAL_USER="$(stat -c '%U' "$APP_DIR")"
fi
# If we are already that user (or root without sudo), just run directly.
if [[ "$(id -un)" == "$REAL_USER" ]] || [[ -z "$REAL_USER" ]]; then
    NPM_RUN() { "$@"; }
else
    NPM_RUN() { sudo -u "$REAL_USER" "$@"; }
fi

# If node_modules exists but contains files NOT owned by REAL_USER (e.g. from a previous
# root run), remove it entirely so npm ci can rebuild cleanly. Check a few key locations
# that npm commonly modifies (.bin symlinks, top-level packages).
if [[ -d "$FRONTEND_DIR/node_modules" ]] && [[ -n "$REAL_USER" ]]; then
    NEEDS_CLEAN=false
    # Check .bin directory (npm always touches this)
    if [[ -d "$FRONTEND_DIR/node_modules/.bin" ]]; then
        BIN_OWNER="$(stat -c '%U' "$FRONTEND_DIR/node_modules/.bin" 2>/dev/null || echo '')"
        if [[ "$BIN_OWNER" != "$REAL_USER" ]]; then
            NEEDS_CLEAN=true
        fi
    fi
    # If no .bin yet, check for any root-owned files in node_modules (quick find)
    if [[ "$NEEDS_CLEAN" == false ]] && find "$FRONTEND_DIR/node_modules" -maxdepth 2 -user root -print -quit 2>/dev/null | grep -q .; then
        NEEDS_CLEAN=true
    fi
    
    if [[ "$NEEDS_CLEAN" == true ]]; then
        warn "node_modules contains files not owned by '$REAL_USER' — removing before reinstall …"
        # Use sudo to remove if we don't have permission
        if rm -rf "$FRONTEND_DIR/node_modules" 2>/dev/null; then
            : # removed successfully
        else
            sudo rm -rf "$FRONTEND_DIR/node_modules"
        fi
        rm -f "$NPM_STAMP"
    fi
fi

# npm ci: skip if node_modules is fresh relative to package-lock.json
if [[ -f "$NPM_STAMP" ]] && [[ "$FRONTEND_DIR/package-lock.json" -ot "$NPM_STAMP" ]]; then
    info "Node.js dependencies up to date ✔"
else
    info "Installing Node.js dependencies …"
    NPM_RUN npm ci --prefix "$FRONTEND_DIR"
    NPM_RUN touch "$NPM_STAMP"
    info "Node.js dependencies installed ✔"
fi

# npm run build: skip if .next exists and no source file is newer than the build stamp
NEEDS_BUILD=false
if [[ ! -f "$BUILD_STAMP" ]]; then
    NEEDS_BUILD=true
elif find "$FRONTEND_DIR/src" "$FRONTEND_DIR/next.config.mjs" "$FRONTEND_DIR/package.json" \
         "$FRONTEND_DIR/tailwind.config.ts" "$FRONTEND_DIR/tsconfig.json" \
         -newer "$BUILD_STAMP" 2>/dev/null | grep -q .; then
    NEEDS_BUILD=true
fi

# Clean .next if it contains files not owned by REAL_USER (same issue as node_modules)
if [[ -d "$FRONTEND_DIR/.next" ]] && [[ -n "$REAL_USER" ]]; then
    if find "$FRONTEND_DIR/.next" -maxdepth 2 -user root -print -quit 2>/dev/null | grep -q .; then
        warn ".next contains root-owned files — removing before rebuild …"
        if rm -rf "$FRONTEND_DIR/.next" 2>/dev/null; then
            : # removed successfully
        else
            sudo rm -rf "$FRONTEND_DIR/.next"
        fi
        rm -f "$BUILD_STAMP"
        NEEDS_BUILD=true
    fi
fi

if [[ "$NEEDS_BUILD" == true ]]; then
    info "Building Next.js frontend …"
    # Bake the backend URL for production build — stays localhost:8000 for desktop use.
    NPM_RUN env -C "$FRONTEND_DIR" NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run build --prefix "$FRONTEND_DIR"
    touch "$BUILD_STAMP"
    info "Frontend built ✔"
else
    info "Frontend already up to date ✔"
fi

### ── 5. Install SVG icon ────────────────────────────────────────────────────
info "Installing icon …"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$ICON_DIR"
cp "$SCRIPT_DIR/netops.svg" "$ICON_DIR/netops.svg"
# Also put a 256x256 entry for DEs that prefer the sized folder
ICON_DIR_256="$HOME/.local/share/icons/hicolor/256x256/apps"
mkdir -p "$ICON_DIR_256"
cp "$SCRIPT_DIR/netops.svg" "$ICON_DIR_256/netops.svg"
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
info "Icon installed ✔"

### ── 6. Write .desktop entry with ABSOLUTE paths ───────────────────────────
info "Registering application launcher …"
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"

# Write the .desktop with the absolute path to run_netops.sh baked in.
# Using absolute path means the launcher works regardless of how the DE invokes it.
cat > "$APPS_DIR/netops.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=NetOps Studio
GenericName=Network Operations Studio
Comment=Network Operations & Monitoring Platform for SDN Research
Exec="$SCRIPT_DIR/run_netops.sh"
Icon=netops
Terminal=false
StartupNotify=true
Categories=Network;Science;Education;
Keywords=SDN;NetOps;network;monitoring;operations;research;
EOF

chmod +x "$APPS_DIR/netops.desktop"
chmod +x "$SCRIPT_DIR/run_netops.sh"

# Also mark the desktop file as trusted on Ubuntu/GNOME
if command -v gio &>/dev/null; then
    gio set "$APPS_DIR/netops.desktop" metadata::trusted true 2>/dev/null || true
fi

update-desktop-database "$APPS_DIR" 2>/dev/null || true
info "Launcher registered ✔"

### ── 6b. Mark THIS installer as executable + trusted (enables future double-clicks) ──
chmod +x "$SCRIPT_DIR/Instalar NetOps Studio.desktop" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/netops.desktop"                 2>/dev/null || true

# Bake the absolute path into the source installer .desktop so it works
# from double-click regardless of working directory.
sed -i "s|__INSTALL_DIR__|$SCRIPT_DIR|g" \
    "$SCRIPT_DIR/Instalar NetOps Studio.desktop" 2>/dev/null || true

if command -v gio &>/dev/null; then
    gio set "$SCRIPT_DIR/Instalar NetOps Studio.desktop" metadata::trusted true 2>/dev/null || true
fi

### ── 7. Summary ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   NetOps Studio — instalado com sucesso!             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  → Abra o menu de aplicativos e busque por 'NetOps Studio'"
echo "  → Ou execute direto:  $SCRIPT_DIR/run_netops.sh"
echo "  → Experimentos salvos em: $APP_DIR/experiments/"
echo ""
echo "  Log de execução: /tmp/netops_app.log"
echo ""
# Mantém o terminal aberto para o usuário ler o resultado
read -rp "  Pressione ENTER para fechar esta janela…"
