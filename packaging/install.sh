#!/bin/sh
# Installs the Roughbook studio's standalone binary on macOS or Linux. It carries its own Node.js
# runtime, so the machine needs none:
#
#   curl -fsSL https://github.com/bharatnow/roughbook-studio/releases/latest/download/install.sh | sh
#
# ROUGHBOOK_VERSION installs that version (0.3.16) instead of the latest. ROUGHBOOK_INSTALL_DIR is
# the folder it goes in (~/.local/bin by default). ROUGHBOOK_DOWNLOAD_URL is a folder of the
# release's files to download from instead of GitHub (a mirror). The archive is checked against
# the release's SHA256SUMS before anything is installed.
set -eu

REPO="bharatnow/roughbook-studio"

fail() {
  echo "roughbook: $1" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "this script is for macOS and Linux. On Windows, use install.ps1, WinGet or Scoop." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "there is no binary for $(uname -m). With Node.js 22 or later: npm install -g roughbook" ;;
esac
if [ "$os" = linux ] && { [ -e /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then
  fail "the binary needs glibc, and this Linux uses musl (Alpine). With Node.js 22 or later: npm install -g roughbook"
fi

if [ -n "${ROUGHBOOK_DOWNLOAD_URL:-}" ]; then
  base="${ROUGHBOOK_DOWNLOAD_URL%/}"
elif [ -n "${ROUGHBOOK_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v${ROUGHBOOK_VERSION#v}"
else
  base="https://github.com/$REPO/releases/latest/download"
fi
dir="${ROUGHBOOK_INSTALL_DIR:-$HOME/.local/bin}"
archive="roughbook-$os-$arch.tar.gz"

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2"
  else
    fail "curl or wget is needed to download the binary."
  fi
}

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "sha256sum or shasum is needed to check the download."
  fi
}

temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT INT TERM

echo "Downloading $archive from $base"
fetch "$base/$archive" "$temp/$archive" || fail "could not download $base/$archive"
fetch "$base/SHA256SUMS" "$temp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"
expected="$(grep " $archive\$" "$temp/SHA256SUMS" | cut -d ' ' -f 1)"
[ -n "$expected" ] || fail "SHA256SUMS lists no $archive."
[ "$(digest "$temp/$archive")" = "$expected" ] || fail "$archive does not match its SHA256SUMS line; nothing was installed."

tar -xzf "$temp/$archive" -C "$temp"
mkdir -p "$dir"
cp "$temp/roughbook" "$dir/roughbook.new"
chmod 755 "$dir/roughbook.new"
mv -f "$dir/roughbook.new" "$dir/roughbook"
echo "Installed $("$dir/roughbook" --version) at $dir/roughbook"

case ":$PATH:" in
  *":$dir:"*) ;;
  *)
    echo
    echo "$dir is not on your PATH. Add it, then open a new terminal:"
    echo "  echo 'export PATH=\"$dir:\$PATH\"' >> ~/.profile"
    ;;
esac
echo "Next: roughbook login, then roughbook init in your app's repository."
