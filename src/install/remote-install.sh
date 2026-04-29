#!/usr/bin/env bash
set -Eeuo pipefail

DELIVERY_REPO_OWNER="yueyue27418"
DELIVERY_REPO_NAME="1688-autoprocurement"
DELIVERY_REPO="${DELIVERY_REPO_OWNER}/${DELIVERY_REPO_NAME}"
DELIVERY_REPO_URL="https://github.com/${DELIVERY_REPO}"
INSTALL_SERVICE_URL="__INSTALL_SERVICE_URL__"

INSTALL_DIR=""
TAG="latest"
BUNDLE_URL=""
SHA256_VALUE=""
ENV_URL=""
ENV_URL_EXPLICIT=0
ENV_FILE=""
EMBEDDED_ENV_AVAILABLE="__DELIVERY_ENV_AVAILABLE__"
PROD_MODE=0
NO_START=0
WITH_PYTHON=0
WITH_PLAYWRIGHT=0
RESET_DB=0
DRY_RUN=0
ALLOW_INSECURE=0
CURRENT_UPDATED=0
PREVIOUS_CURRENT=""

usage() {
  cat <<'EOF'
Usage:
  curl -LsSf https://1688autoprocurement.xleeelx.online/install.sh | bash -s -- [options]

Options:
  --dir PATH              Install root. Defaults to /opt/1688-autoprocurement for root, otherwise $HOME/1688-autoprocurement.
  --tag TAG               Delivery repository tag. Defaults to latest.
  --bundle-url URL        Download this explicit delivery archive instead of resolving a tag.
  --sha256 HASH           Expected SHA-256 for the downloaded archive.
  --env-url URL           Download .env only when no existing deployment env is present.
  --env-file PATH         Copy local env file only when no existing deployment env is present.
  --prod                  Run the package installer in production mode.
  --no-start              Install without starting the app.
  --with-python           Ask the package installer to prepare uv + Python 3.13.
  --with-playwright       Ask the package installer to install Playwright Chromium.
  --reset-db              Ask the package installer to reset DB in production mode.
  --dry-run               Print planned actions without changing the machine.
  --allow-insecure        Allow http:// URLs for explicit test fixtures.
  -h, --help              Show this help.
EOF
}

log() {
  printf '[remote-install] %s\n' "$*"
}

warn() {
  printf '[remote-install] WARN: %s\n' "$*" >&2
}

