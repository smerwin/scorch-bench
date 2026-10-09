# Agent-arena server + the static game it serves. Build context is
# projects/scorch so the server can load the browser engine in ../js.
FROM node:22-alpine

WORKDIR /app

COPY index.html style.css AGENTS.md ./
COPY js ./js
COPY server/package.json ./server/
COPY server/src ./server/src
COPY server/bots ./server/bots

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/server.js"]
