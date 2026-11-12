# Foxalora API image (draft, not yet built or tested).
# Run from the repo root:  docker build -f backend/Dockerfile -t foxalora-api .
FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package.json ./
# No lockfile exists yet: generate one (npm install) and commit it, then switch to `npm ci`.
RUN npm install
COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S fox && adduser -S fox -G fox
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/package.json ./
USER fox
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/v1/auth/me || [ $? -eq 8 ]
CMD ["node", "dist/main.js"]
