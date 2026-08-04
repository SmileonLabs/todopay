FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl --fail --silent --show-error --location https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem

COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build

# One-shot image used only by a private ECS task to apply the Drizzle schema.
# It is never exposed through the load balancer or used as an application task.
FROM build AS migration
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && pnpm --filter @workspace/db run migrate-production && pnpm --filter @workspace/db run backfill-merchant-fees"]

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem

# The API is bundled by esbuild; pino worker artifacts are emitted alongside it.
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/rds-global-bundle.pem ./rds-global-bundle.pem

USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
