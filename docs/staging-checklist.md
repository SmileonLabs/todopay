# Staging deployment checklist

## Before deployment

- Set every value in `.env` from a secret manager; do not copy `.env.example` unchanged.
- Generate a unique `SESSION_SECRET` for each environment.
- Set `CORS_ORIGINS` to the exact staging web origin.
- Keep PostgreSQL and Redis on the internal network only.
- Run `pnpm run typecheck` and `pnpm --filter @workspace/api-server run test`.
- Apply the DB schema using `pnpm --filter @workspace/db run push` only to an approved staging database.

## After deployment

- Confirm `/api/healthz` returns 200 through HTTPS.
- Confirm API, PostgreSQL, Redis, and Worker health checks are green.
- Test an administrator and member login, then verify invalid signed tokens are rejected.
- Test organisation-scoped withdrawal listing and approval denial for an unauthorised account.
- Test duplicate idempotency keys and queue retry behaviour.
- Confirm audit records are created for logins and money-moving actions.
- Verify database backup and restore before production promotion.

## PG provider dependency

Do not provide IP information to the PG provider until the production egress IP or NAT gateway is final. Once fixed, provide the provider with the outbound IP and the HTTPS webhook URL. Enable `PAYMENT_PROVIDER_ENABLED` only after signed webhook validation and Sandbox tests pass.
