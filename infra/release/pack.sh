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
agents
app
components
lib
runner
public
infra/release
infra/native
"

# The shipped shell scripts get checked before anything is packaged.
#
# The `$VAR` + non-ASCII check exists because v0.1.0 shipped an installer that died on its
# third line with `REPO…: unbound variable`: macOS /bin/sh is bash 3.2, which swallows the
# UTF-8 ellipsis bytes into the variable name. Linux shells parse it fine, so CI can't catch
# it — only this pattern check can. Brace such references: `${REPO}…`.
for script in infra/release/*.sh; do
  sh -n "$script" || {
    printf 'error: %s has a syntax error\n' "$script" >&2
    exit 1
  }
  # `grep -E` with a byte range, not `grep -P`: BSD grep (what /bin/sh gets on macOS) has no
  # PCRE and exits 2, which an `if` reads as "no match" — the check would pass by being broken.
  # LC_ALL=C makes each byte a character, so the ellipsis's high bytes match `[^ -~]`.
  if LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' "$script"; then
    printf 'error: %s has $VAR directly followed by a non-ASCII character (see above).\n' "$script" >&2
    printf '       Brace it — ${VAR}… — or bash 3.2 reads the whole thing as the name.\n' >&2
    exit 1
  fi
done

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
