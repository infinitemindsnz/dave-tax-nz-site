FROM node:22.21.1-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# vite.config.mjs sets base to "/dave-tax-nz-redesign/" only when GITHUB_ACTIONS
# is set (the Pages deploy). It is unset here, so the base resolves to "/" —
# which matters because the site references its assets relatively.
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist/client /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
