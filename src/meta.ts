import type { AppEnv } from "./types";

/**
 * Meta Model API adapter (OpenAI-compatible chat completions shape).
 * Isolated here so a differing upstream shape only changes this file.
 * POST {META_MODEL_API_BASE}/chat/completions
 *   { model, messages: [{role, content}] }
 * Expected response: { choices: [{ message: { content: string } }] }
 */
const DEFAULT_BASE = "https://api.meta.ai/v1";
const DEFAULT_MODEL = "muse-spark-1.3";

export async function generateMatchedAi(env: AppEnv, title: string, sourceText: string, targetWords: number): Promise<string> {
  const base = (env.META_MODEL_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, "");
  const model = env.META_MODEL_ID ?? DEFAULT_MODEL;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.META_MODEL_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You write civic and legal prose. Output only the rewritten document text, with no preamble, notes, or quotation marks.",
        },
        {
          role: "user",
          content: [
            `Rewrite the following document as a fully AI-written version on the same topic, in the same genre and register, addressed to the same audience.`,
            `Match its length closely (target about ${targetWords} words) and preserve its paragraph structure where sensible. Do not copy sentences verbatim.`,
            `Title: ${title}`,
            "",
            sourceText,
          ].join("\n"),
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`Meta Model API error ${res.status}: ${detail}`);
  }
  const data: unknown = await res.json().catch(() => null);
  const content = extractContent(data);
  if (!content) {
    throw new Error("Meta Model API returned unexpected response shape: expected choices[0].message.content to be non-empty text");
  }
  return content;
}

function extractContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
  if (typeof first?.message?.content === "string" && first.message.content.trim()) return first.message.content.trim();
  if (typeof first?.text === "string" && first.text.trim()) return first.text.trim();
  return null;
}

function splitUnits(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 4) return paragraphs;
  const sentences = text.match(/[^.!?]+[.!?]+["'”’)]?\s*|[^.!?]+$/g);
  const units = (sentences ?? [text]).map((s) => s.trim()).filter(Boolean);
  return units.length > 0 ? units : [text];
}

/**
 * Build a mixed-authorship variant by proportionally interleaving units
 * (paragraphs, or sentences for short-paragraph texts) from the human and
 * AI texts. The stored ai_pct is exactly the requested percentage; the
 * realised share follows it as closely as unit granularity allows.
 */
export function buildMixed(humanText: string, aiText: string, aiPct: number): string {
  const humanUnits = splitUnits(humanText);
  const aiUnits = splitUnits(aiText);
  const total = Math.max(humanUnits.length, Math.min(aiUnits.length + humanUnits.length, humanUnits.length));
  const aiCount = Math.round((total * aiPct) / 100);
  const out: string[] = [];
  let aiUsed = 0;
  let humanUsed = 0;
  for (let i = 0; i < total; i++) {
    const useAi = Math.floor(((i + 1) * aiCount) / total) > Math.floor((i * aiCount) / total) && aiUsed < aiUnits.length;
    if (useAi) {
      const idx = Math.min(aiUnits.length - 1, Math.floor((aiUsed * aiUnits.length) / Math.max(aiCount, 1)));
      out.push(aiUnits[idx]!);
      aiUsed++;
    } else {
      const humanTotal = total - aiCount;
      const idx = humanTotal > 0
        ? Math.min(humanUnits.length - 1, Math.floor((humanUsed * humanUnits.length) / humanTotal))
        : humanUsed % humanUnits.length;
      out.push(humanUnits[idx]!);
      humanUsed++;
    }
  }
  return out.join("\n\n");
}
