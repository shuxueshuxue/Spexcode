#!/usr/bin/env bash
set -euo pipefail

say() { printf '[bootstrap] %s\n' "$*"; }

say "Checking the WSL2 host (Node 22 is required)."
if ! command -v sudo >/dev/null 2>&1; then
  say 'sudo is required to install tmux and git.'
  exit 69
fi

missing=()
command -v tmux >/dev/null 2>&1 || missing+=(tmux)
command -v git >/dev/null 2>&1 || missing+=(git)
command -v curl >/dev/null 2>&1 || missing+=(curl)
if ((${#missing[@]})); then
  say "Installing ${missing[*]} with apt. Enter your sudo password when prompted; it is used once."
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y tmux git
else
  say 'tmux and git are already installed; nothing to change.'
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  say 'Installing nvm for the WSL user.'
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
# shellcheck disable=SC1090
source "$NVM_DIR/nvm.sh"
node_version='22'
if [[ -n "${SPEXCODE_PROJECT_ROOT:-}" && -f "$SPEXCODE_PROJECT_ROOT/.nvmrc" ]]; then
  node_version="$(tr -d '[:space:]' < "$SPEXCODE_PROJECT_ROOT/.nvmrc")"
elif [[ -f .nvmrc ]]; then
  node_version="$(tr -d '[:space:]' < .nvmrc)"
fi
if [[ "${node_version#v}" != 22* ]]; then node_version='22'; fi
if ! nvm ls "$node_version" >/dev/null 2>&1; then
  say "Installing Node ${node_version} through nvm."
  nvm install "$node_version"
else
  say "Node ${node_version} is already installed; nothing to change."
fi
nvm alias default "$node_version" >/dev/null
nvm use "$node_version" >/dev/null

bundle="${SPEXCODE_BUNDLE_TARBALL:-}"
if [[ -n "$bundle" && -f "$bundle" ]]; then
  say "Installing spexcode from the bundled tarball (offline-safe): $bundle"
  npm install --global --force "$bundle" @spexcode/spec-dashboard
else
  say 'Installing spexcode from npm (the bundled tarball was not supplied).'
  npm install --global spexcode @spexcode/spec-dashboard
fi

if command -v spex >/dev/null 2>&1; then
  say 'Running the real spex doctor; its output is the final bootstrap step.'
  spex doctor
else
  say 'spex is not on PATH after installation.'
  exit 69
fi
say 'Bootstrap complete. Re-running on this healthy distro changes nothing.'
