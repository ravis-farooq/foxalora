# Web image: builds the React app and serves it with Nginx, which also proxies /api to the API.
# Draft, not yet built or tested. Run from the repo root:  docker build -f frontend/Dockerfile -t foxalora-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80 443
