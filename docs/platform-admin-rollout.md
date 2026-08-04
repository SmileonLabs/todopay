# TodoPay platform admin rollout

## Purpose

TodoPay is the master merchant for the upstream PG. Sellink is the first
internal merchant (`SELLINK_001`). The upstream PG key remains server-only;
the merchant code and merchant API keys are TodoPay internal credentials.

## Deployment order

1. Apply the Drizzle schema update.
2. Run `infra/sql/001-bootstrap-sellink-merchant.sql` once.
3. Create a new administrator with role `platform_admin`, `merchant_id = NULL`,
   a unique password, and OTP required. Do not reuse the Sellink admin account.
4. Build the existing merchant console with `pnpm --dir artifacts/todopay run build:merchant`
   and deploy it to `admin.sellink.io`.
5. Build the partner console with `pnpm --dir artifacts/todopay run build:partner`
   and deploy it to `partner.todopay.io`.
6. Build the platform console with `pnpm --dir artifacts/todopay run build:platform`
   and deploy it to `platform.todopay.io`.
7. Set `CORS_ORIGINS` to exactly the required HTTPS admin origins and verify that
   each console rejects the other tenant's resources.
8. Only then enable live KPPay NOTI. The webhook now requires the matched
   transaction or withdrawal to have a `merchant_id`.

## Operational rules

- `platform_admin` is the only cross-merchant role and must not have a merchant ID.
- All merchant administrators and stores must have exactly one merchant ID.
- Merchant API keys are returned once when rotated; only their hash is stored.
- A merchant in `suspended` or `terminated` state must not be allowed to call
  public payment APIs (enforcement is the next API-gateway rollout item).
