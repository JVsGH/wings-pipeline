"""Refresh all of the site's data: Detroit prospect stats, standings and Central Scouting rankings
(NHL public API), and traded first-round picks for the upcoming draft (Wikipedia).

Writes:
  data/prospects.json      - everything the Prospects/Player pages show
  data/roster.json         - every player whose rights Detroit holds, with full stats per league (Roster page)
  data/snapshot.json       - last-seen stat lines, used to spot new games
  data/standings.json      - league standings + projected playoff teams (Mock Lottery)
  data/pick_owners.json    - traded first-round picks and protections (Mock Lottery);
                             hand corrections go in data/pick_overrides.json
  data/css_rankings.json   - NHL Central Scouting rankings for the next draft (when published)
  content/drafts/*.md      - a recap draft for every prospect who played since the last run

Usage:  python scripts/update_stats.py
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DRAFTS = ROOT / "content" / "drafts"
API = "https://api-web.nhle.com/v1"
SEARCH = "https://search.d3.nhle.com/api/v1/search/player"


def get(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": "WingsProspectTracker/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2 * (attempt + 1))


def current_season(today=None):
    today = today or date.today()
    start = today.year if today.month >= 8 else today.year - 1
    return start * 10000 + start + 1


def age_on(birth, when):
    b = date.fromisoformat(birth)
    return when.year - b.year - ((when.month, when.day) < (b.month, b.day))


def text(v):
    s = v.get("default", "") if isinstance(v, dict) else (v or "")
    # Some API strings arrive double-encoded ("TimrÃ¥" for "Timrå"); undo that when it applies.
    if "Ã" in s or "Â" in s:
        try:
            s = s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return s


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def team_player_ids(team):
    """Every player whose NHL rights belong to `team`, per the NHL's player search."""
    ids = {}
    for active in ("true", "false"):
        q = urllib.parse.urlencode({"culture": "en-us", "limit": 20000, "q": "*", "active": active})
        for p in get(f"{SEARCH}?{q}") or []:
            if p.get("teamAbbrev") == team:
                ids[int(p["playerId"])] = p["name"]
    return ids


def stat_row(s, goalie):
    row = {
        "season": s["season"],
        "league": s.get("leagueAbbrev", ""),
        "team": text(s.get("teamName")),
        "gp": s.get("gamesPlayed", 0) or 0,
    }
    if goalie:
        row.update({
            "w": s.get("wins"), "l": s.get("losses"),
            "ga": s.get("goalsAgainst"), "sa": s.get("shotsAgainst"),
            "svp": s.get("savePctg"), "gaa": s.get("goalsAgainstAvg"),
            "so": s.get("shutouts"),
        })
    else:
        row.update({
            "g": s.get("goals", 0) or 0, "a": s.get("assists", 0) or 0,
            "pts": s.get("points", 0) or 0, "pim": s.get("pim"),
            "pm": s.get("plusMinus"),
        })
    return row


def build_player(pid, land, season, roster_ids, cfg):
    goalie = land.get("position") == "G"
    regular = [s for s in land.get("seasonTotals", []) if s.get("gameTypeId") == 2]
    by_season = lambda yr: [stat_row(s, goalie) for s in regular if s["season"] == yr]
    draft = land.get("draftDetails") or {}
    born = land.get("birthDate")
    return {
        "id": pid,
        "name": f"{text(land.get('firstName'))} {text(land.get('lastName'))}",
        "pos": land.get("position"),
        "shoots": land.get("shootsCatches"),
        "born": born,
        "age": age_on(born, date.today()) if born else None,
        "height": land.get("heightInInches"),
        "weight": land.get("weightInPounds"),
        "country": land.get("birthCountry"),
        "headshot": land.get("headshot"),
        "draft": {k: draft.get(k) for k in ("year", "teamAbbrev", "round", "overallPick")} if draft else None,
        "nhl_gp": ((land.get("careerTotals") or {}).get("regularSeason") or {}).get("gamesPlayed", 0),
        "on_nhl_roster": pid in roster_ids,
        "current": by_season(season),
        "previous": by_season(season - 10001),
    }


# Fields in a season line that describe the team/season rather than stats.
STAT_META = {"season", "sequence", "gameTypeId", "leagueAbbrev", "teamName", "teamCommonName", "teamPlaceNameWithPreposition"}


