# ---- build: install deps, build the web client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim
# poppler-utils: pdftotext for the PHB rules search/spells and Monster Manual stat blocks, pdftoppm for the character sheet PDF. Codex CLI: AI assistant (pinned version).
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
 && apt-get clean \
 && npm install -g @openai/codex@0.150.1 --no-audit --no-fund \
 && mkdir -p /data \
 && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data CODEX_HOME=/data/codex PHB_PDF=/reference/PHB-5e.pdf SHEET_PDF=/reference/DnD_2024_Character-Sheet.pdf MM_PDF=/reference/monster-manual.pdf MM_OCR_JSON=/reference/monster-manual-ocr.json MM_FIXES_JSON=/reference/monster-manual-fixes.json PORT=3000 ADMIN_INTERNAL_PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
