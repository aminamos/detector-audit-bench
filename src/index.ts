import { errorJson, isRecord, json, readJson, wordCount } from "./http";
import { buildMixed, generateMatchedAi } from "./meta";
import { scoreWithPangram } from "./pangram";
import { buildReport } from "./report";
import type { AppEnv, DocumentRow, RunRow, ScoreOut, ScoreRow } from "./types";

const LABELS = new Set(["human", "ai", "mixed"]);
const DEFAULT_AI_PCTS = [10, 30, 50, 70, 90];

function parseFullJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function scoreOut(row: ScoreRow): ScoreOut {
  return { ...row, full_json: parseFullJson(row.full_json) };
}

async function getRun(env: AppEnv, id: string): Promise<RunRow | null> {
  return env.DB.prepare("SELECT * FROM runs WHERE id = ?").bind(id).first<RunRow>();
}

async function getDocuments(env: AppEnv, runId: string): Promise<DocumentRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM documents WHERE run_id = ? ORDER BY created_at ASC, id ASC")
    .bind(runId)
    .all<DocumentRow>();
  return results;
}

async function getScores(env: AppEnv, runId: string): Promise<ScoreRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM scores WHERE run_id = ? ORDER BY scored_at DESC, id DESC")
    .bind(runId)
    .all<ScoreRow>();
  return results;
}

async function insertDocument(env: AppEnv, doc: Omit<DocumentRow, "id" | "created_at" | "word_count"> & { text: string }): Promise<DocumentRow> {
  const row: DocumentRow = {
    ...doc,
    id: crypto.randomUUID(),
    word_count: wordCount(doc.text),
    created_at: new Date().toISOString(),
  };
  await env.DB.prepare(
    "INSERT INTO documents (id, run_id, external_id, parent_id, title, text, era, source, slice, label, ai_pct, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.run_id, row.external_id, row.parent_id, row.title, row.text, row.era, row.source, row.slice, row.label, row.ai_pct, row.word_count, row.created_at)
    .run();
  return row;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function createRun(env: AppEnv, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.name !== "string" || !body.name.trim()) {
    return errorJson(400, "name is required and must be a non-empty string");
  }
  const run: RunRow = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    status: "created",
    created_at: new Date().toISOString(),
  };
  await env.DB.prepare("INSERT INTO runs (id, name, status, created_at) VALUES (?, ?, ?, ?)")
    .bind(run.id, run.name, run.status, run.created_at)
    .run();
  return json(run, 201);
}

async function addDocuments(env: AppEnv, request: Request, runId: string): Promise<Response> {
  const run = await getRun(env, runId);
  if (!run) return errorJson(404, "Run not found");
  const body = await readJson(request);
  if (!isRecord(body) || !Array.isArray(body.documents) || body.documents.length === 0) {
    return errorJson(400, "documents is required and must be a non-empty array");
  }
  if (body.documents.length > 500) return errorJson(400, "documents must contain at most 500 items");

  const existing = new Set(
    (await getDocuments(env, runId)).map((d) => d.external_id).filter((v): v is string => v !== null),
  );
  const seenInBatch = new Set<string>();
  const inserted: DocumentRow[] = [];
  const errors: { index: number; external_id: string | null; error: string }[] = [];

  for (let index = 0; index < body.documents.length; index++) {
    const raw = body.documents[index];
    const fail = (externalId: string | null, error: string) => errors.push({ index, external_id: externalId, error });
    if (!isRecord(raw)) {
      fail(null, "document must be an object");
      continue;
    }
    const externalId = optionalString(raw.external_id);
    if (typeof raw.title !== "string" || !raw.title.trim()) { fail(externalId, "title is required"); continue; }
    if (typeof raw.text !== "string" || !raw.text.trim()) { fail(externalId, "text is required"); continue; }
    if (typeof raw.label !== "string" || !LABELS.has(raw.label)) { fail(externalId, "label must be one of human|ai|mixed"); continue; }
    if (raw.ai_pct !== undefined && raw.ai_pct !== null && (typeof raw.ai_pct !== "number" || !Number.isFinite(raw.ai_pct) || raw.ai_pct < 0 || raw.ai_pct > 100)) {
      fail(externalId, "ai_pct must be a number between 0 and 100");
      continue;
    }
    const count = wordCount(raw.text);
    if (count < 50) { fail(externalId, `text must contain at least 50 words (got ${count})`); continue; }
    if (externalId && (existing.has(externalId) || seenInBatch.has(externalId))) {
      fail(externalId, "duplicate external_id in run");
      continue;
    }
    if (externalId) seenInBatch.add(externalId);
    inserted.push(await insertDocument(env, {
      run_id: runId,
      external_id: externalId,
      parent_id: null,
      title: raw.title.trim(),
      text: raw.text,
      era: optionalString(raw.era),
      source: optionalString(raw.source),
      slice: optionalString(raw.slice),
      label: raw.label as DocumentRow["label"],
      ai_pct: typeof raw.ai_pct === "number" ? raw.ai_pct : null,
    }));
  }

  if (inserted.length === 0) return errorJson(400, "No valid documents", { errors });
  return json({ documents: inserted, errors }, 201);
}

