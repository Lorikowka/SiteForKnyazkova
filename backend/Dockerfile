# --- Сборка зависимостей (better-sqlite3 собирается из исходников на alpine) ---
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# --- Рантайм ---
FROM node:20-alpine
ENV NODE_ENV=production
ENV PORT=1488
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 1488
CMD ["node", "server.js"]
