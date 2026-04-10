FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json ./
RUN pnpm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

EXPOSE 3200
CMD ["node", "dist/server.js"]
