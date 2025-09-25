#!/usr/bin/env bash
set -euo pipefail

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
    sudo apt-get install -y build-essential pkg-config libssl-dev curl git
elif [[ "$OS" == "Mac" ]]; then
    echo "=== Installing Xcode Command Line Tools ==="
    if ! xcode-select -p &>/dev/null; then
        xcode-select --install || true
        echo ">>> Please complete the pop-up installation of Xcode Command Line Tools, then rerun the script if it stops."
    fi

    echo "=== Checking Homebrew installation ==="
    if ! command -v brew &>/dev/null; then
        echo "Homebrew not found. Installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        if [[ -d /opt/homebrew/bin ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [[ -d /usr/local/bin ]]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    else
        echo "Homebrew found."
        if [[ -x /opt/homebrew/bin/brew ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [[ -x /usr/local/bin/brew ]]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    fi

    echo "=== Updating Homebrew and installing dependencies ==="
    brew update
    brew upgrade
    brew install pkg-config openssl git
fi

echo "=== Installing NVM (Node Version Manager) ==="
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

echo "=== Installing Node.js 22 and Yarn (via Corepack) ==="
nvm install 22
nvm use 22
corepack enable
corepack prepare yarn@4.6.0 --activate

echo "=== Installing Rust via rustup ==="
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc -V

echo "=== Installing Solana CLI ==="
sh -c "$(curl -sSfL https://release.anza.xyz/v1.17.25/install)"
source "$HOME/.profile" || true
solana -V

echo "=== Installing Anchor (v0.29.0) ==="
rustup default 1.76.0
ANCHOR_TMP_DIR="$(mktemp -d)"
git clone https://github.com/coral-xyz/anchor "$ANCHOR_TMP_DIR/anchor"
cd "$ANCHOR_TMP_DIR/anchor"
git checkout v0.29.0
cd cli
cargo build --release
mkdir -p "$HOME/.cargo/bin"
ANCHOR_VERSION="0.29.0"
cp ../target/release/anchor "$HOME/.cargo/bin/anchor-$ANCHOR_VERSION"
ln -sfn "$HOME/.cargo/bin/anchor-$ANCHOR_VERSION" "$HOME/.cargo/bin/anchor"
export PATH="$HOME/.cargo/bin:$PATH"
INSTALLED_ANCHOR_VERSION="$(anchor --version 2>/dev/null || true)"
echo "$INSTALLED_ANCHOR_VERSION"
if [[ "$INSTALLED_ANCHOR_VERSION" != *"$ANCHOR_VERSION"* ]]; then
    echo "Warning: anchor on PATH is not $ANCHOR_VERSION. PATH may prefer another anchor." >&2
    which anchor || true
fi
cd "$REPO_ROOT"
rm -rf "$ANCHOR_TMP_DIR"

echo "=== Building local Whirlpools repo ==="
rustup default 1.85.1
cd "$REPO_ROOT"
yarn install
yarn build

echo "=== Setup complete ==="
