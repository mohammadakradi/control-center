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

# Which esbuild platform packages are installed? That's the thing that decides whether tsx and
# drizzle-kit can run here.
#
# NOT `node -e "require('esbuild')"`: under pnpm, esbuild is a transitive dependency and isn't in
# the root node_modules, so that require fails on *every* platform. It made this wrapper divert
# to the container even on machines where the host was fine, and hard-fail in CI where there is
# no container — a check that was wrong everywhere while looking right on the one machine it was
# written on.
want="$(node -p 'process.platform + "-" + process.arch' 2>/dev/null || echo unknown)"
installed=$(ls node_modules/.pnpm 2>/dev/null | grep '^@esbuild+' || :)
[ -n "$installed" ] || installed=$(ls node_modules/@esbuild 2>/dev/null | sed 's/^/@esbuild+/' || :)

# Run here when a matching binary is present — or when we can't tell at all, since guessing
# "wrong platform" would break a perfectly good environment (CI, a plain npm install).
if [ -z "$installed" ] || printf '%s\n' "$installed" | grep -q "^@esbuild+${want}[@/]*"; then
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

error: this checkout's node_modules carry esbuild for another platform (they were installed
       inside the Linux dev container), so "$1" can't run on $want, and the container
       isn't running.

       Either start it:            pnpm dev        (then re-run this command)
       or install host-native deps: pnpm install --force

EOF
exit 1
