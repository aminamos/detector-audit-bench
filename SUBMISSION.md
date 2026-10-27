# Submission draft — Meta Global AI Developer Hackathon

Form-ready copy. Paste into the submission form, then work the checklist. Bracketed items `[…]` must be filled in / verified before submitting — do not submit with brackets remaining.

Deadline context: hackathon submission is due **Nov 4, 9:00 pm ET**. Internal deadline: **submit by the evening of Nov 3** (see checklist). No last-hour submission.

---

## Form fields

**Project title**
Detector Audit Bench

**Tagline** (one line)
Audit AI-text detectors on real civic and legal writing — matched Meta-generated counterfactuals, false positives sliced by era, source, and length.

**Track**
Indie

**Themes / categories** `[verify exact theme names against the live form and select all that genuinely apply]`
- AI for accountability / civic technology `[verify wording]`
- Research & evaluation tooling `[verify wording]`
- Bonus under consideration: Best Agentic Use Case (human-in-the-loop audit pipeline) · Best Open Weights — **only if** an open-weights model (e.g. Muse Spark Open) is actually configured via `META_MODEL_ID` and used for a submitted run before submission; otherwise omit. See `docs/JUDGING.md`.

**Short description** (form short field)
Detector Audit Bench lets legislative researchers, journalists, and oversight groups measure how often an AI-text detector falsely flags genuine human civic/legal writing. Ingest labelled documents, generate matched AI and 10–90% mixed-authorship versions of the same document with Meta models, score everything with a real detector, and get false positives per 1,000 humans sliced by era, source, and length — including honest null results.

**Long description**
AI-text detectors influence real decisions about students, applicants, journalists, and public commenters, yet they are almost never audited on civic and legal prose — statutes, resolutions, public comments, agency text, and historical public documents — where formulaic and older registers are normal human writing. A single pooled "accuracy" number hides exactly the failures that matter.

Detector Audit Bench makes the audit concrete and reproducible. A researcher creates a run and ingests labelled documents (human / AI / mixed, minimum 50 words, with era, source, and slice metadata). For any human document, a Meta model generates a matched fully-AI version plus mixed-authorship variants at 10/30/50/70/90% AI, each stored with a link to its parent document. The run is then scored by a real detector API (Pangram Bulk, `pangram-4`, one document per item) with the full result JSON stored per document. The report aggregates prediction counts, false positives per 1,000 human documents, and recall at 1% false-positive rate, sliced by era, source, slice, and length bucket.

The tool is deliberately honest: missing API keys return a clear 503 rather than fabricated text or scores, recall is reported as null (not 0) when a run has no AI documents, and a detector that performs well across every slice produces a publishable null result. Built on Cloudflare Workers + D1 with a TypeScript API; generation is swappable via model configuration.

Only the bench was built during the hackathon; source texts are prior, lawfully usable inputs, and are identified as such in the README.

**Tech list**
TypeScript · Cloudflare Workers · Cloudflare D1 · Wrangler · Meta Model API (Muse family, generation of matched AI/mixed counterfactuals) · Muse Code (development) · Pangram Bulk API (`pangram-4`, detector under audit) · HTML/CSS/JS static frontend (Worker assets)

**Public repo URL**
`[PLACEHOLDER — insert public repository URL after the visibility check in the checklist below]`

**Demo video URL**
`[PLACEHOLDER — insert video URL after recording per DEMO_SCRIPT.md]`

**Live demo URL** (if the form offers one)
`[PLACEHOLDER — insert deployed Worker URL, or "local: npx wrangler dev" if not deployed; never include secrets or secret-bearing URLs]`

**Team**
`[Names / handles of team members — indie track]`

---

## Pre-submission checklist

### Timing (non-negotiable)
- [ ] **Review the actual submission form early** — open it well before Nov 3, confirm required fields, theme names, video specs, and repo requirements against this draft; fix discrepancies here first.
- [ ] **Internal deadline: submit by the evening of Nov 3** (ET), a full day ahead of the Nov 4, 9:00 pm ET deadline.
- [ ] **No last-hour submission.** If it is Nov 4 and the form is not yet submitted, treat that as an incident: submit the best complete version immediately rather than polishing further.

### Repo & openness
- [ ] Repository is **public** (or the visibility the form requires) and the URL above points to it.
- [ ] Public-repo check: clone/browse the public repo as an outsider — README renders, quickstart is followable, no dead placeholder links remain.
- [ ] **No secrets anywhere in the repo or history**: only env/secret *names* (`META_MODEL_API_KEY`, `PANGRAM_API_KEY`, `META_MODEL_API_BASE`, `META_MODEL_ID`). Search the full history, not just HEAD. If a secret was ever committed, rotate it — deleting the commit is not sufficient.
- [ ] No copyrighted text committed (in particular no lyric text); prior datasets/corpora are inputs only, lawfully usable, and described as such in the README.
- [ ] README's "built during the hackathon vs. prior inputs" section is accurate against what was actually built.

### Product truthfulness
- [ ] Every feature described above is either ✅ built, or marked 🔧 (needs keys) / 📋 (planned) in README/`docs/JUDGING.md`. In particular, **Best Open Weights / Muse Spark Open is claimed only if actually configured and run** via `META_MODEL_ID` before submission.
- [ ] No mock/fake detector scores or generated documents anywhere in the demo path; a keyless run shows the explicit `503 … not configured` behaviour.
- [ ] At least one real scored run exists (live or previously scored and stored) whose report can be shown in the video and, if applicable, the live demo.

### Video
- [ ] Recorded per `DEMO_SCRIPT.md` (≈3 minutes, timestamps followed), including the sliced-findings segment and the null-result framing.
- [ ] Fallback verified: a pre-scored run's report view is loadable on camera if live generation/scoring fails during recording.
- [ ] Video uploaded, playable at the URL above (test in a private/incognito window), and shows only features built during the hackathon.

### Final pass
- [ ] All `[bracketed placeholders]` in this file replaced or deliberately resolved.
- [ ] Form fields pasted from this file (not retyped), title/tagline/track/themes/tech list consistent with the repo README.
- [ ] Submit (by Nov 3 evening), then screenshot/save the confirmation.
