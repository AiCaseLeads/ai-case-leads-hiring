FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --no-audit --no-fund
COPY . .
RUN npm run build:railway

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTING_PLATFORM=railway DATA_DIR=/data
# OCR stays local. Native processes are capped with prlimit, one page at a time.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils fontconfig fonts-dejavu-core tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa util-linux && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/lib/pdf/fonts ./lib/pdf/fonts
COPY --from=build /app/scripts/start-railway.mjs /app/scripts/railway-http.mjs /app/scripts/railway-backup.mjs /app/scripts/pdf-text-worker.mjs ./scripts/
# Railway mounts the persistent volume at runtime; the image never creates it.
CMD ["node", "scripts/start-railway.mjs"]
