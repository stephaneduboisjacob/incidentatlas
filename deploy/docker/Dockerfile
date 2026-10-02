FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/event-schema/package.json packages/event-schema/package.json
COPY packages/correlation/package.json packages/correlation/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY db ./db
COPY packages ./packages
COPY apps ./apps
RUN npm run build

FROM node:24.21.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/event-schema/package.json packages/event-schema/package.json
COPY packages/correlation/package.json packages/correlation/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
RUN mkdir -p /var/lib/incidentatlas/artifacts && chown node:node /var/lib/incidentatlas/artifacts
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
