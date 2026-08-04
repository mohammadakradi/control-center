#!/bin/sh
# Builds the release tarball: control-center-<version>.tar.gz in dist/.
#
#   sh infra/release/pack.sh            # version from package.json
#   sh infra/release/pack.sh 0.2.0      # explicit
#
# Used by .github/workflows/release.yml and runnable locally to inspect exactly what ships.
#
# The file list is an **allowlist**, not an exclude list. An exclude list fails silently and
# open — the day someone adds a directory holding local state, an exclude list ships it. This
# app keeps a SQLite database, an encrypted token vault and .env files next to the source, so
# "ship only these" is the only safe direction.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

version=${1:-$(node -p 'require("./package.json").version')}
name="control-center-$version"
out="$root/dist"
stage="$out/$name"

# Everything the app needs to run `next dev` + the runner, and nothing else.
PATHS="
package.json
pnpm-lock.yaml
next.config.ts
tsconfig.json
postcss.config.mjs
drizzle.config.ts
drizzle
eslint.config.mjs
proxy.ts
app
components
lib
runner
public
infra/release
"

rm -rf "$stage"
mkdir -p "$stage"

for path in $PATHS; do
  if [ ! -e "$path" ]; then
    printf 'error: %s is listed in pack.sh but missing — did it get renamed?\n' "$path" >&2
    exit 1
  fi
  mkdir -p "$stage/$(dirname "$path")"
  cp -R "$path" "$stage/$(dirname "$path")/"
done

# Belt and braces: never ship local state even if it somehow landed inside a copied tree.
rm -rf "$stage/data" "$stage/.env" "$stage/.env.local"
find "$stage" -name ".DS_Store" -delete 2>/dev/null || :

tar -czf "$out/$name.tar.gz" -C "$out" "$name"
rm -rf "$stage"

printf '%s\n' "$out/$name.tar.gz"
