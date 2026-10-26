#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export DOCKER_BUILDKIT=0
# This WSL installation starts a second Docker daemon before Snap finishes booting.
# Wait for the existing Snap socket to be ready; do not stop/change system services.
if command -v systemctl >/dev/null && systemctl is-active --quiet snap.docker.dockerd.service; then
  ready=0
  for attempt in {1..30}; do
    root=$(timeout 3 docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
    if [[ "$root" == /var/snap/docker/common/var-lib-docker ]]; then ready=1; break; fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo 'The existing Snap Docker engine is not ready. Check the two Docker installations before retrying.' >&2
    exit 1
  fi
fi
exec docker compose up --build --pull never
