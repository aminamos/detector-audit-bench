#!/usr/bin/env python3
"""Validate and import a benchmark JSONL corpus into a Detector Audit Bench run.

Input: one JSON object per line with fields

    id            unique external id (idempotency key; required)
    text          document text (required, >= 50 words)
    label         "human" | "ai" | "mixed" (required)
    source        e.g. "mn-revisor-session-laws" (optional)
    slice         e.g. "state-law" (optional)
    date_created  year/date the text was created; sent to the API as `era`
    ai_pct        0-100 for ai/mixed docs, null/absent for human (optional)
    word_count    informational; always recomputed locally and server-side
    title         optional; defaults to the id

Documents under 50 words, with an invalid label, or missing id/text are
skipped and reported -- they are never sent to the server (the server also
rejects <50-word documents with a per-document error list).

Idempotency: before posting, the run is fetched (GET /api/runs/:id) and any
document whose external_id already exists is skipped. Duplicates within the
file are also skipped, and any duplicates the server itself reports are
counted as skipped, so re-running an import is safe.

Stdlib only; no secrets are read or sent beyond the Worker API itself.

Behavior is selected by options: point it at a Worker base URL and either
an existing run or a name for a new run to create, or choose the
validation-only mode that checks a corpus and reports what would be sent
without contacting the server. Batch size for posting is configurable.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

MIN_WORDS = 50
LABELS = {"human", "ai", "mixed"}
DEFAULT_BASE_URL = "http://localhost:8787"


def word_count(text: str) -> int:
    return len(text.split())


class ApiError(RuntimeError):
    pass


def api_json(base_url: str, method: str, path: str, payload: dict | None = None,
             timeout: float = 60.0) -> tuple[int, dict]:
    url = base_url.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Content-Type": "application/json",
        "User-Agent": "DetectorAuditBench-import/0.1",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, (json.loads(body) if body.strip() else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            parsed = {"error": body[:500]}
        return exc.code, parsed
    except urllib.error.URLError as exc:
        raise ApiError(f"{method} {url} failed: {exc.reason}") from exc


def load_records(path: Path) -> tuple[list[dict], list[dict]]:
    """Return (valid documents to send, per-line problem reports)."""
    docs: list[dict] = []
    problems: list[dict] = []
    seen: set[str] = set()
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError as exc:
            problems.append({"line": lineno, "reason": f"invalid JSON: {exc}"})
            continue
        if not isinstance(rec, dict):
            problems.append({"line": lineno, "reason": "record is not a JSON object"})
            continue
        ext_id = rec.get("id") or rec.get("external_id")
        text = rec.get("text")
        label = rec.get("label")
        if not ext_id or not isinstance(ext_id, str):
            problems.append({"line": lineno, "reason": "missing/invalid 'id'"})
            continue
        if not text or not isinstance(text, str):
            problems.append({"line": lineno, "id": ext_id, "reason": "missing/invalid 'text'"})
            continue
        if label not in LABELS:
            problems.append({"line": lineno, "id": ext_id,
                             "reason": f"invalid label {label!r} (expected human|ai|mixed)"})
            continue
        ai_pct = rec.get("ai_pct")
        if ai_pct is not None:
            if not isinstance(ai_pct, (int, float)) or not 0 <= ai_pct <= 100:
                problems.append({"line": lineno, "id": ext_id,
                                 "reason": f"invalid ai_pct {ai_pct!r} (expected 0-100 or null)"})
                continue
        wc = word_count(text)
        if wc < MIN_WORDS:
            problems.append({"line": lineno, "id": ext_id,
                             "reason": f"too short: {wc} words (< {MIN_WORDS})"})
            continue
        if ext_id in seen:
            problems.append({"line": lineno, "id": ext_id,
                             "reason": "duplicate id within file, skipped"})
            continue
        seen.add(ext_id)
        declared = rec.get("word_count")
        if isinstance(declared, int) and declared != wc:
            print(f"[warn] line {lineno} {ext_id}: declared word_count={declared}, "
                  f"computed={wc} (using computed)", file=sys.stderr)
        doc: dict = {
            "external_id": ext_id,
            "title": rec.get("title") or ext_id,
            "text": text,
            "label": label,
        }
        if rec.get("date_created") is not None:
            doc["era"] = str(rec["date_created"])
        if rec.get("source"):
            doc["source"] = rec["source"]
        if rec.get("slice"):
            doc["slice"] = rec["slice"]
        if ai_pct is not None:
            doc["ai_pct"] = ai_pct
        docs.append(doc)
    return docs, problems


def existing_external_ids(base_url: str, run_id: str) -> set[str]:
    status, body = api_json(base_url, "GET", f"/api/runs/{run_id}")
    if status != 200:
        raise ApiError(f"GET /api/runs/{run_id} -> {status}: {body.get('error', body)}")
    ids: set[str] = set()
    for doc in body.get("documents", []) or []:
        ext = doc.get("external_id")
        if ext:
            ids.add(ext)
    return ids


def create_run(base_url: str, name: str) -> str:
    status, body = api_json(base_url, "POST", "/api/runs", {"name": name})
    if status not in (200, 201):
        raise ApiError(f"POST /api/runs -> {status}: {body.get('error', body)}")
    run = body.get("run") or body
    run_id = run.get("id")
    if not run_id:
        raise ApiError(f"POST /api/runs returned no run id: {body}")
    return str(run_id)


def _is_duplicate_error(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    msg = str(entry.get("error", entry.get("reason", ""))).lower()
    return "duplicate" in msg or "already exists" in msg


def post_batch(base_url: str, run_id: str, batch: list[dict]) -> dict:
    """Post one batch; settled shape: 201 {documents:[...], errors:[...]},
    or 400 {error, errors} when no document in the batch was valid."""
    status, body = api_json(base_url, "POST", f"/api/runs/{run_id}/documents",
                            {"documents": batch})
    inserted = body.get("documents") or []
    errors = body.get("errors") or []
    if status >= 400:
        # A 400 whose errors are all duplicates means the batch was already
        # imported (idempotent re-run), not a failure.
        if errors and all(_is_duplicate_error(e) for e in errors):
            return {"inserted": 0, "errors": errors,
                    "server_duplicates": len(errors)}
        raise ApiError(f"POST documents -> {status}: {body.get('error', body)}")
    dup = sum(1 for e in errors if _is_duplicate_error(e))
    return {"inserted": len(inserted) if isinstance(inserted, list) else int(inserted),
            "errors": errors, "server_duplicates": dup}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("jsonl", help="benchmark JSONL file to import")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL,
                    help=f"Worker base URL (default: {DEFAULT_BASE_URL})")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--run-id", help="existing run id to import into")
    group.add_argument("--create-run", metavar="NAME",
                       help="create a new run with this name and import into it")
    ap.add_argument("--batch-size", type=int, default=50,
                    help="documents per POST (default: 50)")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate and report only; do not contact the server")
    args = ap.parse_args(argv)
    if not args.dry_run and not args.run_id and not args.create_run:
        ap.error("one of --run-id or --create-run is required (or use --dry-run)")

    path = Path(args.jsonl)
    if not path.is_file():
        print(f"[error] file not found: {path}", file=sys.stderr)
        return 2
    docs, problems = load_records(path)
    for p in problems:
        print(f"[skip] {json.dumps(p, ensure_ascii=False)}", file=sys.stderr)
    print(f"[validated] {len(docs)} documents ready, {len(problems)} skipped "
          f"from {path}")

    summary: dict = {"file": str(path), "ready": len(docs),
                     "skipped_invalid_or_short": len(problems),
                     "skipped_existing": 0, "inserted": 0,
                     "server_duplicates": 0, "server_errors": []}
    if args.dry_run:
        print(json.dumps({**summary, "dry_run": True}, ensure_ascii=False))
        return 0

    try:
        run_id = args.run_id or create_run(args.base_url, args.create_run)
        print(f"[run] {run_id}")
        existing = existing_external_ids(args.base_url, run_id)
        fresh = [d for d in docs if d["external_id"] not in existing]
        summary["skipped_existing"] = len(docs) - len(fresh)
        if summary["skipped_existing"]:
            print(f"[idempotent] skipped {summary['skipped_existing']} documents "
                  f"already present in run")
        for i in range(0, len(fresh), max(1, args.batch_size)):
            batch = fresh[i:i + max(1, args.batch_size)]
            result = post_batch(args.base_url, run_id, batch)
            summary["inserted"] += result["inserted"]
            summary["server_duplicates"] += result["server_duplicates"]
            summary["server_errors"].extend(
                e for e in result["errors"] if not _is_duplicate_error(e))
            print(f"[posted] batch {i // max(1, args.batch_size) + 1}: "
                  f"inserted={result['inserted']} errors={len(result['errors'])}")
    except ApiError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        print(json.dumps(summary, ensure_ascii=False))
        return 1
    summary["run_id"] = run_id
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if not summary["server_errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
