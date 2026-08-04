# Sellink deployment boundary

Sellink runs from this independent source tree and uses the `sellink` database
on the existing TodoPay RDS instance. It must never use TodoPay's database URL.

## Required runtime secrets

- `DATABASE_URL`: the `sellink/runtime/database-url` secret
- `SESSION_SECRET`: a dedicated, random Sellink signing secret
- `OTP_ENCRYPTION_KEY`: a dedicated, stable high-entropy key for encrypting
  TOTP enrollment secrets and recovery-code hashes
- `CORS_ORIGINS`: the final Sellink console origin only
- `TODOPAY_API_BASE_URL`: `https://api.todopay.io`
- `TODOPAY_API_KEY`: the Sellink merchant API key, injected from Secrets Manager
- `REDIS_URL`: the existing TodoPay Redis endpoint
- `REQUIRE_REDIS`: `true` in production

## Financial safety gate

`PAYMENT_INTEGRATION_ENABLED` must remain `false`. Sellink never calls KPPay
directly; all financial state and provider actions go through TodoPay's
merchant API. This flag only protects legacy Sellink financial write routes
while they are being retired.

`INTERNAL_FEE_PROCESSING_ENABLED` must also remain `false` until TodoPay sends
a verified Sellink store reference with each deposit event. The internal fee
calculator, immutable policy snapshots, idempotent journal and reversal logic
can be deployed and simulated safely while this switch is off.

The fixed per-deposit fee is captured in every policy snapshot but is not
deducted from internal balances until its beneficiary/receiving account is
explicitly configured. This prevents an unexplained loss of money.

## Infrastructure choice

This image serves the console and API together. It can be attached as a
separate container in an existing ECS task only after the task's reserved CPU
and memory capacity is reviewed. A separate ECS service is more isolated but
adds a permanent Fargate cost. Do not replace the TodoPay API image with this
image.
