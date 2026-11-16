# Foxalora API image. Also runs the operator CLI (migrations, tenants, mail servers).
# Build from the repo root:  docker build -f backend/Dockerfile -t foxalora-api .
FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev --no-fund --no-audit

FROM node:24.22.1-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S fox && adduser -S fox -G fox
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/package.json ./
USER fox
EXPOSE 3000
# Port check only: the API answers 401/400 to anonymous requests, which is still "up".
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
