import type { AppEnv } from "./types";

const BASE = "https://text.external-api.pangram.com";
const MODEL = "pangram-4";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface PangramResult {
  prediction: string | null;
  fraction_ai: number | null;
  fraction_ai_assisted: number | null;
  fraction_human: number | null;
  full: Record<string, unknown>;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function headers(env: AppEnv): Record<string, string> {
  return { "content-type": "application/json", "x-api-key": env.PANGRAM_API_KEY ?? "" };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Score every doc as one item of a single Pangram Bulk job; poll to completion (~5 min max). */
export async function scoreWithPangram(
  env: AppEnv,
  docs: { id: string; text: string }[],
): Promise<Map<string, PangramResult>> {
  const submit = await fetch(`${BASE}/bulk`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({ items: docs.map((d) => ({ id: d.id, text: d.text })), model: MODEL }),
  });
  if (!submit.ok) {
    throw new Error(`Pangram API error ${submit.status}: ${(await submit.text()).slice(0, 500)}`);
  }
  const submitted = (await submit.json().catch(() => null)) as { bulk_id?: unknown } | null;
  if (!submitted || typeof submitted.bulk_id !== "string" || !submitted.bulk_id) {
    throw new Error("Pangram API returned unexpected response shape: expected bulk_id");
  }
  const bulkId = submitted.bulk_id;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const statusRes = await fetch(`${BASE}/bulk/${encodeURIComponent(bulkId)}`, { headers: headers(env) });
    if (!statusRes.ok) {
      throw new Error(`Pangram API error ${statusRes.status}: ${(await statusRes.text()).slice(0, 500)}`);
    }
    const status = (await statusRes.json().catch(() => null)) as { status?: unknown } | null;
    const state = typeof status?.status === "string" ? status.status : "";
    if (state === "succeeded" || state === "partial") break;
    if (state === "failed") throw new Error(`Pangram bulk job ${bulkId} failed`);
    if (Date.now() >= deadline) throw new Error(`Pangram bulk job ${bulkId} did not complete within 5 minutes`);
    await sleep(POLL_INTERVAL_MS);
  }

  const results = new Map<string, PangramResult>();
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const res = await fetch(`${BASE}/bulk/${encodeURIComponent(bulkId)}/results?offset=${offset}&limit=${limit}`, {
      headers: headers(env),
    });
    if (!res.ok) {
      throw new Error(`Pangram API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const page = (await res.json().catch(() => null)) as
      | { items?: unknown; total_items?: unknown }
      | null;
    if (!page || !Array.isArray(page.items)) {
      throw new Error("Pangram API returned unexpected results shape: expected items array");
    }
    for (const raw of page.items) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as { id?: unknown; result?: unknown };
      if (typeof item.id !== "string" || typeof item.result !== "object" || item.result === null) continue;
      const r = item.result as Record<string, unknown>;
      const prediction =
        typeof r.prediction_short === "string" ? r.prediction_short
        : typeof r.prediction === "string" ? r.prediction
        : null;
      results.set(item.id, {
        prediction,
        fraction_ai: num(r.fraction_ai),
        fraction_ai_assisted: num(r.fraction_ai_assisted),
        fraction_human: num(r.fraction_human),
        full: r,
      });
    }
    offset += page.items.length;
    const total = typeof page.total_items === "number" ? page.total_items : offset;
    if (page.items.length === 0 || offset >= total) break;
  }
  return results;
}
