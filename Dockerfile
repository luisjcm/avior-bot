FROM node:22-bookworm-slim

# Chromium del sistema (funciona en x86_64 y en ARM64, p. ej. Oracle Ampere) en lugar
# del Chrome que descarga puppeteer, que no existe para Linux ARM.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji tzdata ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Caracas \
    NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    SESSION_DIR=/data/session

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY bot.js ./
COPY src ./src

# Carpeta de sesión local (solo se usa si no hay MONGODB_URI) y permisos para el usuario sin privilegios.
RUN mkdir -p /data/session && chown -R node:node /data /app
USER node

EXPOSE 10000
ENV PORT=10000

# dumb-init reenvía SIGTERM al proceso (apagado ordenado) y recoge procesos zombi de Chromium.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "bot.js"]
