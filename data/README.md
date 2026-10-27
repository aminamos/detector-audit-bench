# Data — provenance and import

All corpora here are **inputs** to the Detector Audit Bench. Nothing in this
directory is a detector result, and no Pangram (or any detector) scores are
stored here — scores are produced only by running `POST /api/runs/:id/score`
against a live run.

## Files

| File | Source | Label | Notes |
|---|---|---|---|
| `mn-laws-{year}.jsonl` | [Minnesota Revisor of Statutes](https://www.revisor.mn.gov/laws/), session-law chapters, harvested by `scripts/harvest_mn_laws.py` | `human` | Public legal text drafted by legislative staff. `source=mn-revisor-session-laws`, `slice=state-law`, `date_created=<year>`. |

The harvester regenerates or extends these files: it walks the Revisor
chapter listing for each selected year (2021 and 2025 by default), fetches
every chapter (or a capped number per year for smoke runs), cleans the
text, and writes one file per year. It is polite (a delay separates
requests), skips and logs any chapter that fails to fetch, and flags
chapters under 50 words instead of emitting them unless explicitly told
to include them.

## Record format

One JSON object per line:

```json
{"id": "mn-2021-ch1", "title": "CHAPTER 1--S.F.No. 26", "text": "...", "label": "human", "source": "mn-revisor-session-laws", "slice": "state-law", "date_created": 2021, "ai_pct": null, "word_count": 412}
```

- `label` is one of `human` | `ai` | `mixed`. `ai_pct` is 0–100 for
  `ai`/`mixed` documents and `null` for human documents.
- `date_created` maps to the API's `era` field on import, so reports can
  slice false-positive rates by era.

## The ≥50-word rule

Documents under **50 words** are excluded everywhere: the harvester flags
and skips them, `scripts/import_jsonl.py` skips and reports them, and the
Worker API rejects them per-document. Short texts make detector scores
noisy and per-1,000 false-positive rates meaningless, so they never enter
a run.

## Importing into a run

The importer validates a corpus file, then sends the surviving documents
to the Worker API in batches. It can target an existing run or create a
new named run first, and it offers a validation-only mode that reports
what would be sent without contacting the server. Importing is safe to
repeat: documents whose external id is already in the run are skipped,
as are duplicates within the file and duplicates the server reports.

## Demo corpus note

A small harvested slice (e.g. `mn-laws-2021.jsonl` from a `--limit` run) is
the demo corpus: real civic/legal human text that a researcher imports,
then generates matched AI and mixed-authorship counterfactuals from inside
the app (Meta Model API) before scoring.

Prior Pangram benchmark datasets, if used at all, are **inputs only** —
pre-existing data brought into this tool, not something built during the
hackathon, and never presented as hackathon-built work. Only the bench,
the harvesting/import pipeline, and the counterfactual generation/reporting
built on top of them are hackathon deliverables. No detector scores in any
input file should be treated as results; all reported scores come from
live scoring runs in the app.
