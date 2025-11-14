#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# DEPENDENCY VERSIONS
# =============================================================================
NVM_VERSION="v0.40.3"
NODE_VERSION="22"
YARN_VERSION="4.6.0"
SOLANA_VERSION="v2.2.1"
ANCHOR_VERSION="v0.32.1"
RUST_VERSION_FOR_PROJECT="1.86.0"

# Resolve repo root from this script's directory
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
echo "=== Repo root: $REPO_ROOT ==="

echo "=== Detecting system ==="
UNAME_OUT="$(uname -s)"
case "${UNAME_OUT}" in
    Linux*)     OS=Linux;;
    Darwin*)    OS=Mac;;
    *)          OS="UNKNOWN:${UNAME_OUT}"
esac
echo "Detected: $OS"

if [[ "$OS" == "Linux" ]]; then
    echo "=== Updating system packages (Linux) ==="
    sudo apt-get update && sudo apt-get upgrade -y
    sudo apt-get install -y build-essential pkg-config libudev-dev libssl-dev curl git
elif [[ "$OS" == "Mac" ]]; then
    echo "=== Installing Xcode Command Line Tools ==="
    xcode-select --install || true

    echo "=== Installing Homebrew and dependencies ==="
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || true
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || true
    brew update
    brew upgrade
    brew install pkg-config openssl git
fi

echo "=== Installing NVM (Node Version Manager) ==="
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

echo "=== Installing Node.js ${NODE_VERSION} and Yarn (via Corepack) ==="
nvm install ${NODE_VERSION}
nvm use ${NODE_VERSION}
corepack enable
corepack prepare yarn@${YARN_VERSION} --activate

echo "=== Installing Rust via rustup ==="
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup default stable
rustc -V

echo "=== Installing Solana CLI ==="
sh -c "$(curl -sSfL https://release.anza.xyz/${SOLANA_VERSION}/install)"
source "$HOME/.profile" || true
solana -V

echo "=== Installing Anchor (${ANCHOR_VERSION}) ==="
cargo install --git https://github.com/coral-xyz/anchor --tag ${ANCHOR_VERSION} anchor-cli --force
export PATH="$HOME/.cargo/bin:$PATH"
cd "$REPO_ROOT"

echo "=== Building local Whirlpools repo ==="
rustup default ${RUST_VERSION_FOR_PROJECT}
cd "$REPO_ROOT"
yarn install
yarn build
# NOTE: without this, most of the auto-generated code in `ts-sdk/client` is shown as unstaged,
# even though there are no meaningful changes
yarn format

echo "=== Setup complete ==="
