# Demo script — Detector Audit Bench (3 minutes)

Target runtime **3:00**. Record screen + voiceover together; if recording VO separately, the on-screen actions below are timed to the lines. Bracketed values `[…]` come from the actual run on screen — read the real numbers, never scripted ones.

**Before recording:** app running (`npx wrangler dev` or deployed URL), secrets set (`META_MODEL_API_KEY`, `PANGRAM_API_KEY`), one empty run ready to create live, one human civic/legal document (≥ 50 words, public domain / lawfully usable) ready to paste, and the **fallback pre-scored run** (below) already stored and openable in a second tab.

---

### 0:00–0:30 — Problem and user

**On screen:** Title screen / README top, then the app's empty runs list.

**Voiceover:**
> "AI-text detectors help decide whether writing gets trusted, published, admitted, or acted on. But they're almost never audited on civic and legal writing — bills, public comments, historical public documents — where formal, formulaic prose is normal human writing. I'm [name], and this is Detector Audit Bench: a tool for legislative researchers, journalists, and oversight groups to measure how often a detector falsely accuses human civic text — and exactly where."

### 0:30–1:00 — Live ingest

**On screen:** Create a run (name it, e.g. `civic-text-audit`), open it, add a document: paste the human text, set `label = human`, fill `era` / `source` / `slice`. Show a second, too-short paste being rejected, if time permits. Show the document listed with its word count.

**Voiceover:**
> "I create a run and add a real human document — [source/era of the document on screen]. The bench records its era, source, and slice, counts the words, and refuses anything under fifty words, because detector scores on tiny snippets aren't decision-grade. Everything I conclude later is sliced by these fields."

### 1:00–1:40 — Meta generation of matched counterfactuals

**On screen:** Select the human document → **Generate**. Show the created documents appearing: the fully-AI matched version and the 10/30/50/70/90% mixed variants, each shown with its parent link / `ai_pct`. Briefly open one variant's text.

**Voiceover:**
> "Now the key step. Using a Meta model, the bench generates a matched version of this same document — fully AI — plus mixed-authorship versions at ten, thirty, fifty, seventy, and ninety percent AI. Same content, controlled authorship, each variant linked to its parent. That turns 'AI or not' into a dose–response test, and it means any difference we find is about authorship, not topic."

*(If generation is slow: cut away and return — do not fake the result. If it fails: switch to the fallback, next section's note.)*

### 1:40–2:10 — Scoring

**On screen:** Run **Score**. Show scoring progress/completion, then a document's stored result — prediction and AI/human fractions (the full JSON is stored per document).

**Voiceover:**
> "Next, every document in the run goes to a real detector — Pangram, model pangram-4, one document per item — and we store its full result JSON, not just a summary. No scores here are mocked or cached from another document; if the API key weren't configured, this button would return an explicit 503 instead of inventing numbers."

### 2:10–2:40 — Sliced findings (incl. the null result)

**On screen:** Open the run's **Report**. Highlight, in order: prediction counts → false positives per 1,000 humans → recall at 1% FPR → the era/source/length slice table. Point at the slice that differs most from the pooled rate (or at the uniformly low FP rate).

**Voiceover:**
> "Here's the payoff. Overall: [N] false positives per thousand human documents, and recall of [X] at a one-percent false-positive rate. But pooled numbers hide the story — sliced by [era/source/length], the false-positive rate is [real figure from the screen] in [slice], versus [real figure] elsewhere. That's a claim a researcher can publish and a vendor has to answer. And if every slice had come back near zero, that would matter too: a clean null result is decision-grade evidence the detector is safe on this kind of text. The bench reports either answer honestly — including showing recall as 'not available' rather than zero when a run has no AI documents."

### 2:40–3:00 — Open source + close

**On screen:** The public GitHub repo (README, "built during the hackathon vs. prior inputs" section), then back to the report for the final frame.

**Voiceover:**
> "Detector Audit Bench is open source — the Worker, the D1 schema, and the reporting are all in this repo, with an honest line between what we built during the hackathon and the public texts we fed in as inputs. Bring your own corpus, swap the generator model, and re-run the audit as detectors change. Don't trust a detector's average. Slice it. Thank you."

---

## Fallback if a live API fails

Trigger: generation or scoring errors, times out, or returns `503` on camera.

1. **Do not retry more than once, and do not narrate invented results.** Say (or cut to): *"Live generation depends on the model API, so let me show you a run that was generated and scored earlier — it's stored in the same database, with the full detector JSON per document."*
2. Switch to the **pre-scored run tab**: a run ingested, generated, and scored before recording, with its report open.
3. Continue from the segment you were in (1:40 scoring — show the stored per-document result JSON as proof of provenance — or straight to 2:10 findings). The findings segment reads entirely from stored data, so the rest of the script is unchanged.
4. The pre-scored run must be real: actually generated/scored with the configured keys earlier, never hand-entered. Verify it loads before recording day.

## Recording checklist

- [ ] Fallback pre-scored run exists, is genuinely API-produced, and its report loads.
- [ ] The human document used live is ≥ 50 words and lawfully usable on camera; era/source/slice values decided in advance.
- [ ] Secrets are set but never shown: no terminal `secret put`, `.env`, or dashboard views on screen.
- [ ] All numbers read aloud are the numbers on screen at that moment.
- [ ] Only hackathon-built features are demoed; corpora/datasets are described as inputs.
- [ ] Total runtime checked at ≈3:00 before upload.