async function generate(env: AppEnv, request: Request, runId: string): Promise<Response> {
  const run = await getRun(env, runId);
  if (!run) return errorJson(404, "Run not found");
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.document_id !== "string" || !body.document_id) {
    return errorJson(400, "document_id is required");
  }
  let pcts = DEFAULT_AI_PCTS;
  if (body.ai_pct_options !== undefined) {
    if (!Array.isArray(body.ai_pct_options) || body.ai_pct_options.length === 0 ||
      body.ai_pct_options.some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 99)) {
      return errorJson(400, "ai_pct_options must be a non-empty array of integers between 1 and 99");
    }
    pcts = [...new Set(body.ai_pct_options as number[])].sort((a, b) => a - b);
  }
  const source = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND run_id = ?")
    .bind(body.document_id, runId)
    .first<DocumentRow>();
  if (!source) return errorJson(404, "Document not found in run");
  if (!env.META_MODEL_API_KEY) return errorJson(503, "META_MODEL_API_KEY not configured");

  let aiText: string;
  try {
    aiText = await generateMatchedAi(env, source.title, source.text, source.word_count);
  } catch (err) {
    return errorJson(502, err instanceof Error ? err.message : "Meta Model API request failed");
  }

  const aiDoc = await insertDocument(env, {
    run_id: runId, external_id: null, parent_id: source.id,
    title: `${source.title} (AI matched)`, text: aiText,
    era: source.era, source: source.source, slice: source.slice, label: "ai", ai_pct: 100,
  });
  const documents: DocumentRow[] = [aiDoc];
  for (const pct of pcts) {
    documents.push(await insertDocument(env, {
      run_id: runId, external_id: null, parent_id: source.id,
      title: `${source.title} (mixed ${pct}% AI)`, text: buildMixed(source.text, aiText, pct),
      era: source.era, source: source.source, slice: source.slice, label: "mixed", ai_pct: pct,
    }));
  }
  return json({ documents, ai_document: aiDoc }, 201);
}

