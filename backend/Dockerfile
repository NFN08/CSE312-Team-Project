FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Mount point for the auth server's public key (shared volume, mounted read-only).
RUN mkdir -p /keys/public && chown -R node:node /keys

USER node
EXPOSE 3000

CMD ["node", "src/server.js"]

