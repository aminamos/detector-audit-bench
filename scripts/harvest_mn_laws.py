#!/usr/bin/env python3
"""Harvest Minnesota session laws from the MN Revisor of Statutes site.

Enumerates chapter listings at https://www.revisor.mn.gov/laws/{year}/0/,
fetches each chapter's HTML, strips navigation/boilerplate, and emits one
JSONL record per chapter:

    {"id": "mn-2021-ch1", "title": "...", "text": "...", "label": "human",
     "source": "mn-revisor-session-laws", "slice": "state-law",
     "date_created": 2021, "ai_pct": null, "word_count": 1234}

These are pre-AI-era-style public legal texts written by humans (legislative
staff), so label is always "human". Documents under 50 words are flagged on
stderr and skipped unless --include-short is given (the audit bench rejects
documents under 50 words). Per-chapter failures are logged and skipped; one
bad chapter never blocks the run.

Stdlib only. Polite by default: a configurable delay separates HTTP
requests. Options select the years and session to harvest, cap how many
chapters per year are taken (for smoke runs), choose the output directory,
and optionally include flagged under-50-word chapters. Default years are
2021 and 2025; each year lands in its own mn-laws-{year}.jsonl file in the
output directory.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://www.revisor.mn.gov"
SOURCE = "mn-revisor-session-laws"
SLICE = "state-law"
MIN_WORDS = 50
USER_AGENT = "DetectorAuditBench/0.1 (Meta hackathon research; polite harvest)"

# Lines that are enactment-process boilerplate rather than law text.
_BOILERPLATE_LINE = re.compile(
    r"^(presented to the governor|signed by the governor|filed with the secretary of state"
    r"|chapter \d+ filed|vetoed|became law without governor)",
    re.IGNORECASE,
)
_CHAPTER_HREF = re.compile(r"/laws/(\d+)/0/Session\+Law/Chapter/(\d+)/?")


def fetch(url: str, timeout: float = 30.0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


class _LawTextExtractor(HTMLParser):
    """Collect text inside <div id="xtend" class="law">, skipping #actions.

    The Revisor chapter pages put the full law text in #xtend; everything
    outside it is site navigation, search UI, and footer boilerplate.
    """

    _BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "section", "article", "li", "tr", "br"}
    _SKIP = {"script", "style"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._in_law = False
        self._depth = 0
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if not self._in_law:
            if tag == "div" and attr.get("id") == "xtend":
                self._in_law = True
                self._depth = 1
            return
        if tag in self._SKIP or attr.get("id") == "actions":
            self._skip_depth += 1
            return
        if self._skip_depth:
            if tag not in ("br", "hr", "img", "meta", "link", "input"):
                self._skip_depth += 1
            return
        self._depth += 1
        if tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self._in_law:
            return
        if self._skip_depth:
            self._skip_depth -= 1
            return
        self._depth -= 1
        if tag in self._BLOCK:
            self.parts.append("\n")
        if self._depth <= 0:
            self._in_law = False

    def handle_data(self, data: str) -> None:
        if self._in_law and not self._skip_depth:
            self.parts.append(data)


def extract_law_text(html_text: str) -> str:
    parser = _LawTextExtractor()
    parser.feed(html_text)
    raw = "".join(parser.parts)
    if not raw.strip():
        # Fallback: strip all tags from the whole page (older markup).
        text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html_text)
        text = re.sub(r"(?s)<[^>]+>", "\n", text)
        raw = text
    lines: list[str] = []
    for line in raw.splitlines():
        line = re.sub(r"[ \t ]+", " ", line).strip()
        if not line or _BOILERPLATE_LINE.match(line):
            continue
        lines.append(line)
    return "\n".join(lines)


def word_count(text: str) -> int:
    return len(text.split())


def enumerate_chapters(year: int, session: str) -> list[int]:
    url = f"{BASE}/laws/{year}/{session}/"
    html_text = fetch(url)
    chapters = sorted({int(m.group(2)) for m in _CHAPTER_HREF.finditer(html_text)
                       if int(m.group(1)) == year})
    if not chapters:
        raise ValueError(f"no chapter links found at {url}")
    return chapters


def harvest_year(year: int, session: str, limit: int | None, delay: float,
                 out_dir: Path, include_short: bool) -> dict:
    chapters = enumerate_chapters(year, session)
    if limit is not None:
        chapters = chapters[:limit]
    out_path = out_dir / f"mn-laws-{year}.jsonl"
    stats = {"year": year, "listed": len(chapters), "written": 0,
             "flagged_short": [], "failed": []}
    with out_path.open("w", encoding="utf-8", newline="\n") as fh:
        for chapter in chapters:
            url = f"{BASE}/laws/{year}/{session}/Session+Law/Chapter/{chapter}/"
            try:
                text = extract_law_text(fetch(url))
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                print(f"[skip] {year} ch{chapter}: fetch/extract failed: {exc}",
                      file=sys.stderr)
                stats["failed"].append(chapter)
            else:
                wc = word_count(text)
                if wc < MIN_WORDS and not include_short:
                    print(f"[flagged-short] {year} ch{chapter}: {wc} words "
                          f"(< {MIN_WORDS}), skipped", file=sys.stderr)
                    stats["flagged_short"].append({"chapter": chapter, "word_count": wc})
                else:
                    if wc < MIN_WORDS:
                        print(f"[flagged-short] {year} ch{chapter}: {wc} words "
                              f"(< {MIN_WORDS}), included via --include-short",
                              file=sys.stderr)
                        stats["flagged_short"].append({"chapter": chapter, "word_count": wc})
                    first_line = text.splitlines()[0] if text else ""
                    record = {
                        "id": f"mn-{year}-ch{chapter}",
                        "title": first_line[:200] or f"MN Laws {year} Chapter {chapter}",
                        "text": text,
                        "label": "human",
                        "source": SOURCE,
                        "slice": SLICE,
                        "date_created": year,
                        "ai_pct": None,
                        "word_count": wc,
                    }
                    fh.write(json.dumps(record, ensure_ascii=False) + "\n")
                    stats["written"] += 1
                    print(f"[ok] mn-{year}-ch{chapter}: {wc} words")
            if delay > 0:
                time.sleep(delay)
    print(f"[done] {year}: wrote {stats['written']} -> {out_path} "
          f"(flagged_short={len(stats['flagged_short'])}, failed={len(stats['failed'])})")
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--years", nargs="+", type=int, default=[2021, 2025],
                    help="session-law years to harvest (default: 2021 2025)")
    ap.add_argument("--session", default="0",
                    help="Revisor session path segment (default: 0 = regular session)")
    ap.add_argument("--limit", type=int, default=None,
                    help="max chapters per year (smoke tests)")
    ap.add_argument("--delay", type=float, default=1.0,
                    help="seconds to sleep between requests (default: 1.0)")
    ap.add_argument("--out-dir", default="data",
                    help="output directory for mn-laws-{year}.jsonl (default: data)")
    ap.add_argument("--include-short", action="store_true",
                    help="also emit documents under 50 words (flagged on stderr)")
    args = ap.parse_args(argv)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    summaries = []
    for year in args.years:
        try:
            summaries.append(harvest_year(year, args.session, args.limit,
                                          args.delay, out_dir, args.include_short))
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            # A whole-year listing failure must not block other years.
            print(f"[error] year {year}: {exc}", file=sys.stderr)
            summaries.append({"year": year, "listed": 0, "written": 0,
                              "flagged_short": [], "failed": [], "error": str(exc)})
        if args.delay > 0:
            time.sleep(args.delay)
    print(json.dumps({"summaries": summaries}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
