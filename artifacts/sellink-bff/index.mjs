const baseUrl = process.env.TODOPAY_API_BASE_URL ?? "https://api.todopay.io";
const secretArn = process.env.TODOPAY_API_KEY_SECRET_ARN;
let apiKeyPromise;

async function getApiKey() {
  if (!secretArn) throw new Error("BFF is not configured");
  apiKeyPromise ??= import("@aws-sdk/client-secrets-manager").then(async ({ SecretsManagerClient, GetSecretValueCommand }) => {
    const result = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!result.SecretString) throw new Error("BFF API key secret is empty");
    return result.SecretString;
  });
  return apiKeyPromise;
}

const response = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

// API Gateway verifies the Sellink Cognito JWT. This function has no DB access.
export const handler = async (event) => {
  let apiKey;
  try { apiKey = await getApiKey(); } catch { return response(500, { error: "BFF is not configured" }); }
  const method = event.requestContext?.http?.method ?? "GET";
  const resource = (event.pathParameters?.proxy ?? "merchant").replace(/^\/+/, "");
  // API Gateway has already verified the Cognito JWT. This BFF never forwards
  // arbitrary core paths; member creation/editing is the only write capability
  // exposed before the PG money-flow integration is complete.
  const readResources = new Set(["merchant", "overview", "members", "transactions", "withdrawals", "webhook-events"]);
  const memberIdPath = /^members\/\d+$/;
  const isAllowed = (method === "GET" && readResources.has(resource)) || method === "POST" && resource === "members" || method === "PATCH" && memberIdPath.test(resource);
  if (!isAllowed) return response(404, { error: "Not found" });
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const headers = { "X-TodoPay-Api-Key": apiKey, ...(event.body ? { "content-type": "application/json" } : {}) };
  const upstream = await fetch(`${baseUrl}/api/external/v1/${resource}${query}`, { method, headers, body: event.body ?? undefined });
  return { statusCode: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" }, body: await upstream.text() };
};
