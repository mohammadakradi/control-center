# syntax=docker/dockerfile:1.7
# Dev image for the Control Center: runs the Next.js dashboard (:3000) and the
# runner daemon (:4319) together via `pnpm dev:container`. Source is bind-mounted by
# docker-compose for hot reload; this image provides a reproducible Linux runtime
# with a Linux-built better-sqlite3 (the host's macOS build can't be reused).
#
# Build context is the repo root.

FROM node:22-slim AS base
# Pin pnpm to the version that produced pnpm-lock.yaml (repo has no packageManager field).
# Installed globally rather than via corepack so the pinned version is on PATH for every
# user — corepack's activation is per-HOME and would be lost under the non-root `node` user.
RUN npm install -g pnpm@9.12.1
WORKDIR /app

# ── deps: install node_modules with the toolchain better-sqlite3 needs to compile ──
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── dev: final runtime. Keeps the build toolchain so an in-container `pnpm install`
#    (e.g. after a dependency change) can recompile native modules. Source and the
#    node_modules/.next volumes are mounted at run time by docker-compose. ──
FROM base AS dev
# git + tini for the runtime; gh (GitHub CLI) so agents can `gh pr create` and the
# UI's push/pull can authenticate over HTTPS via gh's git credential helper.
# python3/make/g++ stay so an in-container `pnpm install` can rebuild native modules.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ git tini curl ca-certificates \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
         > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# Pre-populate node_modules so the named volume that masks the bind-mounted source
# is seeded with the Linux-built dependencies on first run. Prepare the .next + data
# mount points and hand /app to the unprivileged `node` user (UID 1000) — empty named
# volumes inherit this ownership, so the non-root process can write to them.
COPY --from=deps /app/node_modules ./node_modules
RUN mkdir -p /app/.next /app/data && chown -R node:node /app
# Run as non-root: the container has the host's ~/.claude + ~/Dev mounted in, so a
# compromised process must not run as root over those paths.
USER node
EXPOSE 3001 4319
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "dev:container"]

# There is deliberately no `release` stage. Releases install natively (Node 22+, no Docker) —
# see infra/release/. Docker is the *development* runtime only.
