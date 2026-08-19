import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { authenticated } from "./external-v1-shared.js";
import {
  dateValue,
  isDateInput,
  kstDate,
  pageValue,
  sqlValues,
  storeCodesValue,
} from "./external-v1-helpers.js";

const router = Router();

function rangeFromQuery(query: Record<string, unknown>) {
  const startRaw = query.startDate;
  const endRaw = query.endDate;
  if (startRaw !== undefined && !isDateInput(startRaw)) return null;
  if (endRaw !== undefined && !isDateInput(endRaw)) return null;
  const startDate = startRaw ? dateValue(startRaw) : null;
  const endDate = endRaw ? dateValue(endRaw, true) : null;
  if (startDate && endDate && startDate > endDate) return null;
  return { startDate, endDate };
}

function storeFilter(storeCodes: string[] | null) {
  if (storeCodes === null) return sql``;
  if (storeCodes.length === 0) return sql`and false`;
  return sql`and store.login_id in (${sqlValues(storeCodes)})`;
}

function startFilter(value: Date | null) {
  return value ? sql`and ledger.created_at >= ${value}` : sql``;
}

function endFilter(value: Date | null) {
  return value ? sql`and ledger.created_at <= ${value}` : sql``;
}

router.get("/external/v1/settlements/summary", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const range = rangeFromQuery(req.query as Record<string, unknown>);
  if (!range) {
    res.status(400).json({
      code: "INVALID_DATE_RANGE",
      error:
        "startDate와 endDate는 유효한 YYYY-MM-DD이며 시작일이 종료일보다 늦을 수 없습니다.",
    });
    return;
  }
  const codes = storeCodesValue(req);
  const rows = await db.execute(sql`
    with scoped as (
      select ledger.*
      from money_ledger ledger
      join admin_users store on store.id = ledger.store_id
      where ledger.merchant_id = ${context.merchant.id}
      ${storeFilter(codes)}
    ), filtered as (
      select * from scoped ledger
      where true ${startFilter(range.startDate)} ${endFilter(range.endDate)}
    )
    select
      count(*)::bigint as total,
      coalesce(sum(amount) filter (where direction = 'credit'), 0)::bigint as credit_amount,
      coalesce(sum(amount) filter (where direction = 'debit'), 0)::bigint as debit_amount,
      (
        select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)::bigint
        from scoped ledger
        where true ${endFilter(range.endDate)}
      ) as closing_balance
    from filtered
  `);
  const row = rows.rows[0] as Record<string, string | number>;
  res.json({
    total: Number(row.total),
    creditAmount: Number(row.credit_amount),
    debitAmount: Number(row.debit_amount),
    closingBalance: Number(row.closing_balance),
    currency: "KRW",
  });
});

async function ledgerRecords(input: {
  merchantId: number;
  storeCodes: string[] | null;
  startDate: Date | null;
  endDate: Date | null;
  page: number;
  limit: number;
}) {
  const offset = (input.page - 1) * input.limit;
  const countResult = await db.execute(sql`
    select count(*)::bigint as total
    from money_ledger ledger
    join admin_users store on store.id = ledger.store_id
    where ledger.merchant_id = ${input.merchantId}
      ${storeFilter(input.storeCodes)}
      ${startFilter(input.startDate)}
      ${endFilter(input.endDate)}
  `);
  const result = await db.execute(sql`
    with scoped as (
      select
        ledger.*,
        store.login_id as store_code,
        store.name as store_name,
        case when ledger.direction = 'credit' then ledger.amount else -ledger.amount end as signed_amount,
        case
          when ledger.reference_type = 'transaction' then tx_record.original_amount
          when ledger.reference_type = 'withdrawal' then wd_record.amount
          else null
        end as original_amount,
        case
          when ledger.reference_type = 'transaction' then tx_record.fee
          when ledger.reference_type = 'withdrawal' then wd_record.fee
          else null
        end as fee,
        coalesce(tx_record.tracking_number, wd_record.tracking_number) as tracking_number
      from money_ledger ledger
      join admin_users store on store.id = ledger.store_id
      left join transactions tx_record
        on ledger.reference_type = 'transaction' and tx_record.id = ledger.reference_id
      left join withdrawals wd_record
        on ledger.reference_type = 'withdrawal' and wd_record.id = ledger.reference_id
      where ledger.merchant_id = ${input.merchantId}
      ${storeFilter(input.storeCodes)}
    ), running as (
      select scoped.*,
        sum(signed_amount) over (order by created_at asc, id asc) as balance
      from scoped
    ), filtered as (
      select * from running ledger
      where true ${startFilter(input.startDate)} ${endFilter(input.endDate)}
    )
    select *, count(*) over()::bigint as filtered_total
    from filtered
    order by created_at desc, id desc
    limit ${input.limit} offset ${offset}
  `);
  const records = result.rows as Array<Record<string, unknown>>;
  return {
    total: Number((countResult.rows[0] as Record<string, unknown>).total),
    items: records.map((row) => ({
      id: Number(row.id),
      direction: row.direction,
      transactionType: row.entry_type,
      amount: Number(row.amount),
      originalAmount:
        row.original_amount == null ? null : Number(row.original_amount),
      fee: row.fee == null ? null : Number(row.fee),
      balance: Number(row.balance),
      trackingNumber: row.tracking_number ?? null,
      storeCode: row.store_code,
      storeName: row.store_name,
      baseDate: kstDate(new Date(String(row.created_at))),
      createdAt: new Date(String(row.created_at)).toISOString(),
    })),
  };
}

router.get("/external/v1/settlements/records", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const range = rangeFromQuery(req.query as Record<string, unknown>);
  if (!range) {
    res.status(400).json({
      code: "INVALID_DATE_RANGE",
      error: "startDate와 endDate가 올바르지 않습니다.",
    });
    return;
  }
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const records = await ledgerRecords({
    merchantId: context.merchant.id,
    storeCodes: storeCodesValue(req),
    startDate: range.startDate,
    endDate: range.endDate,
    page,
    limit,
  });
  res.json({ page, limit, ...records });
});

router.get("/external/v1/balance/records", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const range = rangeFromQuery(req.query as Record<string, unknown>);
  if (!range) {
    res.status(400).json({
      code: "INVALID_DATE_RANGE",
      error: "startDate와 endDate가 올바르지 않습니다.",
    });
    return;
  }
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const records = await ledgerRecords({
    merchantId: context.merchant.id,
    storeCodes: storeCodesValue(req),
    startDate: range.startDate,
    endDate: range.endDate,
    page,
    limit,
  });
  res.json({ page, limit, ...records });
});

export default router;
