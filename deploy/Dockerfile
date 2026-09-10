# Minimal Zero-Dependency Production Container for Falcon Board Server
FROM node:22-alpine

WORKDIR /app

# Zero external npm dependencies - pure Node.js built-ins
COPY package.json ./
COPY components/ ./components/

# Create persistent storage directories
RUN mkdir -p /data/boards /data/config

ENV NODE_ENV=production
ENV PORT=3333
ENV FALCON_ROSTER_PATH=/data/config/roster.json
ENV BOARDS_DIR=/data/boards

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e 'fetch("http://localhost:3333/api/v1/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

CMD ["node", "components/board/tools/serve.mjs", "--port", "3333", "--roster", "/data/config/roster.json", "--boards-dir", "/data/boards"]
