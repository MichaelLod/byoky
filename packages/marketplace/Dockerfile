FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json ./
RUN pnpm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json ./
RUN pnpm install --prod
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3200
CMD ["node", "dist/server.js"]
