#!/bin/sh
# Run a repo command wherever this checkout's dependencies actually work.
#
#   sh infra/dev/run-script.sh npx tsx runner/export.ts --include-tokens
#
# Why this exists: `pnpm dev` installs node_modules *inside the Linux container*, and the
# named volume means the host sees that same Linux build. Anything on the host that needs
# esbuild — tsx, drizzle-kit — then dies with "You installed esbuild for another platform",
# which reads like a broken machine rather than "run it over there". So: try the host, fall
# back to the running container, and if neither works say which of the two fixes to apply.
#
# Caveat for the container path: arguments are passed through untouched, so a path argument
# has to exist inside the container too. Paths under the repo and under ~/Dev do (both are
# bind-mounted); somewhere like /tmp on the host does not.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

[ "$#" -gt 0 ] || {
  echo "usage: run-script.sh <command> [args...]" >&2
  exit 1
}

# esbuild throws at require-time when its platform binary is missing, which is exactly the
# condition that breaks tsx and drizzle-kit — so this is the honest test, not a uname guess.
if node -e "require('esbuild')" >/dev/null 2>&1; then
  exec "$@"
fi

container="${CC_DEV_CONTAINER:-platform}"
if docker ps --filter "name=^${container}$" --filter status=running --format '{{.Names}}' 2>/dev/null |
  grep -q .; then
  echo "· node_modules here is the container's Linux build — running inside '$container'." >&2
  # PATH is set explicitly: `docker exec` doesn't inherit the node_modules/.bin that pnpm
  # prepends for a package script, so a bare `tsx` or `drizzle-kit` wouldn't resolve.
  exec docker exec -w /app \
    -e PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$container" "$@"
fi

cat >&2 <<EOF

error: this checkout's node_modules were installed for Linux (inside the dev container), so
       "$1" can't run on this host, and the container isn't running.

       Either start it:            pnpm dev        (then re-run this command)
       or install host-native deps: pnpm install --force

EOF
exit 1