def roster_entry(pid, land, season, roster_ids, roster_numbers):
    """One organization player for the Roster page: bio plus every stat the API has
    for each league they've played in this regular season."""
    draft = land.get("draftDetails") or {}
    born = land.get("birthDate")
    lines = [{"league": s.get("leagueAbbrev", ""), "team": text(s.get("teamName")),
              "stats": {k: v for k, v in s.items() if k not in STAT_META}}
             for s in land.get("seasonTotals", []) if s.get("season") == season and s.get("gameTypeId") == 2]
    last = [s for s in land.get("seasonTotals", []) if s.get("gameTypeId") == 2]
    return {
        "id": pid,
        "name": f"{text(land.get('firstName'))} {text(land.get('lastName'))}",
        "number": roster_numbers.get(pid) or land.get("sweaterNumber"),
        "pos": land.get("position"),
        "shoots": land.get("shootsCatches"),
        "age": age_on(born, date.today()) if born else None,
        "country": land.get("birthCountry"),
        "headshot": land.get("headshot"),
        "draft": {k: draft.get(k) for k in ("year", "teamAbbrev", "round", "overallPick")} if draft else None,
        "on_nhl_roster": pid in roster_ids,
        "lines": lines,
        "last_team": None if lines or not last else {"league": last[-1].get("leagueAbbrev", ""),
                                                     "team": text(last[-1].get("teamName")),
                                                     "season": last[-1].get("season")},
    }


def is_prospect(p, cfg):
    if p["id"] in cfg["exclude_player_ids"]:
        return False
    if p["id"] in cfg["extra_player_ids"]:
        return True
    if p["age"] is not None and p["age"] > cfg["max_prospect_age"]:
        return False
    if p["on_nhl_roster"] or p["nhl_gp"] >= cfg["rookie_nhl_gp_limit"]:
        return cfg["include_nhl_rookies"] and p["nhl_gp"] < cfg["rookie_nhl_gp_limit"]
    return True


def fmt_line(d, goalie):
    if goalie:
        saves = (d.get("sa") or 0) - (d.get("ga") or 0)
        return f"{d['gp']} GP, {saves} saves on {d.get('sa') or 0} shots, {d.get('ga') or 0} GA"
    return f"{d['gp']} GP, {d['g']} G, {d['a']} A, {d['pts']} PTS"


def write_draft(p, row, old, factors):
    goalie = p["pos"] == "G"
    delta = {k: (row.get(k) or 0) - (old.get(k) or 0) for k in ("gp", "g", "a", "pts", "ga", "sa")}
    today = date.today().isoformat()
    slug = f"{today}-{slugify(p['name'])}-{slugify(row['league'])}"
    path = DRAFTS / f"{slug}.md"
    if path.exists():
        return None
    if goalie:
        title = f"{p['name']} update: {fmt_line(delta, True)} for {row['team']}"
        season_line = f"{row['gp']} GP, {row.get('svp') or 0:.3f} SV%, {row.get('gaa') or 0:.2f} GAA"
        pace = ""
    else:
        title = f"{p['name']}: {delta['g']}G {delta['a']}A in {delta['gp']} game{'s' if delta['gp'] != 1 else ''} for {row['team']}"
        season_line = f"{fmt_line(row, False)} ({row['pts'] / row['gp']:.2f} P/GP)" if row["gp"] else ""
        f = factors.get(row["league"])
        pace = (f"\nNHLe pace: **{row['pts'] / row['gp'] * f * 82:.0f} points per 82 NHL games** "
                f"({row['league']} factor {f}).\n") if f and row["gp"] else ""
    body = f"""---
title: {title}
date: {today}
author:
type: recap
players: [{p['id']}]
tags: [{row['league']}]
summary:
---

**Since the last update ({delta['gp']} game{'s' if delta['gp'] != 1 else ''}):** {fmt_line(delta, goalie)}

**Season to date with {row['team']} ({row['league']}):** {season_line}
{pace}
<!-- Fill in: opponent(s), date(s), and the box-score details the totals don't show. -->

## What happened

## What I saw

## Why it matters for Detroit
"""
    DRAFTS.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


