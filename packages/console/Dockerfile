# Byoky console (Next.js). Build context = repo ROOT (pnpm workspace).
# NEXT_PUBLIC_VAULT_URL is baked at build time (client bundle) — Railway passes
# the service var as a build arg. Set RAILWAY_DOCKERFILE_PATH=packages/console/Dockerfile.
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
ARG NEXT_PUBLIC_VAULT_URL
ENV NEXT_PUBLIC_VAULT_URL=$NEXT_PUBLIC_VAULT_URL
COPY . .
RUN pnpm install --frozen-lockfile --filter "@byoky/console..."
RUN pnpm --filter @byoky/console build

FROM base
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/packages/console
CMD ["sh", "-c", "./node_modules/.bin/next start -p ${PORT:-3200} -H 0.0.0.0"]
