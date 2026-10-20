"""Collect content/posts/*.md into data/posts.json for the site.

Each post starts with a front-matter block:

---
title: Bear's two-goal night
date: 2026-10-18
author: Joe
type: recap            # recap | analysis | opinion | scouting | draft
players: [8485362]     # NHL player ids (see the Prospects page links)
tags: [AHL, Griffins]
summary: One-line teaser shown on the news feed.
---

Usage:  python scripts/build_posts.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS = ROOT / "content" / "posts"
TYPES = {"recap", "analysis", "opinion", "scouting", "draft"}


def parse_value(v):
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        items = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
        return [int(x) if x.isdigit() else x for x in items]
    return v.strip("'\"")


def parse(path):
    raw = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", raw, re.S)
    if not m:
        raise ValueError(f"{path.name}: missing front matter")
    meta = {}
    for line in m.group(1).splitlines():
        line = re.sub(r"\s+#.*$", "", line)
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = parse_value(v)
    body = re.sub(r"<!--.*?-->", "", m.group(2), flags=re.S).strip()
    if not meta.get("title") or not meta.get("date"):
        raise ValueError(f"{path.name}: needs a title and a date")
    post_type = meta.get("type") or "analysis"
    if post_type not in TYPES:
        raise ValueError(f"{path.name}: type must be one of {sorted(TYPES)}")
    summary = meta.get("summary") or re.sub(r"[#*_>`\[\]]", "", body.split("\n\n")[0])[:220]
    return {
        "slug": path.stem,
        "title": meta["title"],
        "date": str(meta["date"]),
        "author": meta.get("author") or "Staff",
        "type": post_type,
        "players": [p for p in meta.get("players") or [] if isinstance(p, int)],
        "tags": meta.get("tags") or [],
        "summary": summary,
        "body": body,
    }


def main():
    posts = sorted((parse(p) for p in POSTS.glob("*.md")), key=lambda p: p["date"], reverse=True)
    (ROOT / "data" / "posts.json").write_text(json.dumps(posts, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(posts)} posts -> data/posts.json")


if __name__ == "__main__":
    main()
