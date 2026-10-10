FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --no-audit --no-fund
COPY . .
RUN npm run build:railway

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTING_PLATFORM=railway DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/start-railway.mjs /app/scripts/railway-http.mjs /app/scripts/railway-backup.mjs ./scripts/
# Railway mounts the persistent volume at runtime; the image never creates it.
CMD ["node", "scripts/start-railway.mjs"]