async function score(env: AppEnv, request: Request, runId: string): Promise<Response> {
  const run = await getRun(env, runId);
  if (!run) return errorJson(404, "Run not found");
  if (!env.PANGRAM_API_KEY) return errorJson(503, "PANGRAM_API_KEY not configured");

  // Optional {document_ids:[...]} narrows scoring; absent body scores all.
  let docs = await getDocuments(env, runId);
  const rawBody = await request.text();
  if (rawBody.trim()) {
    let body: unknown;
    try { body = JSON.parse(rawBody) as unknown; } catch { return errorJson(400, "Request body must be valid JSON"); }
    if (isRecord(body) && body.document_ids !== undefined) {
      if (!Array.isArray(body.document_ids) || body.document_ids.some((v) => typeof v !== "string")) {
        return errorJson(400, "document_ids must be an array of strings");
      }
      const wanted = new Set(body.document_ids as string[]);
      docs = docs.filter((d) => wanted.has(d.id));
    }
  }
  if (docs.length === 0) return errorJson(400, "Run has no documents to score");

  let results: Map<string, { prediction: string | null; fraction_ai: number | null; fraction_ai_assisted: number | null; fraction_human: number | null; full: Record<string, unknown> }>;
  try {
    results = await scoreWithPangram(env, docs);
  } catch (err) {
    return errorJson(502, err instanceof Error ? err.message : "Pangram API request failed");
  }

  const scoredAt = new Date().toISOString();
  const scores: ScoreOut[] = [];
  for (const doc of docs) {
    const result = results.get(doc.id);
    if (!result) continue;
    const row: ScoreRow = {
      id: crypto.randomUUID(), run_id: runId, document_id: doc.id,
      detector: "pangram", model: "pangram-4", prediction: result.prediction,
      fraction_ai: result.fraction_ai, fraction_ai_assisted: result.fraction_ai_assisted,
      fraction_human: result.fraction_human, full_json: JSON.stringify(result.full), scored_at: scoredAt,
    };
    await env.DB.prepare(
      "INSERT INTO scores (id, run_id, document_id, detector, model, prediction, fraction_ai, fraction_ai_assisted, fraction_human, full_json, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(row.id, row.run_id, row.document_id, row.detector, row.model, row.prediction, row.fraction_ai, row.fraction_ai_assisted, row.fraction_human, row.full_json, row.scored_at).run();
    scores.push(scoreOut(row));
  }
  if (scores.length === 0) return errorJson(502, "Pangram API returned no results for submitted documents");
  await env.DB.prepare("UPDATE runs SET status = ? WHERE id = ?").bind("scored", runId).run();
  return json({ scores, results: scores, scored: scores.length, failed: docs.length - scores.length }, 201);
}

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (!path.startsWith("/api/")) {
        return env.ASSETS ? env.ASSETS.fetch(request) : errorJson(404, "Not found");
      }
      if (path === "/api/health") {
        if (request.method !== "GET") return errorJson(405, "Method not allowed");
        return json({ ok: true });
      }
      if (path === "/api/runs") {
        if (request.method === "GET") {
          const { results } = await env.DB.prepare("SELECT * FROM runs ORDER BY created_at DESC").all<RunRow>();
          return json({ runs: results });
        }
        if (request.method === "POST") return createRun(env, request);
        return errorJson(405, "Method not allowed");
      }
      const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch) {
        if (request.method !== "GET") return errorJson(405, "Method not allowed");
        const run = await getRun(env, runMatch[1]!);
        if (!run) return errorJson(404, "Run not found");
        const [documents, scores] = await Promise.all([getDocuments(env, run.id), getScores(env, run.id)]);
        return json({ run, documents, results: scores.map(scoreOut) });
      }
      const subMatch = path.match(/^\/api\/runs\/([^/]+)\/(documents|generate|score|report)$/);
      if (subMatch) {
        const runId = subMatch[1]!;
        const action = subMatch[2]!;
        if (action === "documents" && request.method === "POST") return addDocuments(env, request, runId);
        if (action === "generate" && request.method === "POST") return generate(env, request, runId);
        if (action === "score" && request.method === "POST") return score(env, request, runId);
        if (action === "report" && request.method === "GET") {
          const run = await getRun(env, runId);
          if (!run) return errorJson(404, "Run not found");
          const [documents, scores] = await Promise.all([getDocuments(env, runId), getScores(env, runId)]);
          return json(buildReport(runId, documents, scores));
        }
        return errorJson(405, "Method not allowed");
      }
      return errorJson(404, "Not found");
    } catch (err) {
      return errorJson(500, err instanceof Error ? err.message : "Internal error");
    }
  },
};
