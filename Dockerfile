FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl --fail --silent --show-error --location https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/rds-global-bundle.pem

ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm run typecheck:libs \
  && pnpm --filter @workspace/api-server run build \
  && PORT=5173 BASE_PATH=/ pnpm --filter @workspace/todopay run build

FROM build AS migration
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && pnpm --filter @workspace/db run migrate-integration"]

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem

COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/todopay/dist/public ./public
COPY --from=build /app/rds-global-bundle.pem ./rds-global-bundle.pem

USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
