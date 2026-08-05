import crypto from "node:crypto";
import { config } from "../config.js";

export class TodoPayClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(message);
  }
}

function configuration() {
  const apiKey = config.todoPayApiKey;
  const baseUrl = config.todoPayApiBaseUrl;
  if (!apiKey) throw new TodoPayClientError("TodoPay API is not configured", 503, null);
  if (!baseUrl) throw new TodoPayClientError("TodoPay API URL is not configured", 503, null);
  return { apiKey, baseUrl };
}

export function isTodoPayConfigured(): boolean {
  return Boolean(config.todoPayApiKey && config.todoPayApiBaseUrl);
}

export async function requestTodoPay(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; requestId?: string } = {},
): Promise<unknown> {
  const { apiKey, baseUrl } = configuration();
  const method = options.method ?? "GET";
  const requestId = options.requestId ?? crypto.randomUUID();
  const response = await fetch(`${baseUrl}/api/external/v1${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      "X-TodoPay-Api-Key": apiKey,
      "X-Request-Id": requestId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(config.todoPayRequestTimeoutMs),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: "Unexpected TodoPay API response" };
  if (!response.ok) {
    throw new TodoPayClientError("TodoPay API request failed", response.status, payload);
  }
  return payload;
}
