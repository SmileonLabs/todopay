import { inArray, sql } from "drizzle-orm";
import {
  adminUsersTable,
  membersTable,
  moneyLedgerTable,
  paymentEventsTable,
  transactionsTable,
  virtualAccountIssuancesTable,
  virtualAccountsTable,
  withdrawalsTable,
} from "@workspace/db";
import type { Request } from "express";

export const KPPAY_VIRTUAL_BANK_CODE = "035";
export const bankNames: Record<string, string> = { "035": "제주은행" };

export function pageValue(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}
export function dateValue(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
export function stringValue(value: unknown, maximum = 100): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function normalizeBirthdate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
    : null;
}
export function storeCodesValue(req: Request): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(req.query, "storeCodes"))
    return null;
  const raw = stringValue(req.query.storeCodes, 5_000);
  const codes = [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (codes.length === 0 || codes.length > 100) return [];
  return codes.every((code) => /^[A-Za-z0-9_.-]{2,50}$/.test(code))
    ? codes
    : [];
}
function sqlValues(values: string[]) {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}
export function memberStoreScope(codes: string[] | null) {
  if (codes === null) return undefined;
  return codes.length === 0
    ? sql`false`
    : inArray(membersTable.storeCode, codes);
}
export function transactionStoreScope(codes: string[] | null) {
  if (codes === null) return undefined;
  if (codes.length === 0) return sql`false`;
  return sql`EXISTS (SELECT 1 FROM members scoped_member WHERE scoped_member.id = ${transactionsTable.memberId} AND scoped_member.store_code IN (${sqlValues(codes)}))`;
}
export function withdrawalStoreScope(codes: string[] | null) {
  if (codes === null) return undefined;
  if (codes.length === 0) return sql`false`;
  return sql`EXISTS (SELECT 1 FROM admin_users scoped_store WHERE scoped_store.id = ${withdrawalsTable.storeId} AND scoped_store.login_id IN (${sqlValues(codes)}))`;
}
export function ledgerStoreScope(codes: string[] | null) {
  if (codes === null) return undefined;
  if (codes.length === 0) return sql`false`;
  return sql`EXISTS (SELECT 1 FROM admin_users scoped_store WHERE scoped_store.id = ${moneyLedgerTable.storeId} AND scoped_store.login_id IN (${sqlValues(codes)}))`;
}
export function virtualAccountStoreScope(codes: string[] | null) {
  if (codes === null) return undefined;
  if (codes.length === 0) return sql`false`;
  return sql`EXISTS (SELECT 1 FROM members scoped_member WHERE scoped_member.id = ${virtualAccountIssuancesTable.memberId} AND scoped_member.store_code IN (${sqlValues(codes)}))`;
}
export function activeAccountStoreScope(codes: string[] | null) {
  if (codes === null) return undefined;
  if (codes.length === 0) return sql`false`;
  return sql`EXISTS (SELECT 1 FROM members scoped_member WHERE scoped_member.id = ${virtualAccountsTable.memberId} AND scoped_member.store_code IN (${sqlValues(codes)}))`;
}
export function paymentEventStoreScope(codes: string[] | null) {
  if (codes === null) return undefined;
  if (codes.length === 0) return sql`false`;
  return sql`(
    EXISTS (SELECT 1 FROM transactions scoped_tx JOIN members scoped_member ON scoped_member.id = scoped_tx.member_id WHERE scoped_tx.merchant_id = ${paymentEventsTable.merchantId} AND scoped_tx.tracking_number = ${paymentEventsTable.trackingNumber} AND scoped_member.store_code IN (${sqlValues(codes)}))
    OR EXISTS (SELECT 1 FROM withdrawals scoped_withdrawal JOIN admin_users scoped_store ON scoped_store.id = scoped_withdrawal.store_id WHERE scoped_withdrawal.merchant_id = ${paymentEventsTable.merchantId} AND scoped_withdrawal.tracking_number = ${paymentEventsTable.trackingNumber} AND scoped_store.login_id IN (${sqlValues(codes)}))
  )`;
}
