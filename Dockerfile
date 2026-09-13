# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# --- Production stage ---
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Runs as a non-root user rather than the container default root — a
# compromised dependency shouldn't get root inside the container for free.
RUN addgroup -S splitcore && adduser -S splitcore -G splitcore
USER splitcore

EXPOSE 3000
CMD ["node", "dist/main.js"]
