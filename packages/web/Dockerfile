# Byoky marketing site (Next.js). Build context = repo ROOT (pnpm workspace).
# Depends on @byoky/core + @byoky/sdk (its build script builds them first).
# Set RAILWAY_DOCKERFILE_PATH=packages/web/Dockerfile.
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@byoky/web..."
RUN pnpm --filter @byoky/web build

FROM base
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/packages/web
CMD ["sh", "-c", "./node_modules/.bin/next start -p ${PORT:-3000} -H 0.0.0.0"]
