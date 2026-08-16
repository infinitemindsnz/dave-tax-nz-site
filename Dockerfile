FROM node:22.21.1-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
# The lockfile is generated on darwin-arm64, and npm records platform-specific
# optional dependencies (rollup's native binary) only for the generating
# platform. On linux/amd64 both `npm ci` and `npm install` then resolve rollup
# without its native module and the Astro build dies with MODULE_NOT_FOUND on
# rollup/dist/native.js. Dropping the lock lets npm resolve optional deps for
# the build platform. (npm/cli#4828)
#
# The lock is still committed and is what governance/renderer-manifest.v1.json
# hashes; when the governed publisher lands, build reproducibility should come
# from a multi-platform lock or a pinned base image digest rather than from
# `npm ci` here.
RUN rm -f package-lock.json && npm install --no-audit --no-fund

COPY . .
# vite.config.mjs sets base to "/dave-tax-nz-redesign/" only when GITHUB_ACTIONS
# is set (the Pages deploy). It is unset here, so the base resolves to "/" —
# which matters because the site references its assets relatively.
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist/client /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
