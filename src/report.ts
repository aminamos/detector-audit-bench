import type { DocumentRow, ScoreRow } from "./types";

export interface SliceStat {
  key: string;
  total: number;
  scored: number;
  human: number;
  ai: number;
  false_positives: number;
  false_positives_per_1000_humans: number | null;
  by_prediction: Record<string, number>;
}

function isPredictedAi(score: ScoreRow): boolean {
  if (score.fraction_ai !== null) return score.fraction_ai >= 0.5;
  return (score.prediction ?? "").trim().toLowerCase() === "ai";
}

function lengthBucket(wordCount: number): string {
  if (wordCount < 300) return "0-299";
  if (wordCount < 800) return "300-799";
  if (wordCount < 1500) return "800-1499";
  return "1500+";
}

function sliceStats(docs: DocumentRow[], latest: Map<string, ScoreRow>, keyOf: (d: DocumentRow) => string): SliceStat[] {
  const groups = new Map<string, DocumentRow[]>();
  for (const doc of docs) {
    const key = keyOf(doc);
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const scoredDocs = group.filter((d) => latest.has(d.id));
      const humans = scoredDocs.filter((d) => d.label === "human");
      const fps = humans.filter((d) => isPredictedAi(latest.get(d.id)!)).length;
      const byPrediction: Record<string, number> = {};
      for (const d of scoredDocs) {
        const p = latest.get(d.id)!.prediction ?? "unknown";
        byPrediction[p] = (byPrediction[p] ?? 0) + 1;
      }
      return {
        key,
        total: group.length,
        scored: scoredDocs.length,
        human: humans.length,
        ai: scoredDocs.filter((d) => d.label === "ai").length,
        false_positives: fps,
        false_positives_per_1000_humans: humans.length ? (fps / humans.length) * 1000 : null,
        by_prediction: byPrediction,
      };
    });
}

/** Latest score per document (scores are passed newest-first). */
export function latestScores(scores: ScoreRow[]): Map<string, ScoreRow> {
  const latest = new Map<string, ScoreRow>();
  for (const score of scores) {
    if (!latest.has(score.document_id)) latest.set(score.document_id, score);
  }
  return latest;
}

export function buildReport(runId: string, docs: DocumentRow[], scoresNewestFirst: ScoreRow[]) {
  const latest = latestScores(scoresNewestFirst);
  const scoredDocs = docs.filter((d) => latest.has(d.id));
  const humans = scoredDocs.filter((d) => d.label === "human");
  const aiDocs = scoredDocs.filter((d) => d.label === "ai");

  const byPrediction: Record<string, number> = {};
  for (const d of scoredDocs) {
    const p = latest.get(d.id)!.prediction ?? "unknown";
    byPrediction[p] = (byPrediction[p] ?? 0) + 1;
  }

  const falsePositives = humans.filter((d) => isPredictedAi(latest.get(d.id)!)).length;

  // Recall at 1% FPR from stored fraction_ai: threshold is the human score
  // with 1% of humans scoring above it; recall is the AI share at/above it.
  let recallAt1PctFpr: number | null = null;
  let threshold: number | null = null;
  const humanScores = humans
    .map((d) => latest.get(d.id)!.fraction_ai)
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a);
  const aiScores = aiDocs
    .map((d) => latest.get(d.id)!.fraction_ai)
    .filter((v): v is number => v !== null);
  if (aiDocs.length > 0 && aiScores.length > 0 && humanScores.length > 0) {
    const allowedAbove = Math.floor(0.01 * humanScores.length);
    threshold = humanScores[Math.min(allowedAbove, humanScores.length - 1)]!;
    recallAt1PctFpr = aiScores.filter((s) => s >= threshold!).length / aiScores.length;
  }

  return {
    run_id: runId,
    total_documents: docs.length,
    scored_documents: scoredDocs.length,
    by_prediction: byPrediction,
    false_positives: falsePositives,
    false_positives_per_1000_humans: humans.length ? (falsePositives / humans.length) * 1000 : null,
    recall_at_1pct_fpr: recallAt1PctFpr,
    threshold_at_1pct_fpr: threshold,
    slices: {
      era: sliceStats(docs, latest, (d) => d.era ?? "unknown"),
      source: sliceStats(docs, latest, (d) => d.source ?? "unknown"),
      slice: sliceStats(docs, latest, (d) => d.slice ?? "unknown"),
      length: sliceStats(docs, latest, (d) => lengthBucket(d.word_count)),
    },
  };
}
