# Judging map — Detector Audit Bench

How this project maps to the Meta Global AI Developer Hackathon rubric. **Impact is weighted first**, so it is addressed first and most concretely.

Status key: ✅ built during the hackathon · 🔧 wired, requires API keys to exercise live · 📋 planned/configurable, **not claimed as done**

---

## 1. Impact (primary)

**The claim:** AI-text detectors make consequential false accusations, and almost nobody can currently measure *where*, because published accuracy is a single pooled number. Detector Audit Bench turns "this detector feels unfair" into a sliced, reproducible false-positive rate on real civic/legal text.

| Rubric question | Our answer |
|---|---|
| Who is affected? | People whose genuine writing is flagged as AI: constituents, students, applicants, journalists, public commenters — and the institutions that act on detector output. |
| Who is the clear user? | Legislative researchers, journalists, and oversight/academic groups (see README). Not "everyone": people who must *defend a number in public*. |
| What changes if this works? | A researcher can say "Detector X falsely flags Y per 1,000 human legislative documents, concentrated in pre-1950 and short-document slices" — a statement that can drive procurement, policy, and reporting decisions. |
| Why is the matched design the impact multiplier? | Pooled human-vs-AI piles confound content with authorship. Parent-linked counterfactuals (same source document → fully AI, and 10/30/50/70/90% mixed) isolate authorship as the variable, so a slice difference is attributable, not anecdotal. |
| What if the detector is actually good? | That is a valuable, publishable null result, and the bench surfaces it honestly: low `false_positives_per_1000_humans` across all slices is decision-grade evidence *for* the detector. The tool audits; it does not presuppose guilt. |

**Evidence to show judges:** one completed run's report view — prediction counts, FP/1000 humans, recall @ 1% FPR, and at least one era/source/length slice that differs from the pooled rate (or, if none does, the uniformly-low FP rate stated as the finding).

## 2. Meta tooling

| Tool | Role in the product | Status |
|---|---|---|
| Meta Model API (Muse family; `META_MODEL_API_KEY`, optional `META_MODEL_API_BASE` / `META_MODEL_ID`) | Generates the matched fully-AI document and mixed-authorship counterfactuals from an ingested human document. This is not decoration: the audit design is impossible without controlled generation, and Meta models are the generator under configuration. | 🔧 Endpoint built; live use needs a key. Missing key → explicit `503`, never fabricated text. |
| Muse Code | Development tool used to build the bench during the event. | ✅ Used |
| Cloudflare Workers + D1 (platform, not Meta) | Hosting/data layer; listed for completeness, no Meta credit claimed for it. | ✅ Used |
| Pangram detector API (third-party, not Meta) | The detector being audited in the default configuration. Named openly: auditing a named detector on the record is the point. No affiliation claimed. | 🔧 Endpoint built; live use needs `PANGRAM_API_KEY` |

**What we do not claim:** we do not claim Meta built, endorses, or supplies the detector; we do not claim any generated text or score exists for a run that was never actually generated/scored.

## 3. Technical depth

- **Matched counterfactual generation with provenance:** every generated document stores `parent_id`, `label`, and `ai_pct` (10/30/50/70/90 or requested), so any score can be traced to the exact human source and mixture level. Mixture sweeps turn "AI or not" into a dose–response curve per detector.
- **Sliced evaluation, not pooled accuracy:** report computes `false_positives_per_1000_humans`, `recall_at_1pct_fpr` (honestly `null` when a run has no AI documents rather than a fake 0), and breakdowns by `era`, `source`, `slice`, and length bucket — the dimensions along which detector bias against formulaic/older/short civic prose would actually appear.
- **Input discipline:** documents under 50 words are rejected at ingest with a per-document error list, because sub-50-word detector scores are not decision-grade; the bench refuses to produce numbers it would not defend.
- **Full-fidelity storage:** the detector's complete result JSON is stored per document (`scores.full_json`, plus parsed `fraction_ai` / `fraction_ai_assisted` / `fraction_human`), so reports are re-derivable and auditable after the fact — the audit tool is itself auditable.
- **Honest failure modes:** no mock scores, no fabricated generations, no fallback text. Missing `META_MODEL_API_KEY` or `PANGRAM_API_KEY` → structured `503`. No global request state, no floating promises, structured JSON errors, `crypto.randomUUID` IDs, TypeScript Worker with D1 (`DB` binding) and static assets.

## 4. Demo

- 3-minute script in [`../DEMO_SCRIPT.md`](../DEMO_SCRIPT.md): problem → live ingest → Meta generation → scoring → sliced findings (including the value of a null result) → open-source close.
- **Fallback:** if a live API call fails on camera, the demo switches to a previously scored run already stored in D1 and narrates from its report — the findings segment never depends on a live network call succeeding in the room.
- Only features built during the hackathon are demoed; datasets/corpora are shown as *inputs*, consistent with the README's built-vs-prior accounting.

## Bonus categories

| Bonus | Applicability | Honest status |
|---|---|---|
| **Best Agentic Use Case** | The bench is a human-directed audit tool: a researcher drives ingest → generate → score → report and interprets slices. It does not autonomously act on people, and we think that restraint is correct for an accountability tool. If the category rewards well-scoped tool use with a human decision-maker in the loop, we are a plausible fit; we are **not** repositioning the product as an autonomous agent to chase it. | ✅ Applicable as built (human-in-the-loop); no agent features claimed beyond the actual generate/score pipeline |
| **Best Open Weights** (e.g. Muse Spark Open) | The generator is swappable via `META_MODEL_ID`, so an open-weights Meta model can produce the counterfactuals without code changes. | 📋 **Planned/configurable only — not claimed.** This bonus should only be asserted if, before submission, an open-weights model ID is actually configured, a run is generated with it, and that run is what is demoed/submitted. Until then it appears in our materials only with this 📋 marker. |

## Risks / limitations stated up front

- One detector (Pangram, `pangram-4`) is wired for scoring; the schema (`scores.detector`, `scores.model`) anticipates more, but multi-detector comparison is 📋 not claimed as built.
- Live generation/scoring depend on third-party API availability and keys; the `503`-not-fabricated design means a keyless deployment demonstrates ingest + reporting on user-scored data only.
- Detector `prediction` semantics are the vendor's; the bench reports their outputs and derived rates, and stores full JSON so anyone can re-check our parsing.
