FROM node:22-alpine

WORKDIR /app

COPY server.js package.json ./
COPY lib ./lib
COPY public ./public

RUN addgroup -S api-portal && adduser -S api-portal -G api-portal \
    && chown -R api-portal:api-portal /app

USER api-portal

ENV NODE_ENV=production \
    PORT=3401 \
    HOST=0.0.0.0

EXPOSE 3401

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:3401/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
