# syntax=docker/dockerfile:1

# bins — offline-first PWA inventory tracker. Built by CI and published to
# GHCR; which image actually runs is pinned in the ops repo, per deployment
# (servers/firefly/stacks/bins/ and servers/steamboat/stacks/bins-tsl/).
#
# One image serves every deployment: instance differences (base URL, open
# access, home view) are runtime env vars, not build inputs.

# --- Build: full deps, SPA build, then prune to production deps -------------
FROM debian:bookworm-slim AS build

ARG BUN_VERSION=1.3.0
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl unzip \
	&& rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}" \
	&& bun --version

# Node is a BUILD-time requirement, not a runtime one. React Router's SPA-mode
# build prerenders index.html; under Bun, react-dom/server resolves to
# server.bun.js, which has no renderToPipeableStream, and the build dies.
# `bun run build` honours the CLI's node shebang when node is on PATH.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
	&& apt-get install -y --no-install-recommends nodejs \
	&& rm -rf /var/lib/apt/lists/* \
	&& node --version

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Prune to production dependencies for the runtime stage. Done after the build
# so devDependencies (vite, react-router/dev, …) are still present above.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# --- Runtime: Bun + the built app, nothing else -----------------------------
FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates libicu72 libssl3 \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
ENV NODE_ENV=production

# Exactly what server.ts needs at runtime: the SPA build, the modules it
# imports (api/, shared/, db/ incl. migrations — the app auto-migrates on boot)
# and production node_modules. A missing import here builds fine and then can
# never boot, so keep this list in step with server.ts's imports.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/api ./api
COPY --from=build /app/shared ./shared
COPY --from=build /app/db ./db
COPY --from=build /app/server.ts /app/release-assets.ts /app/package.json ./

# Stamp the build so the running app reports which release it is. server.ts
# serves this at /_version, and ops' deploy verifies the image's
# org.opencontainers.image.revision label against the pin it was given.
ARG GIT_SHA=unknown
RUN printf '%s' "${GIT_SHA}" > /app/BUILD_SHA

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Runs as root on purpose. The only writable surfaces are this app's own
# volumes, and the socket it creates lives in a volume shared with Caddy (which
# is also root) — dropping privileges here would mean an entrypoint that starts
# as root to chown the mountpoints anyway. Same call camptool's compose makes.
#
# The entrypoint stages this release onto the app volume as
# /srv/bins/releases/<sha> and runs from there, so release-assets.ts can still
# serve earlier releases' client assets to devices holding a stale shell.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
