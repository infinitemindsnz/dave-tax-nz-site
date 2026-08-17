#!/usr/bin/env bash
# Deploy this site to Fly.
#
# Called by the governed publisher runner as PUBLISHER_DEPLOY_CMD after a
# successful, approved publish. Also safe to run by hand.
#
# Why this wrapper exists rather than calling `flyctl deploy` directly:
# flyctl has been observed to exit 0 when the remote build actually FAILED
# (seen twice while building this site — the image never changed and the old
# release stayed live while the command reported success). A deploy step that
# lies is worse than no deploy step, because the publisher would record a
# governed change as live when the public site still serves the old value.
# So success is proven from Fly's own release state, never from the exit code.
#
# Requires FLY_API_TOKEN — use the deploy-only, single-app token, not a
# personal login. The runner holds the narrowest credential that can do its job.
set -euo pipefail

APP="${FLY_APP:-dave-tax-nz-site}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${FLY_API_TOKEN:-}" ]; then
  echo "deploy: FLY_API_TOKEN is not set — refusing to fall back to interactive auth" >&2
  exit 2
fi

# flyctl emits PascalCase keys here ("Version"), which is easy to get wrong and
# fails silently into 0 — which then reads as "release did not advance" and
# fails a deploy that actually worked. Accept either casing, and make an
# unreadable release list a hard error rather than a quiet zero.
release_version() {
  flyctl releases -a "$APP" --json 2>/dev/null \
    | python3 -c 'import json,sys
try:
    r = json.load(sys.stdin)
except Exception:
    sys.exit(3)
if not r:
    print(0); sys.exit(0)
top = r[0]
for key in ("Version", "version"):
    if key in top:
        print(top[key]); sys.exit(0)
sys.exit(3)'
}

before="$(release_version)"
echo "deploy: $APP at release v$before — building"

set +e
out="$(flyctl deploy --config fly.toml --ha=false --remote-only 2>&1)"
code=$?
set -e
printf '%s\n' "$out" | tail -20

if [ $code -ne 0 ]; then
  echo "deploy: flyctl exited $code" >&2
  exit 1
fi

# The exit-0 trap: flyctl can report success while the build failed.
if printf '%s' "$out" | grep -qiE '^Error:|failed to solve|did not complete successfully'; then
  echo "deploy: flyctl exited 0 but its output reports a build failure" >&2
  exit 1
fi

after="$(release_version)"
if [ "$after" -le "$before" ]; then
  echo "deploy: release did not advance (v$before -> v$after) — treating as failed" >&2
  exit 1
fi

echo "deploy: $APP released v$before -> v$after"
