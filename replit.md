# TodoPay

가상계좌 발급 및 입/출금 관리 핀테크 어드민 플랫폼.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/todopay run dev` — run the frontend (port 21259)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Default credentials
- superadmin / admin1234
- hq01 / test1234
- dist01 / test1234
- agency01 / test1234
- store01 / test1234

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + Recharts

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for API contract
- `lib/db/src/schema/` — Drizzle DB schema (users, members, buyers, virtual_accounts, withdrawals, transactions, balances, fees, notices, otp_settings)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/todopay/src/` — React frontend

## Architecture decisions

- 5-level admin hierarchy: superadmin → hq → distributor → agency → store
- Simple base64 token auth (auth header: `Bearer <token>`) — sufficient for demo/MVP
- Fee system: cascading percentages set per admin user level
- Virtual accounts tied to both members and buyers
- OTP settings stored per-user in DB

## Product

- Multi-level admin platform for managing virtual account issuance and deposit/withdrawal flows
- Role-based access: superadmin, hq, distributor, agency, store (readonly/admin/finance permissions)
- Withdrawal approval workflow with approve/reject states
- Daily statistics dashboard with charts
- Buyer self-registration with virtual account issuance
- OTP configuration for deposits and withdrawals

## User preferences

- Korean fintech platform — UI uses Korean labels
- Dark navy theme with electric blue accents

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- Always run `pnpm --filter @workspace/db run push` after changing `lib/db/src/schema/`
- The `simpleHash` function in route files must stay in sync if changed

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
