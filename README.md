# Detector Audit Bench

> Audit AI-text detectors on real civic and legal writing — and show exactly where they falsely accuse humans.

**Status key used throughout this repo:** ✅ built during the hackathon · 🔧 configurable / wired but requires API keys to exercise live · 📋 planned, not claimed as built

---

## The problem

AI-text detectors are used to make consequential decisions — about students, job applicants, journalists, and public commenters — but they are rarely audited on the writing that actually appears in civic life: legislation, court-adjacent filings, public comments, agency guidance, and historical public-domain texts.

When a detector flags a human-written bill summary, hearing statement, or 19th-century public document as "AI-generated," that is not a rounding error. It is a false accusation with reputational and procedural consequences. Yet most detector marketing reports a single accuracy number, with no breakdown by era, source, length, or degree of human–AI collaboration.

Detector Audit Bench exists to produce that breakdown, reproducibly, on matched texts.

## Who it is for, and the job it does

| Clear user | Their job |
|---|---|
| **Legislative researchers and oversight staff** | Check whether a detector used in a policy, procurement, or evidence context falsely flags genuine legislative/legal text, and cite sliced false-positive rates instead of vendor averages. |
| **Journalists covering AI and accountability** | Test a detector claim on real public text before reporting it; publish the era/source/length slice where it breaks. |
| **Civil-society and academic oversight groups** | Build a reusable, matched audit set — same content, human vs. AI vs. mixed authorship — and re-run it as detectors change. |

**Job to be done:** *Give me a defensible answer to "how often does this detector falsely accuse human civic/legal writing, and where?" — not a vibe, a rate with slices.*

## Impact

- A detector that is 99% "accurate" overall can still falsely flag, for example, formulaic or older-register human prose at a far higher rate. Those are precisely the registers common in statutes, resolutions, and archival public documents.
- Matched counterfactuals separate two questions that are usually conflated: (1) does the detector mistake *human civic style* for AI, and (2) how much AI text must actually be present before detection is reliable? Mixed-authorship documents (10–90% AI) make the second question answerable.
- A null result is also a result: if a detector shows near-zero false positives across every slice on an adequately sized human set, that is publishable, decision-grade evidence in its favour. The bench reports `recall_at_1pct_fpr` and false positives per 1,000 human documents so both bad and good news are legible.

## How it works

```
1. INGEST            2. COUNTERFACTUALS          3. SCORE               4. REPORT
─────────────        ───────────────────         ─────────────          ───────────────
Human / AI /    ──▶  Meta model rewrites    ──▶  Detector scores   ──▶  Aggregates sliced
labelled docs        a human doc as fully        every doc in a         by era, source,
(≥ 50 words          AI + mixed versions         run (one doc =          slice, and length
each)                at 10/30/50/70/90% AI       one item)              bucket, with FP/1000
                     (parent-linked)                                    and recall @ 1% FPR
```

1. **Ingest** — Create a run, add documents with `label` (`human` | `ai` | `mixed`), plus optional `era`, `source`, and `slice` metadata. The server computes `word_count` and rejects any document under 50 words with a per-document error list (detector scores on very short text are not decision-grade, so the bench refuses them up front).
2. **Generate matched counterfactuals** 🔧 — For a chosen human document, a Meta model generates a fully-AI matched version and mixed-authorship variants at 10/30/50/70/90% AI (or a requested set). Variants are stored as new documents with `parent_id`, `label`, and `ai_pct`, so every comparison is traceable to its source document. Requires `META_MODEL_API_KEY`; without it the endpoint returns `503` and generates nothing — it never fabricates text.
3. **Score** 🔧 — Every unscored document in the run is submitted to the detector (Pangram Bulk API, model `pangram-4`, one document = one item), polled to completion, and the full result JSON is stored per document in the `scores` table. Requires `PANGRAM_API_KEY`; without it the endpoint returns `503`. No score is ever invented, cached from another document, or mocked.
4. **Report** — Aggregates predictions, false positives per 1,000 human documents, and recall at 1% false-positive rate (`null` when a run has no AI documents — reported honestly rather than as 0), sliced by `era`, `source`, `slice`, and length bucket.

## Meta tooling

| Tool | How it is used | Status |
|---|---|---|
| **Meta Model API** (Muse family, via `META_MODEL_API_KEY` / optional `META_MODEL_API_BASE` / `META_MODEL_ID`) | Generates the matched fully-AI document and the 10/30/50/70/90% mixed-authorship counterfactuals from a human source document. This is the core of the audit: without matched generation there are only unrelated human and AI piles, and no controlled comparison. | 🔧 Wired in the generation endpoint; requires a key to run live |
| **Muse Code** | Used to build this project during the hackathon. | ✅ Used during the event |
| **Muse Spark Open / other open-weights Meta models** | Intended as a swappable `META_MODEL_ID` so the counterfactual generator itself can be an open-weights model; the bench is generator-agnostic by design (it audits the *detector*, not the generator). | 📋 Planned/configurable — **not claimed** unless an open-weights model ID is actually configured and run; see `docs/JUDGING.md` |

No detector score, generated document, or report figure in this project is mocked or hard-coded. Missing keys produce explicit `503` errors, not plausible-looking fallbacks.

## Quickstart

