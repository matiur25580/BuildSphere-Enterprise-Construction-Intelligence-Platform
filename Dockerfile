FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --omit=dev
COPY --from=build /app/apps/api/dist ./apps/api/dist
ENV DOCUMENT_STORAGE_DIR=/var/lib/buildsphere/documents
RUN mkdir -p /var/lib/buildsphere/documents && chown -R node:node /var/lib/buildsphere
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch(\u0027http://127.0.0.1:5000/api/v1/health\u0027).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