die() {
  printf '[remote-install] ERROR: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[remote-install] DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

normalize_tag() {
  local value="$1"
  value="${value#refs/tags/}"
  printf '%s' "$value" | xargs
}

validate_tag() {
  local value
  value="$(normalize_tag "$1")"

  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || return 1
  [[ "$value" != *..* ]]
}

validate_url() {
  local value="$1"

  if [[ "$value" == https://* ]]; then
    return 0
  fi

  if [[ "$ALLOW_INSECURE" -eq 1 && "$value" == http://* ]]; then
    return 0
  fi

  return 1
}

has_embedded_env() {
  [[ "$EMBEDDED_ENV_AVAILABLE" == "1" ]]
}

default_install_dir() {
  if [[ "${EUID}" -eq 0 ]]; then
    printf '%s\n' "/opt/1688-autoprocurement"
  else
    printf '%s\n' "${HOME}/1688-autoprocurement"
  fi
}

resolve_latest_tag() {
  local tag_url="${INSTALL_SERVICE_URL}/api/releases/latest/tag"
  local resolved

  resolved="$(curl -fsSL "$tag_url" | tr -d '\n')"
  validate_tag "$resolved" || die "Latest tag endpoint returned an invalid tag: $resolved"
  printf '%s\n' "$(normalize_tag "$resolved")"
}

build_archive_url() {
  local tag_name="$1"

  validate_tag "$tag_name" || die "Invalid delivery tag: $tag_name"
  printf '%s\n' "${INSTALL_SERVICE_URL}/api/downloads/tags/$(normalize_tag "$tag_name")"
}

build_env_url() {
  local tag_name="$1"

  validate_tag "$tag_name" || die "Invalid delivery tag: $tag_name"
  printf '%s\n' "${INSTALL_SERVICE_URL}/api/downloads/tags/$(normalize_tag "$tag_name")/env"
}

write_embedded_env_file() {
  local target="$1"

  cat > "$target" <<'__REMOTE_INSTALL_EMBEDDED_ENV__'
__DELIVERY_ENV_CONTENT__
__REMOTE_INSTALL_EMBEDDED_ENV__
  chmod 600 "$target"
}

download_env_file() {
  local url="$1"
  local target="$2"

  if ! curl -fsSL "$url" -o "$target"; then
    rm -f "$target"
    die "Unable to download .env from ${url}. Configure DELIVERY_ENV_FILE_CONTENT on the install service or pass --env-file."
  fi

  chmod 600 "$target"
}

checksum_file() {
  local file_path="$1"
  local expected="$2"
  local actual

  if command_exists sha256sum; then
    actual="$(sha256sum "$file_path" | awk '{print $1}')"
  elif command_exists shasum; then
    actual="$(shasum -a 256 "$file_path" | awk '{print $1}')"
  else
    die "sha256sum or shasum is required when --sha256 is provided."
  fi

  [[ "$actual" == "$expected" ]] || die "SHA-256 mismatch. Expected $expected but got $actual."
}

rollback_current() {
  if [[ "$CURRENT_UPDATED" -ne 1 ]]; then
    return
  fi

  warn "Install failed; rolling current symlink back."
  if [[ -n "$PREVIOUS_CURRENT" ]]; then
    ln -sfn "$PREVIOUS_CURRENT" "${INSTALL_DIR}/current.rollback"
    mv -f "${INSTALL_DIR}/current.rollback" "${INSTALL_DIR}/current"
  else
    rm -f "${INSTALL_DIR}/current"
  fi
}

trap rollback_current ERR

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      shift
      [[ $# -gt 0 ]] || die "--dir requires a path."
      INSTALL_DIR="$1"
      ;;
    --tag)
      shift
      [[ $# -gt 0 ]] || die "--tag requires a value."
      TAG="$1"
      ;;
    --bundle-url)
      shift
      [[ $# -gt 0 ]] || die "--bundle-url requires a URL."
      BUNDLE_URL="$1"
      ;;
    --sha256)
      shift
      [[ $# -gt 0 ]] || die "--sha256 requires a hash."
      SHA256_VALUE="$1"
      ;;
    --env-url)
      shift
      [[ $# -gt 0 ]] || die "--env-url requires a URL."
      ENV_URL="$1"
      ENV_URL_EXPLICIT=1
      ;;
    --env-file)
      shift
      [[ $# -gt 0 ]] || die "--env-file requires a path."
      ENV_FILE="$1"
      ;;
    --prod)
      PROD_MODE=1
      ;;
    --no-start)
      NO_START=1
      ;;
    --with-python)
      WITH_PYTHON=1
      ;;
    --with-playwright)
      WITH_PLAYWRIGHT=1
      ;;
    --reset-db)
      RESET_DB=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --allow-insecure)
      ALLOW_INSECURE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
  shift
done

command_exists curl || die "curl is required."
command_exists tar || die "tar is required."

INSTALL_DIR="${INSTALL_DIR:-$(default_install_dir)}"

if [[ -n "$BUNDLE_URL" ]]; then
  validate_url "$BUNDLE_URL" || die "--bundle-url must use HTTPS unless --allow-insecure is provided."
fi

if [[ -n "$ENV_URL" ]]; then
  validate_url "$ENV_URL" || die "--env-url must use HTTPS unless --allow-insecure is provided."
fi

if [[ -n "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  die "Env file not found: $ENV_FILE"
fi

if [[ -z "$BUNDLE_URL" ]]; then
  if [[ "$TAG" == "latest" ]]; then
    TAG="$(resolve_latest_tag)"
  else
    validate_tag "$TAG" || die "Invalid delivery tag: $TAG"
    TAG="$(normalize_tag "$TAG")"
  fi

  BUNDLE_URL="$(build_archive_url "$TAG")"
fi

if [[ -z "$ENV_URL" && -z "$ENV_FILE" && "$TAG" != "latest" ]]; then
  ENV_URL="$(build_env_url "$TAG")"
fi

release_name="${TAG:-bundle}"
release_name="${release_name//[^A-Za-z0-9._-]/-}"
if [[ "$release_name" == "latest" || -z "$release_name" ]]; then
  release_name="bundle-$(date +%Y%m%d%H%M%S)"
fi

RELEASES_DIR="${INSTALL_DIR}/releases"
SHARED_DIR="${INSTALL_DIR}/shared"
RELEASE_DIR="${RELEASES_DIR}/${release_name}"

if [[ -e "$RELEASE_DIR" ]]; then
  RELEASE_DIR="${RELEASE_DIR}-$(date +%Y%m%d%H%M%S)"
fi

installer_args=()
[[ "$PROD_MODE" -eq 1 ]] && installer_args+=(--prod)
[[ "$NO_START" -eq 1 ]] && installer_args+=(--no-start)
[[ "$WITH_PYTHON" -eq 1 ]] && installer_args+=(--with-python)
[[ "$WITH_PLAYWRIGHT" -eq 1 ]] && installer_args+=(--with-playwright)
[[ "$RESET_DB" -eq 1 ]] && installer_args+=(--reset-db)
[[ "$DRY_RUN" -eq 1 ]] && installer_args+=(--dry-run)

log "Delivery repository: ${DELIVERY_REPO}"
log "Install root: ${INSTALL_DIR}"
log "Archive URL: ${BUNDLE_URL}"
if [[ -n "$ENV_FILE" ]]; then
  log "Env file: ${ENV_FILE}"
elif [[ "$ENV_URL_EXPLICIT" -eq 1 ]]; then
  log "Env URL: ${ENV_URL}"
elif has_embedded_env; then
  log "Env source: embedded install.sh"
elif [[ -n "$ENV_URL" ]]; then
  log "Env URL: ${ENV_URL}"
fi
log "Release directory: ${RELEASE_DIR}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  run_cmd mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
  run_cmd curl -fL "$BUNDLE_URL" -o "<temp>/delivery.tar.gz"
  if [[ -n "$ENV_FILE" ]]; then
    run_cmd cp "$ENV_FILE" "${SHARED_DIR}/.env"
  elif [[ "$ENV_URL_EXPLICIT" -eq 1 ]]; then
    run_cmd curl -fsSL "$ENV_URL" -o "${SHARED_DIR}/.env"
  elif has_embedded_env; then
    run_cmd install -m 600 "<embedded .env>" "${SHARED_DIR}/.env"
  elif [[ -n "$ENV_URL" ]]; then
    run_cmd curl -fsSL "$ENV_URL" -o "${SHARED_DIR}/.env"
  fi
  [[ -n "$SHA256_VALUE" ]] && log "Would verify SHA-256: ${SHA256_VALUE}"
  printf '[remote-install] DRY-RUN: bash scripts/install.sh'
  printf ' %q' "${installer_args[@]}"
  printf '\n'
  exit 0
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

archive_path="${tmp_dir}/delivery.tar.gz"
extract_dir="${tmp_dir}/extract"

mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$extract_dir"
curl -fL "$BUNDLE_URL" -o "$archive_path"

if [[ -n "$SHA256_VALUE" ]]; then
  checksum_file "$archive_path" "$SHA256_VALUE"
else
  warn "No SHA-256 checksum was provided. Use --sha256 or release checksum artifacts for stricter verification."
fi

tar -xzf "$archive_path" -C "$extract_dir"

first_entry="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
mkdir -p "$RELEASE_DIR"

if [[ -n "$first_entry" ]]; then
  cp -R "${first_entry}/." "$RELEASE_DIR/"
else
  cp -R "${extract_dir}/." "$RELEASE_DIR/"
fi

if [[ ! -f "${SHARED_DIR}/.env" ]]; then
  if [[ -f "${INSTALL_DIR}/current/.env" ]]; then
    cp "${INSTALL_DIR}/current/.env" "${SHARED_DIR}/.env"
    chmod 600 "${SHARED_DIR}/.env"
  elif [[ -n "$ENV_FILE" ]]; then
    cp "$ENV_FILE" "${SHARED_DIR}/.env"
    chmod 600 "${SHARED_DIR}/.env"
  elif [[ "$ENV_URL_EXPLICIT" -eq 1 ]]; then
    download_env_file "$ENV_URL" "${SHARED_DIR}/.env"
  elif has_embedded_env; then
    write_embedded_env_file "${SHARED_DIR}/.env"
  elif [[ -n "$ENV_URL" ]]; then
    download_env_file "$ENV_URL" "${SHARED_DIR}/.env"
  fi
fi

if [[ -f "${SHARED_DIR}/.env" ]]; then
  ln -sfn "${SHARED_DIR}/.env" "${RELEASE_DIR}/.env"
fi

mkdir -p "${SHARED_DIR}/logs"
rm -rf "${RELEASE_DIR}/logs"
ln -sfn "${SHARED_DIR}/logs" "${RELEASE_DIR}/logs"

if [[ -L "${INSTALL_DIR}/current" ]]; then
  PREVIOUS_CURRENT="$(readlink "${INSTALL_DIR}/current")"
fi

ln -sfn "$RELEASE_DIR" "${INSTALL_DIR}/current.next"
mv -f "${INSTALL_DIR}/current.next" "${INSTALL_DIR}/current"
CURRENT_UPDATED=1

(
  cd "$RELEASE_DIR"
  bash scripts/install.sh "${installer_args[@]}"
)

CURRENT_UPDATED=0
log "Install complete: ${INSTALL_DIR}/current"
