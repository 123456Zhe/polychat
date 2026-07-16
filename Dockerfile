FROM node:24-bookworm-slim

WORKDIR /app

COPY --chown=node:node package.json package-lock.json server.mjs ./
COPY --chown=node:node modules ./modules
COPY --chown=node:node web-client ./web-client
COPY --chown=node:node assets ./assets

RUN npm ci --ignore-scripts \
    && npm run web:build \
    && npm prune --omit=dev \
    && npm cache clean --force \
    && mkdir -p /app/data/uploads \
    && chown -R node:node /app/data

USER node

ENV HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/app/data/polychat.db \
    UPLOAD_DIR=/app/data/uploads \
    AVATAR_DIR=/app/data/avatars

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
