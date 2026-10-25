import { EngineError } from "../schema/errors";

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  providerId: string,
  signal?: AbortSignal,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new EngineError("ProviderFailed", `network error calling ${providerId}: ${e instanceof Error ? e.message : String(e)}`, { providerId });
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? text.slice(0, 300);
    throw new EngineError("ProviderFailed", `${providerId} returned ${res.status}: ${msg}`, { providerId, status: res.status });
  }
  return data;
}
