FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Key directories are created here (owned by the unprivileged user) so the named
# volumes mounted over them inherit this ownership when first created.
RUN mkdir -p /keys/private /keys/public \
    && chown -R node:node /keys \
    && chmod 700 /keys/private

USER node
EXPOSE 4000

CMD ["node", "src/server.js"]
