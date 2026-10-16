# Imagen `web`: Caddy + Angular compilado (docs/despliegue.md §6). Contexto de build: la raíz del
# repositorio. Ejemplo: docker build -f infra/web/Dockerfile -t scalekine-web .

FROM node:24.22.0-alpine3.24 AS compilar
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
# Producción es la configuración por defecto; optimization.styles.inlineCritical=false (angular.json)
# evita el manejador onload en línea que rompería la CSP (§6.2).
RUN npx ng build

FROM caddy:2.11.7-alpine
# Sin root: Caddy escucha en 80 y 443 gracias al sysctl del compose (net.ipv4.ip_unprivileged_port_start).
RUN addgroup -S -g 10001 caddy && adduser -S -u 10001 -G caddy caddy \
    && mkdir -p /data /config /srv/frontend && chown -R caddy:caddy /data /config
COPY infra/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=compilar /frontend/dist/scalekine-frontend/browser /srv/frontend
USER caddy
