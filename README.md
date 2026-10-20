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

## Roster

`roster.html` lists every player whose NHL rights Detroit holds: the Red Wings, contracted players in the AHL and ECHL, and unsigned draft picks in college, junior and Europe. It's grouped by the league each player has played in this season.

- A player who has moved between leagues (a call-up, or a loan from an SHL club to HockeyAllsvenskan) appears under each league with that league's stats, tagged with the other league.
- Each table shows every stat the NHL publishes for that league. NHL skaters get the full set, including power play, shorthanded, shots, ice time and faceoffs; other leagues get GP/G/A/PTS/+/-/PIM; goalies get their full line everywhere.
- Skater tables open **Compact** (GP, G, A, PTS, P/G, +/-, PIM, PPP, shots, TOI and NHLe, where the league has them). **Show all columns** adds everything else: G/G, A/G, PPG, SHG/SHP, GWG, OTG, S%, FO%, NHL-only P/60, G/60, S/GP, even-strength points and power-play share of points, plus NHLe goals and assists. On screens too narrow for every column, the table scrolls sideways inside its frame with # and Player pinned. The page remembers the choice.
- Goalies get **GSAA** (goals saved above average) where the league's average save percentage is known: shots against × (1 − league SV%) − goals against. The NHL average is pulled from the NHL stats API each day.
- Players who haven't played yet this season (injured, unsigned) are listed with their last team.
- The data comes from the NHL API and refreshes daily into `data/roster.json`. AHL- or ECHL-only contracts belong to those clubs, not Detroit, so they aren't included.
- **Elite Prospects:** every player has an "EP" link to their Elite Prospects profile search. Pulling EP's data automatically isn't allowed (their terms forbid scraping); it would need their licensed API.

## Outside news

The **News** page lists what other outlets write about the prospects. **Editorials** is only your own posts.

- Every update searches Google News for each prospect, in English plus the local language of the player's league and home country (Swedish, Finnish, Czech, Slovak, Russian, German or Norwegian). The query includes the local word for hockey, so namesakes in other sports mostly stay out.
- Only the headline, outlet, date and a link are shown, never article text. Articles are kept for 60 days.
- Each Google link is converted to the real article address. Non-English articles then get a "Read in English" link through Google Translate; a few publishers block this, and readers can still open the original.
- Wrong match or unwanted outlet? Add it to `data/news_hidden.json`. You can hide by part of a link, part of a headline, an outlet name, or a phrase that shouldn't be tagged to one prospect.

## NHLe

`NHLe per 82 = (points / games) × league factor × 82`

Factors live in `data/nhle_factors.json` and are approximate starting values from published NHLe research. Tune them to taste. Keys must match the league names the NHL API uses, which are listed in the League dropdown on the Prospects page. Leagues without a factor show no NHLe.

## Draft Watch and the consensus big board

Every update builds a consensus board for the upcoming draft (`data/draft_rankings.json`) from public rankings:

| Source | How the newest list is found | Format |
|---|---|---|
| Daily Faceoff | Google News search for its newest "<year> NHL Draft Rankings" article | Numbered list |
| The Hockey News | Same, for "<year> NHL Draft Ranking" | Tiered list (ordered within tiers) |
| Upside Hockey | Substack RSS feed, then the ranking table's Datawrapper CSV | Top 32 with stats |
| Prospect Hockey (Brian Murray) | Substack RSS feed | Ordered list |
| Lines.com | Fixed mock draft page | Round-one mock |
| NHL Central Scouting | NHL API, once it publishes for that year | Four lists blended into one |

- Only names, positions, clubs and rank numbers are taken from each list, and every source is linked on the page.
- A player's consensus spot is the **median** of their ranks across the lists. A list that leaves a player out counts them as its length + 10, and the average rank breaks ties. Spellings are matched across lists (DuPont/Dupont, Sundström/Sundstrom).
- If a source can't be read on a given day, yesterday's copy of that list is kept.
- The board shows on **Draft Watch** (full board, with each outlet's rank) and in the Mock Lottery's **Big board** tab and **Mock pick** column.
- To put your own stamp on the board, use `data/draft_board_overrides.json`: `pin_top` puts named players first in your order, and `remove` drops players.
- Your own watchlist (`data/draft_targets.json`, maintained by hand) appears on Draft Watch once it has players.

## Mock Lottery

`lottery.html` simulates the NHL draft lottery using current standings, which the updater saves to `data/standings.json`.

- Teams are ranked by points percentage. The projected playoff teams are the top 3 in each division plus 2 wild cards per conference; the other 16 teams are seeded worst to best.
- It uses the NHL's current rules: odds from 18.5% down to 0.5%, two draws (#1 and #2), and a 10-spot cap on how far a winner can move up.
- The "Lottery odds" tab shows exact chances, calculated from every possible pair of draws.
- Traded first-round picks update automatically. The updater reads the "Traded picks" section of Wikipedia's page for the upcoming draft (for example "2027 NHL entry draft"), including protections, and writes `data/pick_owners.json`. Don't edit that file; it's rebuilt every run.
- To correct something the parser got wrong, add it to `data/pick_overrides.json`, which is applied on top. For example, `"TOR": { "owner": "BOS" }` changes an owner, and `"VGK": null` drops a pick.
- If Wikipedia can't be reached or the page format changes, the previous pick data is kept and the updater prints a warning, so the page never goes blank.
- The draft year rolls over on its own each August, along with the season.
- **Big board and mock picks:** the Big board tab and the Mock pick column use the consensus board described under Draft Watch below. Each pick in the draft order gets the best player left on it, and it updates with every simulated lottery.

## Hosting

**Live site:** https://jvsgh.github.io/wings-pipeline/ (GitHub Pages, served from the `main` branch of [JVsGH/wings-pipeline](https://github.com/JVsGH/wings-pipeline)).

- **Automatic updates:** every morning at 10:00 UTC (6 AM Eastern in summer, 5 AM in winter), `.github/workflows/update.yml` refreshes all the data, writes recap drafts and commits the result. Pages republishes about a minute later.
- **Run it now:** to refresh outside the schedule, go to the repo's **Actions** tab → **Update site data** → **Run workflow**.
- **Before you edit anything,** pull the bot's latest commit, so your push doesn't collide with its changes:

  ```
  git pull
  ```

- **Publishing a post:** move a draft from `content/drafts/` to `content/posts/`, run `python scripts/build_posts.py`, then commit and push:

  ```
  git add -A
  git commit -m "New post"
  git push
  ```

- **If a run fails,** GitHub emails you, and the site keeps its last good data.

## Files

| Path | What it is |
|---|---|
| `index.html` | Home: snapshot cards of every section |
| `editorials.html`, `post.html` | Your posts and the article page |
| `news.html` | Outside articles about the prospects |
| `roster.html` | Every Detroit player, with full stats per league |
| `prospects.html`, `player.html` | Stats table and player profiles |
| `draft.html` | Draft watchlist and Central Scouting rankings |
| `lottery.html` | Mock draft lottery (standings, odds, simulator) |
| `assets/app.js`, `assets/style.css` | All page logic and styling |
| `scripts/update_stats.py` | Daily data refresh: stats, standings, rankings, traded picks, recap drafts |
| `scripts/build_posts.py` | Markdown posts → `data/posts.json` |
| `config.json` | Which players count as prospects |
