# Imágenes `api` y `migraciones` (docs/despliegue.md §6 y §7). Contexto de build: la raíz del repo.
#   docker build -f infra/api/Dockerfile --target api -t scalekine-api .
#   docker build -f infra/api/Dockerfile --target migraciones -t scalekine-migraciones .
# `api` lleva solo dependencias de producción y no tiene la CLI de Prisma: las migraciones no corren
# al arrancar, las aplica `migraciones` (una sola ejecución, con scalekine_migraciones).

FROM node:24.22.0-alpine3.24 AS compilar
WORKDIR /backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/ ./
# El cliente de Prisma se genera en el build (backend/src/generado) y tsc lo compila a dist/.
RUN npx prisma generate && npm run build

FROM node:24.22.0-alpine3.24 AS dependencias
WORKDIR /backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24.22.0-alpine3.24 AS migraciones
WORKDIR /backend
ENV NODE_ENV=production
COPY --from=compilar /backend/node_modules ./node_modules
COPY backend/package.json backend/prisma.config.ts ./
COPY backend/prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24.22.0-alpine3.24 AS api
WORKDIR /backend
ENV NODE_ENV=production
COPY --from=dependencias /backend/node_modules ./node_modules
COPY --from=compilar /backend/dist ./dist
COPY backend/package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/servidor.js"]