def update_css_rankings(season):
    year = season % 10000
    out = {"draftYear": year, "categories": {}}
    for cat_id, cat in ((1, "North American Skaters"), (2, "International Skaters"),
                        (3, "North American Goalies"), (4, "International Goalies")):
        r = get(f"{API}/draft/rankings/{year}/{cat_id}")
        if r and r.get("draftYear") == year and r.get("rankings"):
            out["categories"][cat] = r["rankings"]
    path = DATA / "css_rankings.json"
    if out["categories"]:
        path.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
        return sum(len(v) for v in out["categories"].values())
    if not path.exists():
        path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    return 0


def update_standings():
    """League standings for the Mock Lottery page, with projected playoff teams flagged
    (top 3 in each division plus 2 wild cards per conference)."""
    d = get(f"{API}/standings/now")
    if not d or not d.get("standings"):
        return 0
    teams = []
    for t in d["standings"]:
        teams.append({
            "abbrev": text(t.get("teamAbbrev")),
            "name": text(t.get("teamName")),
            "logo": t.get("teamLogo"),
            "conf": t.get("conferenceAbbrev"),
            "div": t.get("divisionName"),
            "gp": t.get("gamesPlayed", 0), "w": t.get("wins", 0), "l": t.get("losses", 0),
            "otl": t.get("otLosses", 0), "pts": t.get("points", 0),
            "pts_pct": t.get("pointPctg", 0), "rw": t.get("regulationWins", 0),
            "gd": t.get("goalDifferential", 0),
            "streak": f"{t.get('streakCode', '')}{t.get('streakCount', '')}",
            "l10": f"{t.get('l10Wins', 0)}-{t.get('l10Losses', 0)}-{t.get('l10OtLosses', 0)}",
        })
    # Rank by points percentage (fairer than raw points while games played differ),
    # then regulation wins, then goal differential.
    strength = lambda t: (t["pts_pct"], t["rw"], t["gd"])
    for conf in {t["conf"] for t in teams}:
        ct = sorted((t for t in teams if t["conf"] == conf), key=strength, reverse=True)
        division_spots = []
        for div in {t["div"] for t in ct}:
            division_spots += [t["abbrev"] for t in ct if t["div"] == div][:3]
        wild_cards = [t["abbrev"] for t in ct if t["abbrev"] not in division_spots][:2]
        for t in ct:
            t["playoff"] = t["abbrev"] in division_spots or t["abbrev"] in wild_cards
    teams.sort(key=strength)  # worst team first
    for i, t in enumerate(teams):
        t["league_rank"] = len(teams) - i
    (DATA / "standings.json").write_text(json.dumps({
        "updated": (d.get("standingsDateTimeUtc") or date.today().isoformat())[:10],
        "season": current_season(),
        "teams": teams,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    return len(teams)


# ---------- outside news (News page) ----------
# Google News editions to search, by league and by birth country. English is always searched.
# Each edition has the local word(s) for hockey, so a query like "Eddie Genborg" stays on-topic.
NEWS_EDITIONS = {
    "en": {"hl": "en-US", "gl": "US", "ceid": "US:en", "hockey": ["hockey", "Red Wings"]},
    "sv": {"hl": "sv", "gl": "SE", "ceid": "SE:sv", "hockey": ["hockey", "ishockey"]},
    "fi": {"hl": "fi", "gl": "FI", "ceid": "FI:fi", "hockey": ["jääkiekko", "kiekko", "Liiga"]},
    "cs": {"hl": "cs", "gl": "CZ", "ceid": "CZ:cs", "hockey": ["hokej", "hokejista"]},
    "sk": {"hl": "sk", "gl": "SK", "ceid": "SK:sk", "hockey": ["hokej", "hokejista"]},
    "ru": {"hl": "ru", "gl": "RU", "ceid": "RU:ru", "hockey": ["хоккей", "хоккеист"]},
    "de": {"hl": "de", "gl": "DE", "ceid": "DE:de", "hockey": ["Eishockey", "DEL"]},
    "no": {"hl": "no", "gl": "NO", "ceid": "NO:no", "hockey": ["hockey", "ishockey"]},
}
LEAGUE_LANG = {"SHL": "sv", "HockeyAllsvenskan": "sv", "U20 Nationell": "sv", "Liiga": "fi", "Mestis": "fi",
               "U20 SM-sarja": "fi", "Czechia": "cs", "Slovakia": "sk", "KHL": "ru", "VHL": "ru", "MHL": "ru",
               "DEL": "de", "NL": "de"}
COUNTRY_LANG = {"SWE": "sv", "FIN": "fi", "CZE": "cs", "SVK": "sk", "RUS": "ru", "DEU": "de", "AUT": "de",
                "CHE": "de", "NOR": "no"}
NEWS_DAYS = 60            # keep articles this many days
NEWS_MAX_DECODES = 200    # real-URL lookups per run (the rest wait for the next run)
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def fetch_text(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": BROWSER_UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def google_news_search(query, edition):
    """Items from a Google News RSS search: title, Google link, outlet, publish time (ISO)."""
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    e = NEWS_EDITIONS[edition]
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": query, "hl": e["hl"], "gl": e["gl"], "ceid": e["ceid"]})
    items = []
    for it in ET.fromstring(fetch_text(url).encode("utf-8")).iter("item"):
        source = it.find("source")
        outlet = (source.text or "").strip() if source is not None else ""
        title = (it.findtext("title") or "").strip()
        if outlet and title.endswith(f" - {outlet}"):
            title = title[: -len(outlet) - 3].strip()
        try:
            published = parsedate_to_datetime(it.findtext("pubDate")).date().isoformat()
        except (TypeError, ValueError):
            continue
        items.append({"title": title, "google_link": it.findtext("link"), "source": outlet,
                      "source_site": source.get("url") if source is not None else None,
                      "published": published, "lang": edition})
    return items


def resolve_google_news_link(google_link):
    """Google News RSS links are encoded redirects. Ask Google for the real article URL
    (needed for 'Read in English' via Google Translate). Returns None if Google won't say."""
    art_id = urllib.parse.urlparse(google_link).path.rsplit("/", 1)[-1]
    page = fetch_text(f"https://news.google.com/rss/articles/{art_id}")
    sig = re.search(r'data-n-a-sg="([^"]+)"', page)
    ts = re.search(r'data-n-a-ts="([^"]+)"', page)
    if not (sig and ts):
        return None
    inner = ["garturlreq", [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1],
                            "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], art_id, int(ts.group(1)), sig.group(1)]
    body = urllib.parse.urlencode({"f.req": json.dumps([[["Fbv4je", json.dumps(inner), None, "generic"]]])}).encode()
    resp = fetch_text("https://news.google.com/_/DotsSplashUi/data/batchexecute", data=body,
                      headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    url = json.loads(json.loads(resp.split("\n\n", 1)[1])[0][2])[1]
    return url if isinstance(url, str) and url.startswith("http") else None


def news_hidden():
    path = DATA / "news_hidden.json"
    h = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    low = lambda xs: [x.lower() for x in xs or []]
    return low(h.get("urls")), low(h.get("titles")), low(h.get("sources")), {
        int(k): low(v) for k, v in (h.get("player_titles") or {}).items()}


def update_news(players):
    """Search Google News for every prospect and write data/news.json (headline, outlet, date, link only)."""
    from datetime import timedelta
    path = DATA / "news.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"articles": []}
    known = {a["google_link"]: a for a in previous.get("articles", [])}
    cutoff = (date.today() - timedelta(days=NEWS_DAYS)).isoformat()
    found, failures = {}, 0

    for p in players:
        langs = {"en"}
        langs |= {LEAGUE_LANG[r["league"]] for r in p["current"] + p["previous"] if r["league"] in LEAGUE_LANG}
        if p.get("country") in COUNTRY_LANG:
            langs.add(COUNTRY_LANG[p["country"]])
        teams = list(dict.fromkeys(r["team"] for r in p["current"] if r.get("team")))[:2]
        for lang in sorted(langs):
            context = NEWS_EDITIONS[lang]["hockey"] + (teams if lang == "en" else [])
            query = f'"{p["name"]}" (' + " OR ".join(f'"{c}"' if " " in c else c for c in context) + ")"
            try:
                results = google_news_search(query, lang)
            except Exception as e:
                failures += 1
                print(f"  ! news search failed for {p['name']} ({lang}): {e}", file=sys.stderr)
                continue
            for item in results:
                if item["published"] < cutoff:
                    continue
                key = item["google_link"]
                entry = found.setdefault(key, {**known.get(key, {}), **item, "players": []})
                if p["id"] not in entry["players"]:
                    entry["players"].append(p["id"])
            time.sleep(0.4)

    if not found and previous.get("articles"):
        print("News: no results this run; kept previous articles", file=sys.stderr)
        return None

    # Keep recent articles from earlier runs that this search didn't return again.
    for key, a in known.items():
        if key not in found and a.get("published", "") >= cutoff:
            found[key] = a

    # Same story syndicated under several links: keep the first copy per outlet + headline.
    deduped = {}
    for a in sorted(found.values(), key=lambda a: a["published"], reverse=True):
        dk = (a["source"].lower(), re.sub(r"\W+", " ", a["title"].lower()).strip())
        if dk in deduped:
            deduped[dk]["players"] = sorted(set(deduped[dk]["players"]) | set(a["players"]))
        else:
            deduped[dk] = a

    hide_urls, hide_titles, hide_sources, hide_player = news_hidden()
    articles = []
    for a in deduped.values():
        hay = f'{a["google_link"]} {a.get("url") or ""}'.lower()
        title = a["title"].lower()
        if any(u in hay for u in hide_urls) or any(t in title for t in hide_titles) \
                or a["source"].lower() in hide_sources:
            continue
        a["players"] = [pid for pid in a["players"] if not any(t in title for t in hide_player.get(pid, []))]
        if a["players"]:
            articles.append(a)

    decodes = 0
    for a in articles:
        if "url" in a or decodes >= NEWS_MAX_DECODES:
            continue
        decodes += 1
        try:
            a["url"] = resolve_google_news_link(a["google_link"])
        except Exception:
            a["url"] = None
        time.sleep(0.3)

    articles.sort(key=lambda a: (a["published"], a["title"]), reverse=True)
    path.write_text(json.dumps({"updated": date.today().isoformat(), "days": NEWS_DAYS, "articles": articles},
                               indent=1, ensure_ascii=False), encoding="utf-8")
    if failures:
        print(f"  ! {failures} news searches failed", file=sys.stderr)
    return len(articles)


# ---------- traded first-round picks (Mock Lottery) ----------
WIKI_API = "https://en.wikipedia.org/w/api.php"
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
                "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
                "fifteen": 15, "sixteen": 16, "eighteen": 18, "twenty": 20}


def wiki_page(title):
    q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "wikitext|revid",
                                "format": "json", "formatversion": 2, "redirects": 1})
    req = urllib.request.Request(f"{WIKI_API}?{q}", headers={"User-Agent": "WingsPipeline/1.0 (Red Wings prospect site)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    if "parse" not in d:
        raise ValueError(d.get("error", {}).get("info", "page not found"))
    return d["parse"]["wikitext"], d["parse"]["revid"]


def wiki_plain(s):
    """Wikitext -> readable text: drop refs/templates/comments, unwrap links."""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>/]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    while re.search(r"\{\{[^{}]*\}\}", s):
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"'{2,}", "", s)
    return re.sub(r"\s+", " ", s).strip()


def wiki_ref_urls(chunk, named):
    """Source URLs cited in a chunk of wikitext, including reused named refs."""
    urls = re.findall(r"\burl\s*=\s*(https?://[^\s|}]+)", chunk)
    for name in re.findall(r'<ref\s+name\s*=\s*"?([^">/]+?)"?\s*/>', chunk):
        urls += named.get(name.strip(), [])
    return list(dict.fromkeys(urls))


def team_lookup(teams):
    norm = lambda s: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    names = {norm(t["name"]): t["abbrev"] for t in teams}
    return lambda name: names.get(norm(name))


def protected_top(condition):
    m = re.search(r"(?:outside|within|inside) (?:of )?the top[ -](\w+)", condition, re.I)
    if not m:
        return None
    word = m.group(1).lower()
    return int(word) if word.isdigit() else NUMBER_WORDS.get(word)


def parse_traded_firsts(wikitext, abbrev_of):
    """Round-one picks from a Wikipedia NHL entry draft page: settled trades (the 'Round one' list)
    plus conditional ones (the 'Unresolved conditional draft picks' table)."""
    named = {}
    for name, body in re.findall(r'<ref\s+name\s*=\s*"?([^">/]+?)"?\s*>(.*?)</ref>', wikitext, re.S):
        named.setdefault(name.strip(), []).extend(re.findall(r"\burl\s*=\s*(https?://[^\s|}]+)", body))
    picks, problems = {}, []

    def team(link_text, context):
        name = re.sub(r"\s*\(via.*", "", wiki_plain(link_text)).strip()
        ab = abbrev_of(name)
        if not ab:
            problems.append(f"unknown team '{name}' in: {context[:80]}")
        return ab

    section = re.search(r"^=+\s*Round one\s*=+\s*$(.*?)(?=^=)", wikitext, re.M | re.S)
    for item in re.findall(r"^#\s*(.+)$", section.group(1) if section else "", re.M):
        m = re.search(r"\[\[([^\]]+)\]\]'?s? first-round pick will go to the \[\[([^\]]+)\]\]", item)
        if not m:
            problems.append(f"unparsed round-one entry: {wiki_plain(item)[:100]}")
            continue
        orig, owner = team(m.group(1), item), team(m.group(2), item)
        if orig and owner:
            text_ = wiki_plain(item)
            via = re.search(r"\(via ([^)]+)\)", wiki_plain(item[m.end():m.end() + 120]))
            picks[orig] = {
                "owner": owner,
                "note": "Unprotected" + (f" · via {abbrev_of(via.group(1)) or via.group(1)}" if via else ""),
                "detail": re.sub(r"^The .*? as the result of ", "", text_).rstrip(".")[:300],
                "sources": wiki_ref_urls(item, named),
            }

    table = re.search(r"^=+\s*Unresolved conditional draft picks\s*=+\s*$(.*?)(?=^=)", wikitext, re.M | re.S)
    rows = re.split(r"^\|-.*$", table.group(1) if table else "", flags=re.M)
    conditional = {}
    for row in rows:
        cells = [c.strip() for c in re.split(r"^\|", row, flags=re.M)[1:]]
        cells = [re.sub(r'^align\s*=\s*"?\w+"?\s*\|', "", c).strip() for c in cells]
        if len(cells) < 4 or wiki_plain(cells[0]) != "1":
            continue
        receiving, granting = team(cells[1], row), team(cells[2], row)
        if not (receiving and granting):
            continue
        via = re.search(r"\(via \[\[([^\]]+)\]\]\)", cells[1])
        conditional.setdefault(granting, []).append({
            "receiving": receiving,
            "via": abbrev_of(wiki_plain(via.group(1))) if via else None,
            "condition": wiki_plain(cells[3]),
            "detail": wiki_plain(cells[4]) if len(cells) > 4 else "",
            "sources": wiki_ref_urls(row, named),
        })

    for granting, deals in conditional.items():
        # The team that gets the pick when it falls outside the protection is the headline owner.
        outside = [d for d in deals if re.search(r"outside (?:of )?the top", d["condition"], re.I)] or deals
        main_deal = outside[0]
        top = protected_top(main_deal["condition"])
        others = [d for d in deals if d is not main_deal]
        entry = {
            "owner": main_deal["receiving"],
            "protected_top": top,
            "protected_owner": None,
            "detail": " ".join(d["detail"] for d in deals)[:400],
            "condition": " ".join(d["condition"] for d in deals),
            "sources": list(dict.fromkeys(u for d in deals for u in d["sources"])),
        }
        if others:
            names = " or ".join(sorted({main_deal["receiving"], *[d["receiving"] for d in others]}))
            if any(re.search(r"\b(elects?|chooses?|choice|option)\b", d["condition"], re.I) for d in deals):
                entry["protected_label"] = f"{names} ({granting} chooses)"
            else:
                entry["protected_owner"] = others[0]["receiving"]
        if top is None:
            problems.append(f"{granting}: couldn't read the protection from: {main_deal['condition'][:100]}")
        # (A middleman like "via CGY" stays in the detail text; the page already shows "via <original team>".)
        inside = entry.get("protected_label") and f"inside top {top}, {granting} picks {names}"
        entry["note"] = (f"Top-{top} protected" + (f" ({inside})" if inside else f" (else {granting} 2028 1st)")
                         if top else "Conditional")
        picks[granting] = entry
    return picks, problems


def update_traded_picks(season):
    """Refresh data/pick_owners.json from Wikipedia's page for the upcoming draft.
    data/pick_overrides.json (hand-edited, optional) wins over anything parsed.
    On any failure the previous file is kept, so the site never loses its pick data."""
    year = season % 10000
    path = DATA / "pick_owners.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    standings = json.loads((DATA / "standings.json").read_text(encoding="utf-8"))
    title = f"{year} NHL entry draft"
    try:
        wikitext, revid = wiki_page(title)
        picks, problems = parse_traded_firsts(wikitext, team_lookup(standings["teams"]))
    except Exception as e:  # network trouble or a page we can't read: keep what we had
        print(f"Traded picks: kept previous data ({e})", file=sys.stderr)
        return None
    if not picks and previous.get("picks") and previous.get("draft_year") == year:
        print("Traded picks: parser found nothing; kept previous data (check the Wikipedia page format)", file=sys.stderr)
        return None

    overrides_path = DATA / "pick_overrides.json"
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")).get("picks", {}) if overrides_path.exists() else {}
    for orig, fix in overrides.items():
        if fix is None:
            picks.pop(orig, None)
        else:
            picks[orig] = {**picks.get(orig, {}), **fix}

    source_url = f"https://en.wikipedia.org/w/index.php?title={urllib.parse.quote(title.replace(' ', '_'))}&oldid={revid}"
    path.write_text(json.dumps({
        "_note": "Generated by scripts/update_stats.py from Wikipedia; don't edit by hand. Put corrections in data/pick_overrides.json.",
        "draft_year": year,
        "updated": date.today().isoformat(),
        "source": {"name": f"Wikipedia: {title}", "url": source_url},
        "problems": problems,
        "picks": dict(sorted(picks.items())),
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    for p in problems:
        print(f"  ! traded picks: {p}", file=sys.stderr)
    return len(picks)


def main():
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    factors = json.loads((DATA / "nhle_factors.json").read_text(encoding="utf-8"))["factors"]
    season = current_season()
    team = cfg["team"]

    roster = get(f"{API}/roster/{team}/current") or {}
    roster_ids = {p["id"] for group in roster.values() for p in group}
    roster_numbers = {p["id"]: p.get("sweaterNumber") for group in roster.values() for p in group}
    ids = team_player_ids(team) | {i: "" for i in cfg["extra_player_ids"]} | {i: "" for i in roster_ids}
    print(f"{len(ids)} players with {team} rights; season {season}")

    players, organization = [], []
    for pid in sorted(ids):
        land = get(f"{API}/player/{pid}/landing")
        if not land:
            print(f"  ! no data for {pid}", file=sys.stderr)
            continue
        organization.append(roster_entry(pid, land, season, roster_ids, roster_numbers))
        p = build_player(pid, land, season, roster_ids, cfg)
        if is_prospect(p, cfg):
            players.append(p)
        time.sleep(0.15)
    print(f"{len(players)} prospects")
    (DATA / "roster.json").write_text(json.dumps({
        "updated": date.today().isoformat(), "season": season, "team": team,
        "players": sorted(organization, key=lambda r: r["name"]),
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Roster: {len(organization)} players in the organization")

    snap_path = DATA / "snapshot.json"
    snapshot = json.loads(snap_path.read_text(encoding="utf-8")) if snap_path.exists() else None
    new_snap, drafts = {}, []
    for p in players:
        for row in p["current"]:
            key = f"{p['id']}|{row['season']}|{row['league']}|{row['team']}"
            new_snap[key] = row
            if snapshot is None:
                continue
            old = snapshot.get(key, {"gp": 0})
            if row["gp"] > old.get("gp", 0):
                path = write_draft(p, row, old, factors)
                if path:
                    drafts.append(path.name)
    snap_path.write_text(json.dumps(new_snap, indent=1, ensure_ascii=False), encoding="utf-8")

    (DATA / "prospects.json").write_text(json.dumps({
        "updated": date.today().isoformat(),
        "season": season,
        "players": players,
    }, indent=1, ensure_ascii=False), encoding="utf-8")

    n_news = update_news(players)
    if n_news is not None:
        print(f"News: {n_news} articles from the last {NEWS_DAYS} days")

    print(f"Standings: {update_standings()} teams")
    traded = update_traded_picks(season)
    if traded is not None:
        print(f"Traded {season % 10000} first-round picks: {traded}")
    n = update_css_rankings(season)
    print(f"Central Scouting {season % 10000}: {n} ranked players" if n else
          f"Central Scouting {season % 10000}: not published yet")
    if snapshot is None:
        print("First run: saved a baseline. Recap drafts start from the next run.")
    for d in drafts:
        print(f"  draft: content/drafts/{d}")


if __name__ == "__main__":
    main()
