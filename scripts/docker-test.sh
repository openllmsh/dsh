#!/usr/bin/env bash
# Run the plugin's tests inside a throwaway container — NO image build. We build
# the shipped `lib/` on the host, mount the repo into an existing image, and run
# node against it. openllm isn't installed in the container, so this reproduces
# the real headless "binary missing" path — the thing we kept pushing to GitHub
# to test.
#
#   pnpm test:docker
#   DSH_TEST_IMAGE=ubuntu:24.04 pnpm test:docker   # use your own Ubuntu instead
#
# Default image is node:22-slim (node preinstalled → instant). Any image works;
# if it has no `node`, the container installs it once for that run.
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="${DSH_TEST_IMAGE:-node:22-slim}"

# Fresh artifact on the host (fast; needs the host's toolchain, not the container's).
echo "==> building lib/ on host…"
pnpm build >/dev/null

echo "==> running unit suite + integration harness in ${IMAGE} (openllm absent)…"
# Mount the repo (incl. node_modules — cordis/schemastery are pure JS, so they
# load fine cross-arch); an anonymous volume over node_modules is NOT used, so
# nothing is installed unless the image lacks node.
docker run --rm \
  -v "$PWD":/plugin -w /plugin \
  "${IMAGE}" \
  sh -c '
    set -e
    if ! command -v node >/dev/null 2>&1; then
      echo "==> node not in image — installing (one-off for this run)…"
      apt-get update >/dev/null && apt-get install -y --no-install-recommends curl ca-certificates >/dev/null
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
      apt-get install -y --no-install-recommends nodejs >/dev/null
    fi
    echo "node $(node --version)"
    echo
    echo "=== unit suite ==="
    node --test "test/**/*.test.mjs"
    echo
    echo "=== integration harness (real cordis · openllm absent) ==="
    node test/integration/harness.mjs
  '
