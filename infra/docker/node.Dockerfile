FROM node:24.19.0-bookworm-slim AS build

ENV CI=true
ENV PNPM_CONFIG_NETWORK_CONCURRENCY=4
ENV PNPM_CONFIG_FETCH_RETRIES=5
WORKDIR /workspace

RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=site-monitor-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

ARG APP
RUN pnpm --filter "@site-monitor/${APP}..." build
RUN pnpm --filter "@site-monitor/${APP}" deploy --prod /opt/app

FROM node:24.19.0-bookworm-slim AS runtime

ARG APP
ENV NODE_ENV=production
ENV SERVICE_VERSION=0.1.0
WORKDIR /app

COPY --from=build --chown=node:node /opt/app ./

USER node
CMD ["node", "dist/index.js"]
