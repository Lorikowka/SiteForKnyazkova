# --- Сборка зависимостей (better-sqlite3 собирается из исходников на alpine) ---
FROM node:24.22.1-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# --- Рантайм ---
FROM node:24.22.1-alpine
RUN apk add --no-cache tzdata
ENV TZ=Europe/Moscow
ENV NODE_ENV=production
ENV PORT=1488
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 1488
CMD ["node", "server.js"]
