export type AppEnv = Env & {
  META_MODEL_API_KEY?: string;
  META_MODEL_API_BASE?: string;
  META_MODEL_ID?: string;
  PANGRAM_API_KEY?: string;
};

export interface RunRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  run_id: string;
  external_id: string | null;
  parent_id: string | null;
  title: string;
  text: string;
  era: string | null;
  source: string | null;
  slice: string | null;
  label: "human" | "ai" | "mixed";
  ai_pct: number | null;
  word_count: number;
  created_at: string;
}

export interface ScoreOut extends Omit<ScoreRow, "full_json"> {
  full_json: unknown;
}

export interface ScoreRow {
  id: string;
  run_id: string;
  document_id: string;
  detector: string;
  model: string | null;
  prediction: string | null;
  fraction_ai: number | null;
  fraction_ai_assisted: number | null;
  fraction_human: number | null;
  full_json: string;
  scored_at: string;
}
