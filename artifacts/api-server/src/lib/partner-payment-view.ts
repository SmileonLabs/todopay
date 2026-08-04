export function maskName(value: string | null | undefined) {
  if (!value) return null;
  if (value.length === 1) return value;
  if (value.length === 2) return `${value[0]}*`;
  return `${value[0]}${"*".repeat(Math.min(value.length - 2, 3))}${value.at(-1)}`;
}

export function maskLoginId(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 3) return `${value[0] ?? ""}**`;
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 3, 5))}${value.at(-1)}`;
}

export function maskPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "*".repeat(digits.length);
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

export function maskEmail(value: string | null | undefined) {
  if (!value) return null;
  const [local, domain] = value.split("@");
  if (!domain) return maskLoginId(value);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, Math.min(local.length - visible.length, 5)))}@${domain}`;
}

export function maskAccount(value: string | null | undefined) {
  if (!value) return null;
  const compact = value.replace(/\s/g, "");
  if (compact.length <= 4) return "*".repeat(compact.length);
  return `${"*".repeat(Math.min(compact.length - 4, 10))}${compact.slice(-4)}`;
}

export function maskIp(value: string | null | undefined) {
  if (!value) return null;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.*.*`;
  if (value.includes(":")) {
    const parts = value.split(":").filter(Boolean);
    return `${parts.slice(0, 2).join(":")}::****`;
  }
  return "****";
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
