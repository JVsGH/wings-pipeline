# Wings Pipeline

A static site covering Detroit Red Wings prospects and draft targets: game-by-game news and editorials, plus a table that translates each prospect's scoring into an NHL-equivalent pace (NHLe).

No build tools needed: plain HTML/CSS/JS plus two Python scripts (standard library only).

## Run it locally

```
python -m http.server 8000
```

Then open http://localhost:8000. (Opening the HTML files directly won't work, because browsers block `fetch()` from `file://` pages.)

## Daily workflow

1. **Update stats:** `python scripts/update_stats.py`
   - Finds every player whose rights Detroit holds, using the NHL's public API (`api-web.nhle.com`).
   - Keeps prospects aged 24 or younger, plus NHL rookies under 82 career games. Change this in `config.json`.
   - Writes `data/prospects.json`.
   - Compares against the last run (`data/snapshot.json`). For every prospect whose games played went up, it writes a **recap draft** to `content/drafts/` with the stat line, season totals and NHLe pace already filled in.
2. **Write:** open a draft, add the opponent, what you saw, and your take. Fill in `author:` and `summary:`, and change `type:` if it's analysis or opinion rather than a recap.
3. **Publish:** move the file to `content/posts/`, then run `python scripts/build_posts.py`.

You can also write posts from scratch. Copy the front matter from `content/posts/2026-10-19-welcome.md`. Post types: `recap`, `analysis`, `opinion`, `scouting`, `draft`. The `players:` list takes NHL player ids, which you'll find in the URL of each player page (`player.html?id=8485362`).

## NHLe

`NHLe per 82 = (points / games) × league factor × 82`

Factors live in `data/nhle_factors.json` and are approximate starting values from published NHLe research. Tune them to taste. Keys must match the league names the NHL API uses, which are listed in the League dropdown on the Prospects page. Leagues without a factor show no NHLe.

## Draft targets

Undrafted players aren't in the NHL API, so the watchlist in `data/draft_targets.json` is maintained by hand. NHL Central Scouting rankings for the upcoming draft are pulled into `data/css_rankings.json` automatically once the NHL publishes them (usually a preliminary list in the fall, a midterm in January, and a final list in the spring).

## Mock Lottery

`lottery.html` simulates the NHL draft lottery using current standings, which the updater saves to `data/standings.json`.

- Teams are ranked by points percentage. The projected playoff teams are the top 3 in each division plus 2 wild cards per conference; the other 16 teams are seeded worst to best.
- It uses the NHL's current rules: odds from 18.5% down to 0.5%, two draws (#1 and #2), and a 10-spot cap on how far a winner can move up.
- The "Lottery odds" tab shows exact chances, calculated from every possible pair of draws.
- Traded first-round picks update automatically. The updater reads the "Traded picks" section of Wikipedia's page for the upcoming draft (for example "2027 NHL entry draft"), including protections, and writes `data/pick_owners.json`. Don't edit that file; it's rebuilt every run.
- To correct something the parser got wrong, add it to `data/pick_overrides.json`, which is applied on top. For example, `"TOR": { "owner": "BOS" }` changes an owner, and `"VGK": null` drops a pick.
- If Wikipedia can't be reached or the page format changes, the previous pick data is kept and the updater prints a warning, so the page never goes blank.
- The draft year rolls over on its own each August, along with the season.

## Hosting (free)

1. Create a GitHub repository and push this folder.
2. Turn on GitHub Pages in **Settings → Pages**, deploying from the `main` branch root.
3. `.github/workflows/update.yml` runs the stats updater every morning and commits new stats and recap drafts. Run `git pull` to get the drafts, write them up, then push.

## Files

| Path | What it is |
|---|---|
| `index.html`, `post.html` | News feed and article pages |
| `prospects.html`, `player.html` | Stats table and player profiles |
| `draft.html` | Draft watchlist and Central Scouting rankings |
| `assets/app.js`, `assets/style.css` | All page logic and styling |
| `scripts/update_stats.py` | NHL API stats pull and recap drafts |
| `scripts/build_posts.py` | Markdown posts → `data/posts.json` |
| `config.json` | Which players count as prospects |
