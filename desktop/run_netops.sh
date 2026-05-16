#!/usr/bin/env bash
# NetOps Studio launcher.
# Works both from a terminal AND when invoked by a desktop icon (minimal env).

# ── resolve absolute paths ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PY_BIN="$APP_DIR/.venv/bin/python"
LOG="/tmp/netops_app.log"

# ── redirect all output to log so errors are visible even without a terminal ──
exec >> "$LOG" 2>&1
echo "=== $(date) : NetOps Studio launcher started ==="
echo "    APP_DIR=$APP_DIR"
echo "    DISPLAY=${DISPLAY:-<not set>}"

# ── sanity: venv must exist (run install.sh first) ────────────────────────────
if [[ ! -x "$PY_BIN" ]]; then
    python3 -c "
import tkinter as tk, tkinter.messagebox as mb
r=tk.Tk(); r.withdraw()
mb.showerror('NetOps Studio','venv not found.\nPlease run:\n  bash $SCRIPT_DIR/install.sh')
" 2>/dev/null || true
    echo "ERROR: venv not found at $PY_BIN" >&2
    exit 1
fi

# ── ensure DISPLAY is available (needed for GTK) ─────────────────────────────
if [[ -z "${DISPLAY:-}" ]]; then
    # Try the most common X display
    export DISPLAY=":0"
fi

# ── make sure dbus is running (GTK needs it on some DEs) ─────────────────────
if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]] && command -v dbus-launch &>/dev/null; then
    eval "$(dbus-launch --sh-syntax)" 2>/dev/null || true
fi

# ── The venv is created with --system-site-packages by install.sh,
#    so 'gi' is already visible inside it. Nothing extra needed. ───────────────

echo "    PY_BIN=$PY_BIN"
exec "$PY_BIN" "$APP_DIR/scripts/desktop_app.py" "$@"
