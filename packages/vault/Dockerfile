FROM node:22-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/vault/package.json packages/vault/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/vault/ packages/vault/
RUN pnpm --filter @byoky/core build && pnpm --filter @byoky/vault build

FROM base
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/vault/package.json packages/vault/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/vault/dist packages/vault/dist
EXPOSE 3100
CMD ["node", "packages/vault/dist/server.js"]
