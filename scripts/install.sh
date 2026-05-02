#!/usr/bin/env bash
set -euo pipefail

REPO="${FMUSIC_REPO:-dgarana/fmusic}"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
ICON_URL="https://raw.githubusercontent.com/${REPO}/main/resources/icon.png"
APP_NAME="FMusic"

say() {
  printf '[fmusic] %s\n' "$*"
}

die() {
  printf '[fmusic] Error: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

download() {
  local url="$1"
  local dest="$2"
  say "Downloading ${url}"
  curl -fL --retry 3 --connect-timeout 20 -o "$dest" "$url"
}

latest_asset_url() {
  local pattern="$1"
  printf '%s\n' "$RELEASE_ASSETS" | grep -E "$pattern" | head -n 1 || true
}

install_macos() {
  need hdiutil
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64) arch_pattern='arm64' ;;
    x86_64) arch_pattern='x64' ;;
    *) die "Unsupported macOS architecture: $arch" ;;
  esac

  local url
  url="$(latest_asset_url "FMusic-.*-${arch_pattern}[.]dmg$")"
  [ -n "$url" ] || die "Could not find a macOS ${arch_pattern} DMG in the latest ${REPO} release."

  local tmp dmg mount_dir app_path target_dir
  tmp="$(mktemp -d)"
  dmg="${tmp}/FMusic.dmg"
  mount_dir="${tmp}/mnt"
  mkdir -p "$mount_dir"
  download "$url" "$dmg"

  say "Mounting DMG"
  hdiutil attach "$dmg" -mountpoint "$mount_dir" -nobrowse -readonly >/dev/null
  trap 'hdiutil detach "$mount_dir" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

  app_path="$(find "$mount_dir" -maxdepth 2 -name "${APP_NAME}.app" -type d | head -n 1)"
  [ -n "$app_path" ] || die "Could not find ${APP_NAME}.app inside the DMG."

  if [ -w /Applications ]; then
    target_dir="/Applications"
  else
    target_dir="${HOME}/Applications"
    mkdir -p "$target_dir"
  fi

  say "Installing ${APP_NAME}.app to ${target_dir}"
  rm -rf "${target_dir}/${APP_NAME}.app"
  ditto "$app_path" "${target_dir}/${APP_NAME}.app"
  say "Installed: ${target_dir}/${APP_NAME}.app"
}

install_linux() {
  local url bin_dir appimage desktop_dir desktop_file icon_dir
  url="$(latest_asset_url 'FMusic-.*[.]AppImage$')"
  [ -n "$url" ] || die "Could not find a Linux AppImage in the latest ${REPO} release."

  bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  appimage="${bin_dir}/fmusic"
  download "$url" "$appimage"
  chmod +x "$appimage"

  desktop_dir="${HOME}/.local/share/applications"
  icon_dir="${HOME}/.local/share/icons/hicolor/256x256/apps"
  desktop_file="${desktop_dir}/fmusic.desktop"
  mkdir -p "$desktop_dir" "$icon_dir"
  curl -fsL --retry 3 --connect-timeout 20 -o "${icon_dir}/fmusic.png" "$ICON_URL" >/dev/null 2>&1 || true

  cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=FMusic
Comment=Download, manage and play a local music library
Exec=${appimage}
Icon=fmusic
Terminal=false
Categories=AudioVideo;Audio;Player;
EOF

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
  fi

  say "Installed executable: ${appimage}"
  say "Desktop entry: ${desktop_file}"
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *) say "Tip: add ${bin_dir} to PATH to run 'fmusic' from your terminal." ;;
  esac
}

main() {
  need curl
  need grep
  need sed

  say "Fetching latest release from ${REPO}"
  RELEASE_ASSETS="$(
    curl -fsSL \
      -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: fmusic-installer' \
      "$API_URL" |
      grep '"browser_download_url"' |
      sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/'
  )"
  [ -n "$RELEASE_ASSETS" ] || die "No downloadable release assets found."

  case "$(uname -s)" in
    Darwin) install_macos ;;
    Linux) install_linux ;;
    *) die "Unsupported OS: $(uname -s). Please download FMusic manually from https://github.com/${REPO}/releases/latest" ;;
  esac

  say "Done."
}

main "$@"
