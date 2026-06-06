# Stage 1: Install dependencies
FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm i -g pnpm
ENV CI=true
RUN pnpm install --prod --frozen-lockfile

# Stage 2: Build the application
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm i -g pnpm
ENV CI=true
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 3: Production image
FROM node:20-alpine AS final
WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 5000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]