Prerequisites: Node.js, [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler` or use the project-local dev dependency once installed), a Cloudflare account for deployment (local dev works without deploying).

```bash
# 1. Install
npm install

# 2. Create the local D1 database and apply migrations
npx wrangler d1 create detector-audit-bench   # first time only; copy the database_id into wrangler.jsonc for remote use
npx wrangler d1 migrations apply DB --local   # local database used by `wrangler dev`

# 3. (Optional, enables live generation/scoring) set secrets — names only, never commit values
npx wrangler secret put META_MODEL_API_KEY
npx wrangler secret put PANGRAM_API_KEY
# Optional overrides, also via secret/var as appropriate:
#   META_MODEL_API_BASE   META_MODEL_ID

# 4. Run locally (Worker + static assets from public/)
npx wrangler dev
```

Then open the local URL Wrangler prints, create a run, and add documents (≥ 50 words each). Without secrets the bench still ingests, stores, and reports on documents you supply and score elsewhere; the Generate and Score actions return a clear `503 … not configured` error instead of pretending to work.

For a deployed instance, set the same secrets with `wrangler secret put` (no `--local`) and apply migrations with `--remote`.

## API summary

Base: same origin as the Worker. All errors are structured JSON (`{ "error": "…" }`, with per-document error lists where applicable). IDs are `crypto.randomUUID()` values.

| Method & path | Body / behaviour | Success |
|---|---|---|
| `GET /api/health` | — | `200 { ok: true }` |
| `POST /api/runs` | `{ name }` | `201` run `{ id, name, created_at, status }` |
| `GET /api/runs` | — | `200 { runs: [...] }` |
| `GET /api/runs/:id` | — | `200 { run, documents: [...], results: [...] }` |
| `POST /api/runs/:id/documents` | `{ documents: [{ external_id?, title, text, era?, source?, slice?, label }] }`, `label ∈ human\|ai\|mixed`; server computes `word_count`; documents < 50 words are rejected with a per-doc error list | `201` with stored documents |
| `POST /api/runs/:id/generate` | `{ document_id, ai_pct_options? }` — Meta-model matched AI doc + mixed variants (default 10/30/50/70/90), stored with `parent_id`, `label`, `ai_pct` | `201` created documents · `503` if `META_MODEL_API_KEY` is not configured |
| `POST /api/runs/:id/score` | Submits the run's documents to Pangram Bulk (`pangram-4`, one doc = one item), polls, stores full result JSON per document | `200` scored results · `503` if `PANGRAM_API_KEY` is not configured |
| `GET /api/runs/:id/report` | Aggregates: prediction counts, `false_positives_per_1000_humans`, `recall_at_1pct_fpr` (`null` if no AI docs), slices by era / source / slice / length bucket | `200` report object |

### Data model (D1)

- `runs(id TEXT PK, name TEXT, status TEXT, created_at TEXT)`
- `documents(id TEXT PK, run_id TEXT, external_id TEXT, parent_id TEXT, title TEXT, text TEXT, era TEXT, source TEXT, slice TEXT, label TEXT, ai_pct REAL, word_count INTEGER, created_at TEXT)`
- `scores(id TEXT PK, run_id TEXT, document_id TEXT, detector TEXT, model TEXT, prediction TEXT, fraction_ai REAL, fraction_ai_assisted REAL, fraction_human REAL, full_json TEXT, scored_at TEXT)`

## Repo layout

```
.
├── README.md            # this file
├── SUBMISSION.md        # hackathon submission-form draft + checklist
├── DEMO_SCRIPT.md       # 3-minute demo video script
├── docs/
│   └── JUDGING.md       # criterion-by-criterion judging map
├── public/              # static frontend (served as Worker assets)
├── src/                 # Cloudflare Worker (TypeScript) — API above
├── scripts/             # corpus / data-prep helpers
├── wrangler.jsonc       # Worker config: D1 binding DB, static assets, observability
└── package.json
```

## Built during the hackathon vs. prior inputs

Honest accounting, per the event rule that only work built during the event is demoed:

**Built during the hackathon ✅**

- The Detector Audit Bench itself: Worker API (`/api/runs`, documents, generate, score, report), D1 schema, sliced reporting (FP/1000 humans, recall @ 1% FPR, era/source/slice/length slices), and the static frontend.
- The matched-counterfactual design: parent-linked AI and 10–90% mixed variants generated on demand from an ingested human document.
- This documentation, submission draft, and demo script.

**Prior inputs (inputs only, not claimed as built here) 📋**

- Source civic/legal texts used as audit inputs (e.g. public-domain legislative, governmental, and historical documents, and any pre-existing corpora/datasets the team brought in). These are *data fed into* the bench, in the public domain or otherwise lawfully usable; creating/collecting them is not claimed as hackathon work, and no copyrighted text is redistributed by this repo beyond what the user supplies.
- Third-party services: the Meta Model API (generation) and the Pangram detector API (scoring) are external tools the bench calls; neither is built here.

**Not claimed**

- No detector scores are pre-baked, mocked, or guaranteed. Any figure shown in a demo comes from a live (or previously live-scored and stored) run against the real APIs, or is explicitly labelled as awaiting keys.
- Open-weights generation (Muse Spark Open) is 📋 planned/configurable via `META_MODEL_ID`, not claimed as integrated unless actually configured and run before submission — see `docs/JUDGING.md`.

## License / use note

Built for the Meta Global AI Developer Hackathon (indie track). Intended for research, journalism, and oversight use. Detector outputs are probabilistic signals, not verdicts about any individual author — which is, in a sense, the point of the bench.
