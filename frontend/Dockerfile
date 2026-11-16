# Web image: builds the React app and serves it with Nginx, which also terminates TLS
# and proxies /api to the API container.
# Build from the repo root:  docker build -f frontend/Dockerfile -t foxalora-web .
FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

FROM nginx:1.30.5-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80 443
