FROM node:24.19.0-bookworm-slim AS build

ENV CI=true
WORKDIR /workspace

RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/database ./packages/database

RUN pnpm install --filter @site-monitor/database... --frozen-lockfile
RUN pnpm --filter @site-monitor/database build
RUN pnpm --filter @site-monitor/database deploy --prod /opt/app

FROM node:24.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV SERVICE_VERSION=0.1.0
WORKDIR /app

COPY --from=build --chown=node:node /opt/app ./
COPY --chown=node:node database ./database

USER node
CMD ["node", "dist/cli.js", "migrate"]
