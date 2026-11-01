#!/usr/bin/env bash
set -eu
# Build-time toolchain only. No credentials are sent to the Rust distribution service.
if ! command -v rustup >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  installer="$(mktemp)"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --profile minimal --default-toolchain 1.96.0 --no-modify-path
  rm -f "$installer"
else
  if [ -x "$HOME/.cargo/bin/rustup" ]; then
    "$HOME/.cargo/bin/rustup" toolchain install 1.96.0 --profile minimal --no-self-update
  else
    rustup toolchain install 1.96.0 --profile minimal --no-self-update
  fi
fi
