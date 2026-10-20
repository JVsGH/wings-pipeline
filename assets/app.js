// Shared code for every page. Each page sets <body data-page="..."> and this file runs that page's init.

const SITE_NAME = "Wings Pipeline";
const NAV = [
  ["index.html", "Home", "home"],
  ["editorials.html", "Editorials", "editorials"],
  ["news.html", "News", "news"],
  ["roster.html", "Roster", "roster"],
  ["prospects.html", "Prospects", "prospects"],
  ["draft.html", "Draft Watch", "draft"],
  ["lottery.html", "Mock Lottery", "lottery"],
];
const TYPES = ["recap", "analysis", "opinion", "scouting", "draft"];
const SMALL_SAMPLE = 10;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const params = new URLSearchParams(location.search);

async function load(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function header(page) {
  const links = NAV.map(([href, label, key]) =>
    `<a href="${href}" class="${key === page ? "active" : ""}">${label}</a>`).join("");
  document.body.insertAdjacentHTML("afterbegin",
    `<header class="site-header"><div class="inner">
      <a class="brand" href="index.html"><span class="wheel">D</span>${SITE_NAME}</a>
      <nav>${links}</nav>
      <button type="button" class="theme-toggle" id="theme-toggle"></button></div></header>`);
  initThemeToggle();
}

// ---------- light / dark toggle ----------
const ICONS = {
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
};

function initThemeToggle() {
  const root = document.documentElement;
  const btn = $("#theme-toggle");
  const system = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => { try { return localStorage.getItem("theme"); } catch { return null; } };
  const apply = (theme) => {
    root.dataset.theme = theme;
    const next = theme === "dark" ? "light" : "dark";
    btn.innerHTML = `${next === "dark" ? ICONS.moon : ICONS.sun}<span>${next === "dark" ? "Dark" : "Light"}</span>`;
    btn.setAttribute("aria-label", `Switch to ${next} mode`);
    btn.title = `Switch to ${next} mode`;
  };
  btn.addEventListener("click", () => {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", theme); } catch {}
    apply(theme);
  });
  // Until the visitor picks a mode, keep following the system setting.
  system.addEventListener("change", (e) => { if (!saved()) apply(e.matches ? "dark" : "light"); });
  apply(root.dataset.theme || (system.matches ? "dark" : "light"));
}

// ---------- formatting ----------
const seasonLabel = (s) => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;
const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const ppg = (r) => (r.gp ? r.pts / r.gp : null);
const fixed = (v, n = 2) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(n));
const svp = (v) => (v == null ? "–" : v.toFixed(3).replace(/^0/, ""));
const heightFt = (inches) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : "–");
const isGoalie = (p) => p.pos === "G";
const posLabel = (pos) => ({ L: "LW", R: "RW" }[pos] || pos || "–"); // API uses L/R for wingers
const posGroup = (pos) => (pos === "G" ? "G" : pos === "D" ? "D" : "F");

function draftLabel(d) {
  if (!d) return "No draft info"; // undrafted signing, or a recent pick the NHL hasn't filled in yet
  return `${d.year} · Rd ${d.round}, #${d.overallPick}${d.teamAbbrev && d.teamAbbrev !== "DET" ? ` (${d.teamAbbrev})` : ""}`;
}

function nhle(row, factors) {
  const f = factors[row.league];
  if (f == null || !row.gp) return null;
  return (row.pts / row.gp) * f * 82;
}

function draftShort(d) {
  if (!d) return "No draft info";
  return `${d.year} R${d.round} #${d.overallPick}${d.teamAbbrev && d.teamAbbrev !== "DET" ? ` (${d.teamAbbrev})` : ""}`;
}

function nhleCell(v, max, label = "NHLe / 82") {
  if (v == null) return `<td class="num dim c-nhle" data-label="${label}">–</td>`;
  const w = Math.max(2, Math.min(100, (v / max) * 100));
  return `<td class="num c-nhle" data-label="${label}"><div class="nhle"><span>${v.toFixed(0)}</span><div class="bar"><span style="width:${w}%"></span></div></div></td>`;
}

// ---------- news ----------
function postCard(p, playersById) {
  const names = p.players.map((id) => playersById[id]).filter(Boolean)
    .map((pl) => `<a href="player.html?id=${pl.id}">${esc(pl.name)}</a>`).join(", ");
  return `<article class="card">
    <div class="meta"><span class="type ${p.type}">${p.type}</span><span>${fmtDate(p.date)}</span><span>by ${esc(p.author)}</span>
      ${names ? `<span class="tagline">${names}</span>` : ""}</div>
    <h2><a href="post.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h2>
    <p>${esc(p.summary)}</p></article>`;
}

async function initEditorials() {
  const [posts, data] = await Promise.all([load("data/posts.json"), load("data/prospects.json")]);
  const byId = Object.fromEntries(data.players.map((p) => [p.id, p]));
  let active = params.get("type") || "all";
  const chips = $("#type-chips");
  const render = () => {
    chips.innerHTML = ["all", ...TYPES].map((t) =>
      `<button class="chip ${t === active ? "on" : ""}" data-t="${t}">${t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)}</button>`).join("");
    const shown = posts.filter((p) => active === "all" || p.type === active);
    $("#feed").innerHTML = shown.length ? shown.map((p) => postCard(p, byId)).join("")
      : `<div class="card empty">No ${active} posts yet.</div>`;
  };
  chips.addEventListener("click", (e) => {
    const t = e.target.dataset.t;
    if (t) { active = t; render(); }
  });
  render();
}

async function initPost() {
  const [posts, data] = await Promise.all([load("data/posts.json"), load("data/prospects.json")]);
  const post = posts.find((p) => p.slug === params.get("slug"));
  const el = $("#article");
  if (!post) { el.innerHTML = `<div class="empty">Post not found. <a href="editorials.html">Back to editorials</a></div>`; return; }
  document.title = `${post.title} · ${SITE_NAME}`;
  const byId = Object.fromEntries(data.players.map((p) => [p.id, p]));
  const names = post.players.map((id) => byId[id]).filter(Boolean)
    .map((pl) => `<a href="player.html?id=${pl.id}">${esc(pl.name)}</a>`).join(", ");
  el.innerHTML = `<div class="meta"><span class="type ${post.type}">${post.type}</span><span>${fmtDate(post.date)}</span><span>by ${esc(post.author)}</span></div>
    <h1>${esc(post.title)}</h1>
    ${names ? `<div class="meta tagline">Players: ${names}</div>` : ""}
    <div class="body">${marked.parse(post.body)}</div>`;
}

// ---------- outside news ----------
const LANGS = { en: "English", sv: "Swedish", fi: "Finnish", cs: "Czech", sk: "Slovak", ru: "Russian", de: "German", no: "Norwegian" };
const translateUrl = (url) => `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(url)}`;

function newsItem(a, playersById, { compact = false } = {}) {
  const href = a.url || a.google_link;
  const names = a.players.map((id) => playersById[id]).filter(Boolean)
    .map((pl) => `<a href="player.html?id=${pl.id}">${esc(pl.name)}</a>`).join(", ");
  const foreign = a.lang && a.lang !== "en";
  return `<article class="card news-item">
    <div class="meta"><span class="outlet">${esc(a.source || "Unknown outlet")}</span><span>${fmtDate(a.published)}</span>
      ${foreign ? `<span class="lang" title="${esc(LANGS[a.lang] || a.lang)}">${esc(a.lang.toUpperCase())}</span>` : ""}</div>
    <h3><a href="${esc(href)}" target="_blank" rel="noopener">${esc(a.title)}</a></h3>
    ${compact ? "" : `<div class="meta">${names ? `<span class="tagline">${names}</span>` : ""}
      ${foreign && a.url ? `<a class="translate" href="${esc(translateUrl(a.url))}" target="_blank" rel="noopener">Read in English ↗</a>` : ""}</div>`}
  </article>`;
}

async function initExternalNews() {
  const [news, data] = await Promise.all([load("data/news.json"), load("data/prospects.json")]);
  const byId = Object.fromEntries(data.players.map((p) => [p.id, p]));
  const PAGE = 40;
  let limit = PAGE;
  $("#updated").textContent = `Checked ${fmtDate(news.updated)} · last ${news.days} days`;

  const counts = {};
  news.articles.forEach((a) => a.players.forEach((id) => { counts[id] = (counts[id] || 0) + 1; }));
  const players = Object.keys(counts).map(Number).filter((id) => byId[id]).sort((a, b) => byId[a].name.localeCompare(byId[b].name));
  $("#player").innerHTML = `<option value="">All prospects</option>` +
    players.map((id) => `<option value="${id}">${esc(byId[id].name)} (${counts[id]})</option>`).join("");
  const langs = [...new Set(news.articles.map((a) => a.lang))].filter((l) => l !== "en").sort();
  $("#lang").innerHTML = `<option value="">All languages</option><option value="en">English</option>
    <option value="other">Other languages</option>` + langs.map((l) => `<option value="${l}">${esc(LANGS[l] || l)}</option>`).join("");
  if (params.get("player")) $("#player").value = params.get("player");

  function render() {
    const q = $("#q").value.trim().toLowerCase(), pid = Number($("#player").value), lang = $("#lang").value;
    const shown = news.articles.filter((a) =>
      (!pid || a.players.includes(pid)) &&
      (!lang || (lang === "other" ? a.lang !== "en" : a.lang === lang)) &&
      (!q || a.title.toLowerCase().includes(q) || (a.source || "").toLowerCase().includes(q)));
    $("#news-count").textContent = `${shown.length} article${shown.length === 1 ? "" : "s"}`;
    $("#news-feed").innerHTML = shown.length ? shown.slice(0, limit).map((a) => newsItem(a, byId)).join("")
      : `<div class="card empty">No articles match.</div>`;
    $("#more").hidden = shown.length <= limit;
  }
  ["#q", "#player", "#lang"].forEach((s) => $(s).addEventListener("input", () => { limit = PAGE; render(); }));
  $("#more").addEventListener("click", () => { limit += PAGE; render(); });
  render();
}

// ---------- home ----------
async function initHome() {
  const safe = (p) => load(p).catch(() => null);
  const [posts, news, data, fx, standings, css, watch] = await Promise.all([
    safe("data/posts.json"), safe("data/news.json"), load("data/prospects.json"), load("data/nhle_factors.json"),
    safe("data/standings.json"), safe("data/css_rankings.json"), safe("data/draft_targets.json")]);
  const byId = Object.fromEntries(data.players.map((p) => [p.id, p]));
  const card = (href, title, body, cta) => `<section class="card home-card"><h2><a href="${href}">${title}</a></h2>${body}
    <a class="more-link" href="${href}">${cta} →</a></section>`;
  const cards = [];

  // Editorials
  const recent = (posts || []).slice(0, 3);
  cards.push(card("editorials.html", "Editorials", recent.length ? `<ul class="home-list">${recent.map((p) => `<li>
      <span class="type ${p.type}">${p.type}</span> <a href="post.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a>
      <span class="sub">${fmtDate(p.date)}</span></li>`).join("")}</ul>` : `<p class="sub">No posts yet.</p>`, "All editorials"));

  // Outside news
  const latest = (news?.articles || []).slice(0, 5);
  cards.push(card("news.html", "In the news", latest.length ? `<ul class="home-list">${latest.map((a) => `<li>
      <a href="${esc(a.url || a.google_link)}" target="_blank" rel="noopener">${esc(a.title)}</a>
      <span class="sub">${esc(a.source)} · ${fmtDate(a.published)}${a.lang !== "en" ? ` · ${esc(a.lang.toUpperCase())}` : ""}</span></li>`).join("")}</ul>`
    : `<p class="sub">No articles yet.</p>`, `All ${news?.articles?.length || ""} articles`));

  // Prospects: best NHL-equivalent pace this season (at least 5 games, non-NHL leagues)
  const lines = data.players.filter((p) => !isGoalie(p)).flatMap((p) => p.current
    .filter((r) => r.gp >= 5 && r.league !== "NHL").map((r) => ({ p, r, v: nhle(r, fx.factors) })))
    .filter((x) => x.v != null).sort((a, b) => b.v - a.v).slice(0, 5);
  cards.push(card("prospects.html", "Top NHLe pace", `<table class="home-table"><tbody>${lines.map(({ p, r, v }) => `<tr>
      <td><a href="player.html?id=${p.id}">${esc(p.name)}</a> <span class="sub">${esc(r.league)}</span></td>
      <td class="num sub">${r.pts} PTS / ${r.gp} GP</td><td class="num"><b>${v.toFixed(0)}</b></td></tr>`).join("")}</tbody></table>
      <p class="sub">NHL-equivalent points per 82 games, minimum 5 GP, NHL games excluded.</p>`, "All prospects"));

  // Mock lottery: where Detroit stands today
  if (standings) {
    const lottery = standings.teams.filter((t) => !t.playoff).slice(0, LOTTERY_ODDS.length);
    const seed = lottery.findIndex((t) => t.abbrev === "DET");
    let body;
    if (seed >= 0) {
      const m = lotteryMatrix()[seed];
      const likely = m.indexOf(Math.max(...m));
      body = `<div class="home-stats"><div><span>Lottery seed</span><b>${seed + 1} of ${lottery.length}</b></div>
        <div><span>#1 pick</span><b>${pct(m[0])}</b></div><div><span>Most likely</span><b>#${likely + 1}</b></div></div>`;
    } else {
      const det = standings.teams.find((t) => t.abbrev === "DET");
      body = `<p>Detroit is in a playoff spot today${det ? ` (${det.w}-${det.l}-${det.otl})` : ""}, so it has no lottery odds.</p>`;
    }
    body += `<p class="sub">Worst three right now: ${lottery.slice(0, 3).map((t) => esc(t.abbrev)).join(", ")} · standings through ${fmtDate(standings.updated)}</p>`;
    cards.push(card("lottery.html", "Mock Lottery", body, "Run the lottery"));
  }

  // Draft watch
  const year = css?.draftYear || watch?.draft_year;
  const ranked = Object.entries(css?.categories || {});
  const targets = (watch?.targets || []).filter((t) => !t.example);
  const draftBody = ranked.length
    ? `<ul class="home-list">${(ranked[0][1] || []).slice(0, 3).map((r) => `<li><b>${r.finalRank ?? r.midtermRank ?? ""}</b> ${esc(r.firstName)} ${esc(r.lastName)}
        <span class="sub">${esc(r.positionCode)} · ${esc(r.lastAmateurClub)}</span></li>`).join("")}</ul><p class="sub">${esc(ranked[0][0])}, NHL Central Scouting</p>`
    : `<p>${targets.length ? `${targets.length} players on the watchlist.` : "Watchlist coming soon."} NHL Central Scouting's ${year} rankings appear here once they're published.</p>`;
  cards.push(card("draft.html", `${year} Draft Watch`, draftBody, "Draft Watch"));

  $("#home-cards").innerHTML = cards.join("");
  $("#home-updated").textContent = `Stats through ${fmtDate(data.updated)} · ${data.players.length} prospects tracked`;
}

// ---------- organization roster ----------
// Every stat the NHL API can return for a season line, in display order. Each league's table shows only
// the columns that league actually reports (the NHL has far more detail than the AHL or junior leagues).
const SKATER_STATS = [
  ["gamesPlayed", "GP"], ["goals", "G"], ["assists", "A"], ["points", "PTS", (v) => `<b>${v}</b>`],
  // Rates and NHL equivalents (added to each line by addRates below, prefixed with "_").
  ["_ppg", "P/G", (v) => v.toFixed(2)], ["_gpg", "G/G", (v) => v.toFixed(2)], ["_apg", "A/G", (v) => v.toFixed(2)],
  ["plusMinus", "+/-", (v) => (v > 0 ? `+${v}` : v)], ["pim", "PIM"], ["powerPlayGoals", "PPG"],
  ["powerPlayPoints", "PPP"], ["shorthandedGoals", "SHG"], ["shorthandedPoints", "SHP"],
  ["gameWinningGoals", "GWG"], ["otGoals", "OTG"], ["shots", "S"],
  ["shootingPctg", "S%", (v) => (v * 100).toFixed(1)], ["avgToi", "TOI", (v) => v, (v) => toiSeconds(v)],
  ["faceoffWinningPctg", "FO%", (v) => (v ? (v * 100).toFixed(1) : "–")],
  // NHL-only rates: they need ice time, shots and special-teams splits, which only NHL lines carry.
  ["_p60", "P/60", (v) => v.toFixed(2)], ["_g60", "G/60", (v) => v.toFixed(2)], ["_spg", "S/GP", (v) => v.toFixed(2)],
  ["_evp", "EVP"], ["_pp_share", "PP%", (v) => (v * 100).toFixed(0)],
  ["_nhle", "NHLe", (v) => `<b>${v.toFixed(0)}</b>`], ["_nhle_g", "NHLe G", (v) => v.toFixed(0)],
  ["_nhle_a", "NHLe A", (v) => v.toFixed(0)],
];

// Per-game rates for any skater line, plus NHL-equivalent points/goals/assists over 82 games
// when the league has a factor in nhle_factors.json (the NHL itself is 1.0).
function addRates(stats, factor) {
  const gp = stats.gamesPlayed;
  if (!gp || stats.points == null) return;
  stats._ppg = stats.points / gp;
  stats._gpg = (stats.goals ?? 0) / gp;
  stats._apg = (stats.assists ?? 0) / gp;
  if (factor != null) {
    stats._nhle = stats._ppg * factor * 82;
    stats._nhle_g = stats._gpg * factor * 82;
    stats._nhle_a = stats._apg * factor * 82;
  }
  if (stats.avgToi) {
    const hours = (toiSeconds(stats.avgToi) * gp) / 3600; // total ice time in hours
    if (hours > 0) {
      stats._p60 = stats.points / hours;
      stats._g60 = (stats.goals ?? 0) / hours;
    }
  }
  if (stats.shots != null) stats._spg = stats.shots / gp;
  if (stats.powerPlayPoints != null && stats.shorthandedPoints != null) {
    stats._evp = stats.points - stats.powerPlayPoints - stats.shorthandedPoints;
    if (stats.points > 0) stats._pp_share = stats.powerPlayPoints / stats.points;
  }
}

// Goals saved above average: goals a league-average goalie would have allowed on the same shots,
// minus goals actually allowed. Positive = better than average. Needs the league's save % (NHL only).
function addGoalieRates(stats, leagueSavePct) {
  if (leagueSavePct == null || stats.shotsAgainst == null || stats.goalsAgainst == null) return;
  stats._gsaa = stats.shotsAgainst * (1 - leagueSavePct) - stats.goalsAgainst;
}
const GOALIE_STATS = [
  ["gamesPlayed", "GP"], ["gamesStarted", "GS"], ["wins", "W"], ["losses", "L"], ["otLosses", "OTL"],
  ["shotsAgainst", "SA"], ["goalsAgainst", "GA"], ["savePctg", "SV%", (v) => svp(v)],
  ["goalsAgainstAvg", "GAA", (v) => v.toFixed(2)],
  ["_gsaa", "GSAA", (v) => `<b class="${v >= 0 ? "pos" : "neg"}">${v > 0 ? "+" : ""}${v.toFixed(1)}</b>`],
  ["shutouts", "SO"],
  ["timeOnIce", "TOI", (v) => v, (v) => toiSeconds(v)],
];
// Skater tables open compact (the stats most people want); "Show all columns" adds the rest and
// scrolls sideways inside its frame when the screen is too narrow. keys: null = every column.
const SKATER_VIEWS = {
  compact: { label: "Compact", keys: ["gamesPlayed", "goals", "assists", "points", "_ppg", "plusMinus", "pim",
    "powerPlayPoints", "shots", "avgToi", "_nhle"] },
  all: { label: "Show all columns", keys: null },
};
const LEAGUE_ORDER = ["NHL", "AHL", "ECHL"];
const toiSeconds = (t) => { const [m, s] = String(t).split(":").map(Number); return (m || 0) * 60 + (s || 0); };
const epLink = (name) => `https://www.eliteprospects.com/search/player?q=${encodeURIComponent(name)}`;

async function initRoster() {
  const [roster, prospects, fx] = await Promise.all([load("data/roster.json"), load("data/prospects.json"), load("data/nhle_factors.json")]);
  const averages = roster.league_averages || {};
  roster.players.forEach((p) => p.lines.forEach((l) => {
    if (p.pos === "G") addGoalieRates(l.stats, averages[l.league]?.save_pct);
    else addRates(l.stats, fx.factors[l.league]);
  }));
  const prospectIds = new Set(prospects.players.map((p) => p.id));
  $("#updated").textContent = `Stats through ${fmtDate(roster.updated)} · ${seasonLabel(roster.season)} regular season · ${roster.players.length} players`;

  // One row per player per league this season, so a call-up appears under both leagues.
  const byLeague = {};
  roster.players.forEach((p) => p.lines.forEach((line) => {
    (byLeague[line.league] ||= []).push({ p, line, also: p.lines.filter((l) => l !== line).map((l) => l.league) });
  }));
  const leagues = Object.keys(byLeague).sort((a, b) => {
    const ia = LEAGUE_ORDER.indexOf(a), ib = LEAGUE_ORDER.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return byLeague[b].length - byLeague[a].length || a.localeCompare(b);
  });
  const idle = roster.players.filter((p) => !p.lines.length);

  $("#league-chips").innerHTML = leagues.map((l) => `<a class="chip" href="#league-${esc(l)}">${esc(l)} <span class="sub">${byLeague[l].length}</span></a>`).join("")
    + (idle.length ? `<a class="chip" href="#league-none">No games yet <span class="sub">${idle.length}</span></a>` : "");

  const sortState = {}; // table id -> [key, asc]
  const nameCell = (p) => {
    const href = prospectIds.has(p.id) ? `player.html?id=${p.id}` : `https://www.nhl.com/player/${p.id}`;
    return `<a href="${href}"${prospectIds.has(p.id) ? "" : ' target="_blank" rel="noopener"'}>${esc(p.name)}</a>`;
  };

  let view = "compact";
  try { if (SKATER_VIEWS[localStorage.getItem("rosterView")]) view = localStorage.getItem("rosterView"); } catch {}

  function table(id, rows, defs, showTeam) {
    const keys = defs === SKATER_STATS ? SKATER_VIEWS[view].keys : null;
    const inView = keys ? new Set(keys) : null;
    const cols = defs.filter(([k]) => (!inView || inView.has(k)) && rows.some((r) => r.line.stats[k] != null));
    const defaultKey = cols.some((c) => c[0] === "points") ? "points" : "gamesPlayed"; // skaters by points, goalies by games
    const [sortKey, asc] = sortState[id] || [defaultKey, false];
    const val = (r, key) => {
      if (key === "name") return r.p.name;
      if (key === "number") return r.p.number ?? 999;
      if (key === "age") return r.p.age ?? 99;
      if (key === "team") return r.line.team;
      const def = cols.find((c) => c[0] === key), v = r.line.stats[key];
      return v == null ? -Infinity : def?.[3] ? def[3](v) : v;
    };
    const sorted = [...rows].sort((a, b) => {
      const x = val(a, sortKey), y = val(b, sortKey);
      const c = typeof x === "string" ? x.localeCompare(y) : x - y;
      return (asc ? c : -c) || a.p.name.localeCompare(b.p.name);
    });
    const head = [["number", "#", "num"], ["name", "Player", ""], ["pos", "Pos", ""], ["age", "Age", "num"],
      ...(showTeam ? [["team", "Team", ""]] : []), ...cols.map(([k, label]) => [k, label, "num"])];
    return `<div class="table-wrap glow-frame"><div class="table-scroll"><table class="roster-table" data-table="${id}">
      <thead><tr>${head.map(([k, label, cls]) => `<th class="sortable ${cls} ${k === sortKey ? `sorted${asc ? " asc" : ""}` : ""}" data-k="${k}">${label}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map(({ p, line, also }) => `<tr class="${p.on_nhl_roster ? "nhl-roster" : ""}">
        <td class="num sub" data-label="#">${p.number ?? ""}</td>
        <td class="player-cell c-player">${nameCell(p)}
          ${prospectIds.has(p.id) ? `<span class="flag">Prospect</span>` : ""}
          ${also.length ? `<span class="flag also" title="Also played in ${esc(also.join(", "))} this season">+ ${esc(also.join(", "))}</span>` : ""}
          <a class="ep" href="${epLink(p.name)}" target="_blank" rel="noopener" title="Elite Prospects profile">EP</a></td>
        <td data-label="Pos">${posLabel(p.pos)}</td><td class="num" data-label="Age">${p.age ?? "–"}</td>
        ${showTeam ? `<td class="sub c-wide" data-label="Team">${esc(line.team)}</td>` : ""}
        ${cols.map(([k, label, fmt]) => { const v = line.stats[k];
          return `<td class="num" data-label="${label}">${v == null ? "–" : fmt ? fmt(v) : v}</td>`; }).join("")}
      </tr>`).join("")}</tbody></table></div></div>`;
  }

  function render() {
    $("#stat-view").innerHTML = Object.entries(SKATER_VIEWS).map(([k, v]) =>
      `<button type="button" class="chip ${k === view ? "on" : ""}" data-view="${k}">${v.label}</button>`).join("");
    const q = $("#q").value.trim().toLowerCase();
    const match = (p) => !q || p.name.toLowerCase().includes(q);
    $("#roster").innerHTML = leagues.map((league) => {
      const rows = byLeague[league].filter((r) => match(r.p));
      if (!rows.length) return "";
      const teams = [...new Set(rows.map((r) => r.line.team))];
      const skaters = rows.filter((r) => r.p.pos !== "G"), goalies = rows.filter((r) => r.p.pos === "G");
      return `<section class="league-block" id="league-${esc(league)}">
        <h2 class="section">${esc(league)} <span class="sub">${teams.length === 1 ? esc(teams[0]) : `${teams.length} teams`} · ${rows.length} player${rows.length === 1 ? "" : "s"}</span></h2>
        ${skaters.length ? table(`${league}-s`, skaters, SKATER_STATS, teams.length > 1) : ""}
        ${goalies.length ? `<h3 class="subhead">Goalies</h3>${table(`${league}-g`, goalies, GOALIE_STATS, teams.length > 1)}` : ""}
      </section>`;
    }).join("") + (idle.filter(match).length ? `<section class="league-block" id="league-none">
        <h2 class="section">No games yet this season <span class="sub">injured, unsigned or not yet playing</span></h2>
        <div class="feed idle-list">${idle.filter(match).map((p) => `<div class="card idle-card">${nameCell(p)} <span class="flag">${posLabel(p.pos)}</span>
          ${p.last_team ? `<span class="sub">Last: ${esc(p.last_team.team)} (${esc(p.last_team.league)}, ${seasonLabel(p.last_team.season)})</span>` : ""}
          <a class="ep" href="${epLink(p.name)}" target="_blank" rel="noopener" title="Elite Prospects profile">EP</a></div>`).join("")}</div></section>` : "")
      || `<div class="card empty">No players match.</div>`;
  }

  $("#roster").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    const id = th.closest("table").dataset.table, k = th.dataset.k;
    const [cur, asc] = sortState[id] || [];
    sortState[id] = [k, cur === k ? !asc : ["name", "number", "age", "team", "goalsAgainstAvg", "goalsAgainst", "losses"].includes(k)];
    render();
  });
  $("#q").addEventListener("input", render);
  $("#stat-view").addEventListener("click", (e) => {
    const v = e.target.closest("[data-view]")?.dataset.view;
    if (!v || v === view) return;
    view = v;
    try { localStorage.setItem("rosterView", v); } catch {}
    Object.keys(sortState).forEach((k) => { if (k.endsWith("-s")) delete sortState[k]; }); // sort keys differ per view
    render();
  });
  render();
}

// ---------- prospects table ----------
function statLines(p) {
  // One line per league this season; fall back to last season for players who haven't played yet.
  if (p.current.length) return p.current.map((r) => ({ ...r, stale: false }));
  return p.previous.length ? p.previous.map((r) => ({ ...r, stale: true })) : [{ league: "", team: "", gp: 0, stale: true, none: true }];
}

function sortRows(rows, key, asc) {
  const missing = (v) => v == null || Number.isNaN(v) || v === Infinity;
  return rows.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1; // last-season fallback lines always sit at the bottom
    const x = a[key], y = b[key];
    if (missing(x) || missing(y)) return missing(x) - missing(y); // blanks last in either direction
    if (typeof x === "string" || typeof y === "string") return asc ? String(x).localeCompare(y) : String(y).localeCompare(x);
    return asc ? x - y : y - x;
  });
}

async function initProspects() {
  const [data, fx] = await Promise.all([load("data/prospects.json"), load("data/nhle_factors.json")]);
  const factors = fx.factors;
  $("#updated").textContent = `Stats through ${fmtDate(data.updated)} · ${seasonLabel(data.season)} regular season`;

  const rows = data.players.flatMap((p) => statLines(p).map((r) => ({
    p, ...r,
    name: p.name, age: p.age, shoots: p.shoots, group: posGroup(p.pos),
    pick: p.draft ? p.draft.overallPick + p.draft.year * 1000 : Infinity,
    ppg: r.pts != null && r.gp ? r.pts / r.gp : null,
    factor: factors[r.league] ?? null,
    nhle: r.pts != null ? nhle(r, factors) : null,
  })));

  const leagues = [...new Set(rows.filter((r) => r.league).map((r) => r.league))].sort();
  $("#league").innerHTML = `<option value="">All leagues</option>` + leagues.map((l) => `<option>${esc(l)}</option>`).join("");

  let tab = "skaters", sortKey = "nhle", asc = false;
  const state = () => ({
    q: $("#q").value.trim().toLowerCase(),
    pos: $("#pos").value, league: $("#league").value,
    nhl: $("#show-nhl").checked, stale: $("#show-stale").checked,
  });

  const ASC_FIRST = ["name", "shoots", "league", "pick", "age", "gaa"];
  const small = (r) => (r.gp && r.gp < SMALL_SAMPLE ? "*" : "");
  // [sort key, header label, cell class, cell html]. Classes starting with "c-" place the cell in the phone card layout.
  const lead = [
    ["name", "Player", "player-cell c-player", (r) => `<a href="player.html?id=${r.p.id}">${esc(r.name)}</a>
      <span class="flag">${posLabel(r.p.pos)}</span>${r.p.on_nhl_roster ? `<span class="flag nhl">DET</span>` : ""}`],
    ["league", "League / Team", "c-wide", (r) => `${esc(r.league) || "–"}${r.stale ? ` <span class="sub">${r.none ? "no stats" : seasonLabel(r.season)}</span>` : ""}
      <div class="sub">${esc(r.team)}</div>`],
    ["pick", "Drafted", "sub c-wide", (r) => esc(draftShort(r.p.draft))],
    ["age", "Age", "num", (r) => r.age ?? "–"],
  ];
  const skaterCols = [...lead,
    ["shoots", "Shoots", "", (r) => esc(r.shoots ?? "–")],
    ["gp", "GP", "num", (r) => r.gp + small(r)],
    ["g", "G", "num", (r) => r.g ?? "–"], ["a", "A", "num", (r) => r.a ?? "–"],
    ["pts", "PTS", "num", (r) => `<b>${r.pts ?? "–"}</b>`],
    ["ppg", "P/GP", "num", (r) => fixed(r.ppg)],
    ["factor", "Factor", "num sub", (r) => r.factor ?? "–"],
    ["nhle", "NHLe / 82", "num c-nhle", null],
  ];
  const goalieCols = [...lead,
    ["shoots", "Catches", "", (r) => esc(r.shoots ?? "–")],
    ["gp", "GP", "num", (r) => r.gp + small(r)],
    ["w", "W", "num", (r) => r.w ?? "–"], ["l", "L", "num", (r) => r.l ?? "–"],
    ["svp", "SV%", "num", (r) => svp(r.svp)], ["gaa", "GAA", "num", (r) => fixed(r.gaa)],
    ["so", "SO", "num", (r) => r.so ?? "–"],
  ];

  function render() {
    const s = state();
    const cols = tab === "skaters" ? skaterCols : goalieCols;
    let shown = rows.filter((r) =>
      (tab === "goalies") === (r.group === "G") &&
      (!s.pos || r.group === s.pos) &&
      (!s.league || r.league === s.league) &&
      (s.nhl || r.league !== "NHL") &&
      (s.stale || !r.stale) &&
      (!s.q || r.name.toLowerCase().includes(s.q) || r.team.toLowerCase().includes(s.q)));
    const key = cols.some((c) => c[0] === sortKey) ? sortKey : (tab === "skaters" ? "nhle" : "svp");
    shown = sortRows(shown, key, asc);
    const maxN = Math.max(20, ...shown.map((r) => r.nhle || 0));

    $("#thead").innerHTML = `<tr>${cols.map(([k, label, cls]) =>
      `<th class="sortable ${cls} ${k === key ? "sorted" + (asc ? " asc" : "") : ""}" data-k="${k}">${label}</th>`).join("")}</tr>`;
    $("#sort").innerHTML = cols.map(([k, label]) => `<option value="${k}" ${k === key ? "selected" : ""}>${label}</option>`).join("");
    $("#sort-dir").textContent = asc ? "▴ Low to high" : "▾ High to low";
    $("#tbody").innerHTML = shown.length ? shown.map((r) => `<tr class="${r.stale ? "dim" : ""}">${cols.map(([k, label, cls, cell]) =>
      k === "nhle" ? nhleCell(r.nhle, maxN, label) : `<td class="${cls}" data-label="${label}">${cell(r)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${cols.length}" class="empty">No players match.</td></tr>`;
    $("#pos").style.display = tab === "skaters" ? "" : "none";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  }

  const setSort = (k) => {
    if (k === sortKey) asc = !asc;
    else { sortKey = k; asc = ASC_FIRST.includes(k); }
    render();
  };
  $("#thead").addEventListener("click", (e) => e.target.dataset.k && setSort(e.target.dataset.k));
  $("#sort").addEventListener("change", (e) => setSort(e.target.value));
  $("#sort-dir").addEventListener("click", () => { asc = !asc; render(); });
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    tab = t.dataset.tab; sortKey = tab === "skaters" ? "nhle" : "svp"; asc = false; render();
  }));
  ["#q", "#pos", "#league", "#show-nhl", "#show-stale"].forEach((s) => $(s).addEventListener("input", render));
  render();
}

// ---------- player page ----------
async function initPlayer() {
  const [data, fx, posts, news] = await Promise.all([load("data/prospects.json"), load("data/nhle_factors.json"),
    load("data/posts.json"), load("data/news.json").catch(() => ({ articles: [] }))]);
  const p = data.players.find((x) => x.id === Number(params.get("id")));
  const el = $("#player");
  if (!p) { el.innerHTML = `<div class="empty">Player not found. <a href="prospects.html">Back to prospects</a></div>`; return; }
  document.title = `${p.name} · ${SITE_NAME}`;
  const g = isGoalie(p);
  const lines = [...p.current, ...p.previous];
  const head = g ? `<th>Season</th><th>League</th><th>Team</th><th class="num">GP</th><th class="num">W</th><th class="num">L</th><th class="num">SV%</th><th class="num">GAA</th><th class="num">SO</th>`
    : `<th>Season</th><th>League</th><th>Team</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">PTS</th><th class="num">P/GP</th><th class="num">NHLe / 82</th>`;
  const maxN = Math.max(20, ...lines.map((r) => nhle(r, fx.factors) || 0));
  const body = lines.map((r) => g
    ? `<tr><td>${seasonLabel(r.season)}</td><td>${esc(r.league)}</td><td>${esc(r.team)}</td><td class="num">${r.gp}</td><td class="num">${r.w ?? "–"}</td><td class="num">${r.l ?? "–"}</td><td class="num">${svp(r.svp)}</td><td class="num">${fixed(r.gaa)}</td><td class="num">${r.so ?? "–"}</td></tr>`
    : `<tr><td>${seasonLabel(r.season)}</td><td>${esc(r.league)}</td><td>${esc(r.team)}</td><td class="num">${r.gp}</td><td class="num">${r.g}</td><td class="num">${r.a}</td><td class="num"><b>${r.pts}</b></td><td class="num">${fixed(ppg(r))}</td>${nhleCell(nhle(r, fx.factors), maxN)}</tr>`).join("");
  const mine = posts.filter((x) => x.players.includes(p.id));
  const inNews = news.articles.filter((a) => a.players.includes(p.id));
  el.innerHTML = `<div class="profile">
      <img src="${esc(p.headshot)}" alt="" onerror="this.style.visibility='hidden'">
      <div><h1>${esc(p.name)}${p.on_nhl_roster ? ` <span class="flag nhl">On DET roster</span>` : ""}</h1>
      <div class="facts">
        <div>Position<b>${posLabel(p.pos)}</b></div>
        <div>${isGoalie(p) ? "Catches" : "Shoots"}<b>${p.shoots ?? "–"}</b></div>
        <div>Age<b>${p.age ?? "–"}</b></div>
        <div>Size<b>${heightFt(p.height)}, ${p.weight ?? "–"} lb</b></div>
        <div>Born<b>${p.country ?? "–"}</b></div>
        <div>Drafted<b>${esc(draftLabel(p.draft))}</b></div>
        <div>NHL GP<b>${p.nhl_gp}</b></div>
      </div></div></div>
    <section><h2 class="section">${seasonLabel(data.season - 10001)} and ${seasonLabel(data.season)}</h2>
      <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="9" class="empty">No stats yet.</td></tr>`}</tbody></table></div>
      <p class="footnote">Regular season only. Tournaments (WJC, Hlinka) show no NHLe.</p></section>
    <section><h2 class="section">Our coverage</h2>
      <div class="feed">${mine.length ? mine.map((x) => postCard(x, { [p.id]: p })).join("") : `<div class="card empty">No posts about ${esc(p.name)} yet.</div>`}</div></section>
    <section><h2 class="section">In the news</h2>
      <div class="feed">${inNews.length ? inNews.slice(0, 8).map((a) => newsItem(a, { [p.id]: p })).join("") : `<div class="card empty">No recent outside articles.</div>`}</div>
      ${inNews.length > 8 ? `<p><a href="news.html?player=${p.id}">All ${inNews.length} articles about ${esc(p.name)} →</a></p>` : ""}</section>`;
}

// ---------- draft watch ----------
async function initDraft() {
  const [watch, css, fx] = await Promise.all([load("data/draft_targets.json"), load("data/css_rankings.json"), load("data/nhle_factors.json")]);
  $("#draft-year").textContent = css.draftYear || watch.draft_year;
  const targets = watch.targets.filter((t) => !t.example);
  const maxN = Math.max(20, ...targets.map((t) => nhle({ ...t, pts: t.g + t.a }, fx.factors) || 0));
  $("#watch").innerHTML = targets.length ? `<div class="table-wrap"><table><thead><tr>
      <th>Player</th><th>Born</th><th>League</th><th>Team</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">PTS</th><th class="num">P/GP</th><th class="num">NHLe / 82</th><th>Notes</th></tr></thead><tbody>
      ${targets.map((t) => {
        const r = { ...t, pts: t.g + t.a };
        return `<tr><td class="player-cell"><b>${esc(t.name)}</b><span class="flag">${esc(posLabel(t.pos))}</span></td><td class="sub">${esc(t.born)}</td><td>${esc(t.league)}</td><td class="sub">${esc(t.team)}</td>
          <td class="num">${t.gp}</td><td class="num">${t.g}</td><td class="num">${t.a}</td><td class="num"><b>${r.pts}</b></td><td class="num">${fixed(ppg(r))}</td>${nhleCell(nhle(r, fx.factors), maxN)}
          <td class="sub" style="white-space:normal;min-width:220px">${esc(t.notes)}</td></tr>`;
      }).join("")}</tbody></table></div>`
    : `<div class="card empty">No targets yet. Add players to <code>data/draft_targets.json</code>.</div>`;

  const cats = Object.entries(css.categories || {});
  $("#css").innerHTML = cats.length ? cats.map(([cat, list]) => `<h3>${esc(cat)}</h3><div class="table-wrap"><table><thead><tr>
      <th class="num">Rank</th><th>Player</th><th>Pos</th><th>Club</th><th>League</th><th>Ht / Wt</th><th>Born</th></tr></thead><tbody>
      ${list.slice(0, 64).map((r) => `<tr><td class="num">${cssRank(r) ?? "–"}</td><td><b>${esc(r.firstName)} ${esc(r.lastName)}</b></td><td>${esc(r.positionCode)}</td>
        <td class="sub">${esc(r.lastAmateurClub)}</td><td>${esc(r.lastAmateurLeague)}</td><td class="sub">${heightFt(r.heightInInches)} / ${r.weightInPounds ?? "–"}</td><td class="sub">${esc(r.birthDate)}</td></tr>`).join("")}
      </tbody></table></div>`).join("")
    : `<div class="card empty">NHL Central Scouting hasn't published ${css.draftYear || watch.draft_year} rankings yet. The updater adds them automatically once it does.</div>`;
}

// ---------- draft big board (from NHL Central Scouting) ----------
// Central Scouting ranks four separate lists: North American and International skaters and goalies.
// To build one board, skaters from both lists are interleaved by how high they sit in their own list
// (rank / list length), and goalies are slotted in every `goalie_spacing` picks (top goalie ~15th).
// data/draft_board_overrides.json can pin players to the top, drop players, or change the spacing.
const CSS_RANK_KEYS = ["finalRank", "midtermRank", "rank", "preliminaryRank"];

function cssRank(r) {
  for (const k of CSS_RANK_KEYS) if (typeof r[k] === "number") return r[k];
  const k = Object.keys(r).find((x) => /rank/i.test(x) && typeof r[x] === "number");
  return k ? r[k] : null;
}

function cssStage(categories) {
  const rows = Object.values(categories).flat();
  if (rows.some((r) => typeof r.finalRank === "number")) return "final rankings";
  if (rows.some((r) => typeof r.midtermRank === "number")) return "midterm rankings";
  return "preliminary list";
}

function buildBigBoard(css, overrides = {}) {
  const cats = Object.entries(css?.categories || {});
  if (!cats.length) return [];
  const fullName = (r) => `${r.firstName} ${r.lastName}`;
  const removed = new Set((overrides.remove || []).map((s) => s.toLowerCase()));
  const pool = (match) => cats.filter(([name]) => match.test(name)).flatMap(([name, list]) => {
    const ranked = list.filter((r) => cssRank(r) != null);
    return ranked.map((r) => ({ ...r, name: fullName(r), list: name, cssRank: cssRank(r), score: cssRank(r) / ranked.length }));
  }).filter((r) => !removed.has(r.name.toLowerCase()))
    .sort((a, b) => a.score - b.score || a.cssRank - b.cssRank);

  const skaters = pool(/skater/i), goalies = pool(/goalie/i);
  const spacing = overrides.goalie_spacing || 15;
  const board = [...skaters];
  goalies.forEach((g, i) => board.splice(Math.min(board.length, (i + 1) * spacing - 1), 0, g));

  // Hand-pinned players go first, in the order given.
  const pins = (overrides.pin_top || []).map((s) => s.toLowerCase());
  const pinned = pins.map((p) => board.find((r) => r.name.toLowerCase() === p)).filter(Boolean);
  return [...pinned, ...board.filter((r) => !pinned.includes(r))];
}

// ---------- mock draft lottery ----------
// Official NHL odds (out of 1,000 combinations) for the 16 non-playoff teams, worst record first.
const LOTTERY_ODDS = [185, 135, 115, 95, 85, 75, 65, 60, 50, 35, 30, 25, 20, 15, 5, 5].map((n) => n / 1000);
const MAX_JUMP = 10; // a lottery winner can move up at most 10 spots

// Standings order after draw 1: the winner moves up (to #1, or 10 spots if it isn't eligible) and
// the teams it passed slide down one.
function afterFirstDraw(w1, n = LOTTERY_ODDS.length) {
  const order = [...Array(n).keys()];
  order.splice(w1, 1);
  order.splice(w1 <= MAX_JUMP ? 0 : w1 - MAX_JUMP, 0, w1);
  return order;
}

// Team that holds #1 after draw 1: the winner, or the worst team when the winner was too low to reach #1.
const firstPickHolder = (w1) => (w1 <= MAX_JUMP ? w1 : 0);

// Final order of the 16 lottery seeds (0 = worst team) given the two draw winners.
function lotteryOrder(w1, w2, n = LOTTERY_ODDS.length) {
  const current = afterFirstDraw(w1, n);
  const slot = Array(n).fill(null);
  // Draw 1 results are locked: #1, plus the winner's spot if it could only jump 10.
  slot[0] = firstPickHolder(w1);
  if (w1 > MAX_JUMP) slot[w1 - MAX_JUMP] = w1;
  // Draw 2: the winner moves up at most 10 spots from where it sits after draw 1,
  // taking the best open spot from there.
  let p = Math.max(1, current.indexOf(w2) - MAX_JUMP);
  while (slot[p] !== null) p++;
  slot[p] = w2;
  // Everyone else fills the open spots in order.
  const rest = current.filter((s) => !slot.includes(s));
  return slot.map((s) => (s === null ? rest.shift() : s));
}

// Draw 2 excludes the draw-1 winner and whoever holds #1 (the same team unless the worst team kept #1).
const secondDrawExcluded = (w1) => new Set([w1, firstPickHolder(w1)]);

// Exact odds of each seed landing at each pick, from every possible pair of draw winners.
function lotteryMatrix() {
  const n = LOTTERY_ODDS.length;
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  for (let w1 = 0; w1 < n; w1++) {
    const excluded = secondDrawExcluded(w1); // their combinations are redrawn
    const remaining = LOTTERY_ODDS.reduce((sum, o, i) => sum + (excluded.has(i) ? 0 : o), 0);
    for (let w2 = 0; w2 < n; w2++) {
      if (excluded.has(w2)) continue;
      const p = LOTTERY_ODDS[w1] * (LOTTERY_ODDS[w2] / remaining);
      lotteryOrder(w1, w2).forEach((seed, pick) => { m[seed][pick] += p; });
    }
  }
  return m;
}

function drawBall(excluded = new Set()) {
  const total = LOTTERY_ODDS.reduce((sum, o, i) => sum + (excluded.has(i) ? 0 : o), 0);
  let r = Math.random() * total;
  let last = 0;
  for (let i = 0; i < LOTTERY_ODDS.length; i++) {
    if (excluded.has(i)) continue;
    last = i;
    r -= LOTTERY_ODDS[i];
    if (r < 0) return i;
  }
  return last;
}

function simulateLottery() {
  const w1 = drawBall();
  const w2 = drawBall(secondDrawExcluded(w1));
  return { w1, w2, order: lotteryOrder(w1, w2) };
}

// Percent text for a probability. A real chance too small to show at this precision reads ">0.0" rather than "0.0".
const pctNum = (v, digits = 1) => {
  if (!(v > 0)) return "";
  const s = (v * 100).toFixed(digits);
  return Number(s) === 0 ? `>${s}` : s;
};
const pct = (v, digits = 1) => (v > 0 ? `${pctNum(v, digits)}%` : "–");

async function initLottery() {
  const [standings, owners, css, boardOverrides] = await Promise.all([load("data/standings.json"), load("data/pick_owners.json"),
    load("data/css_rankings.json").catch(() => null), load("data/draft_board_overrides.json").catch(() => ({}))]);
  const board = css?.draftYear === owners.draft_year ? buildBigBoard(css, boardOverrides) : [];
  const prospectCell = (pick) => {
    const r = board[pick - 1];
    if (!board.length) return "";
    if (!r) return `<td class="mock-pick sub">–</td>`;
    return `<td class="mock-pick"><b>${esc(r.name)}</b><span class="sub">${esc(r.positionCode)} · ${esc(r.lastAmateurClub)} (${esc(r.lastAmateurLeague)})</span></td>`;
  };
  const n = LOTTERY_ODDS.length;
  const lottery = standings.teams.filter((t) => !t.playoff).slice(0, n); // already sorted worst first
  const playoff = standings.teams.filter((t) => t.playoff);
  const matrix = lotteryMatrix();
  const traded = owners.picks || {};
  const FOCUS = "DET";

  $("#draft-year").textContent = owners.draft_year;
  if (owners.source) {
    $("#picks-source").innerHTML = `from <a href="${esc(owners.source.url)}">${esc(owners.source.name)}</a> (last checked ${fmtDate(owners.updated)})`;
  }
  $("#updated").textContent = `Standings through ${fmtDate(standings.updated)} · teams ranked by points percentage`;

  const logo = (t) => {
    const dark = document.documentElement.dataset.theme === "dark";
    return `<img class="logo" src="${esc(dark ? t.logo.replace("_light", "_dark") : t.logo)}" alt="" loading="lazy">`;
  };
  const team = (abbrev) => standings.teams.find((x) => x.abbrev === abbrev);
  // Who holds team t's pick when it lands at `pick` (1-based). Without a pick number, shows the deal's headline owner.
  const holder = (t, pick) => {
    const deal = traded[t.abbrev];
    if (!deal) return { shown: t };
    const isProtected = pick != null && deal.protected_top && pick <= deal.protected_top;
    if (isProtected) {
      return { shown: (deal.protected_owner && team(deal.protected_owner)) || t, deal,
        sub: `Protected at #${pick}`, note: deal.protected_label || `stays with ${t.abbrev}` };
    }
    return { shown: team(deal.owner) || t, deal, sub: `via ${t.abbrev}`, note: deal.note };
  };
  const teamCell = (t, pick = null) => {
    const { shown, deal, sub, note } = holder(t, pick);
    const tip = [deal?.condition, deal?.detail].filter(Boolean).join("\n\n");
    return `<td class="team-cell"${tip ? ` title="${esc(tip)}"` : ""}>${logo(shown)}<span><b class="full">${esc(shown.name)}</b><b class="abbr">${esc(shown.abbrev)}</b>
      ${sub ? `<span class="sub">${esc(sub)}${note ? `<span class="deal-note"> · ${esc(note)}</span>` : ""}</span>` : ""}</span></td>`;
  };
  const isFocus = (t, pick = null) => holder(t, pick).shown.abbrev === FOCUS;
  const record = (t) => `${t.w}-${t.l}-${t.otl}`;
  const ptsPct = (t) => t.pts_pct.toFixed(3).replace(/^0/, "");
  // Record and Pts% always belong to the team whose finish sets the pick. When another team holds it,
  // tag the numbers with that original team so a club listed twice isn't shown with two different records.
  const standingCells = (t, pick) => {
    const tag = holder(t, pick).shown.abbrev !== t.abbrev ? `<span class="orig-tag">${esc(t.abbrev)}</span>` : "";
    return `<td class="num hide-sm">${tag}${record(t)}</td><td class="num hide-xs">${tag}${ptsPct(t)}</td>`;
  };

  let result = null; // last simulated lottery

  function renderOrder() {
    const order = result ? result.order : [...Array(n).keys()];
    const winners = result ? [result.w1, result.w2] : [];
    const rows = order.map((seed, pick) => {
      const t = lottery[seed];
      const move = seed - pick;
      const moveCell = move > 0 ? `<span class="move up">▲ ${move}</span>`
        : move < 0 ? `<span class="move down">▼ ${-move}</span>` : `<span class="move">–</span>`;
      return `<tr class="${isFocus(t, pick + 1) ? "focus" : ""} ${winners.includes(seed) ? "winner" : ""}">
        <td class="num pick">${pick + 1}</td>${teamCell(t, pick + 1)}
        ${standingCells(t, pick + 1)}
        <td class="num">${pct(LOTTERY_ODDS[seed])}</td>
        <td class="num">${result ? moveCell : `<span class="sub">${pct(matrix[seed][0] + matrix[seed][1])}</span>`}</td>${prospectCell(pick + 1)}</tr>`;
    });
    const rest = playoff.map((t, i) => `<tr class="playoff ${isFocus(t, n + i + 1) ? "focus" : ""}"><td class="num pick">${n + i + 1}</td>${teamCell(t, n + i + 1)}
        ${standingCells(t, n + i + 1)}<td class="num sub">–</td><td class="num sub">–</td>${prospectCell(n + i + 1)}</tr>`);
    $("#order-head").innerHTML = `<tr><th class="num">Pick</th><th>Team</th><th class="num hide-sm">Record</th><th class="num hide-xs">Pts%</th>
      <th class="num">#1 odds</th><th class="num">${result ? "Move" : "Top 2"}</th>${board.length ? "<th>Mock pick</th>" : ""}</tr>`;
    $("#order-body").innerHTML = rows.join("") +
      `<tr class="divider"><td colspan="${board.length ? 7 : 6}">Projected playoff teams · picks 17–32 are set by playoff results</td></tr>` + rest.join("");
    $("#result-note").innerHTML = result
      ? `<b>${esc(lottery[result.w1].name)}</b> won the first draw${result.w1 > MAX_JUMP ? ` but can only jump 10 spots, so they move to #${result.w1 - MAX_JUMP + 1} and the worst team keeps #1` : ""}.
         <b>${esc(lottery[result.w2].name)}</b> won the second draw.`
      : "Pre-lottery order. Press <b>Simulate lottery</b> to run both draws.";
  }

  function renderOdds() {
    const expected = (seed) => matrix[seed].reduce((sum, p, pick) => sum + p * (pick + 1), 0);
    $("#odds-body").innerHTML = lottery.map((t, seed) => {
      const m = matrix[seed];
      const first = m.findIndex((p) => p > 0) + 1;
      const last = m.length - [...m].reverse().findIndex((p) => p > 0);
      return `<tr class="${isFocus(t) ? "focus" : ""}"><td class="num hide-xs">${seed + 1}</td>${teamCell(t)}
        <td class="num">${pct(m[0])}</td><td class="num">${pct(m[1])}</td><td class="num hide-xs">${pct(m[0] + m[1])}</td>
        <td class="num">${expected(seed).toFixed(1)}</td><td class="num sub hide-sm">${first}–${last}</td></tr>`;
    }).join("");
    const heat = (p) => `background: color-mix(in srgb, var(--red) ${Math.round(Math.min(1, p / 0.6) * 85)}%, transparent)`;
    $("#matrix-head").innerHTML = `<tr><th>Team</th>${lottery.map((_, i) => `<th class="num"><span class="col-num">${i + 1}</span></th>`).join("")}</tr>`;
    $("#matrix-body").innerHTML = lottery.map((t, seed) => `<tr class="${isFocus(t) ? "focus" : ""}"><td class="team-cell">${logo(t)}<b>${esc(t.abbrev)}</b></td>
      ${matrix[seed].map((p) => `<td class="num heat ${p >= 0.3 ? "hot" : ""}" style="${p > 0 ? heat(p) : ""}">${pctNum(p, p < 0.1 ? 1 : 0)}</td>`).join("")}</tr>`).join("");
  }

  // Detroit summary
  const focusSeed = lottery.findIndex(isFocus);
  if (focusSeed >= 0) {
    const m = matrix[focusSeed];
    const likely = m.indexOf(Math.max(...m)) + 1;
    $("#focus").innerHTML = `<div class="stat"><span>Lottery seed</span><b>${focusSeed + 1} of ${n}</b></div>
      <div class="stat"><span>#1 pick</span><b>${pct(m[0])}</b></div>
      <div class="stat"><span>Top 2</span><b>${pct(m[0] + m[1])}</b></div>
      <div class="stat"><span>Most likely pick</span><b>#${likely} (${pct(m[likely - 1], 0)})</b></div>`;
  } else {
    $("#focus").innerHTML = `<div class="stat"><span>Detroit</span><b>Projected playoff team: no lottery odds</b></div>`;
  }

  // Team picker for "sim until #1"
  $("#chase-team").innerHTML = lottery.map((t, seed) =>
    `<option value="${seed}" ${seed === focusSeed ? "selected" : ""}>${esc(t.name)}</option>`).join("");

  // Big board tab: Central Scouting's lists merged into one ranking, or a note until they're published.
  const stage = board.length ? cssStage(css.categories) : null;
  $("#board-note").innerHTML = board.length
    ? `Built from NHL Central Scouting's ${owners.draft_year} ${stage} (${board.length} players). Central Scouting ranks North American and International skaters and goalies separately; this board blends them by how high each player sits in their own list, with goalies slotted in about every ${boardOverrides.goalie_spacing || 15} picks. It refreshes daily. The <b>Mock pick</b> column in Draft order gives each pick the best player left on this board.`
    : `NHL Central Scouting hasn't published its ${owners.draft_year} rankings yet. Its first list usually arrives in the fall, with midterm rankings in January and final rankings in the spring. This board, and a <b>Mock pick</b> column in Draft order, fill in automatically the day it's out.`;
  $("#board-body").innerHTML = board.slice(0, 96).map((r, i) => `<tr class="${i < 32 ? "" : "dim"}">
      <td class="num pick">${i + 1}</td>
      <td class="player-cell"><b>${esc(r.name)}</b><span class="flag">${esc(r.positionCode)}</span></td>
      <td class="team-col">${esc(r.lastAmateurClub)} <span class="sub">${esc(r.lastAmateurLeague)}</span></td>
      <td class="num hide-sm">${heightFt(r.heightInInches)} / ${r.weightInPounds ?? "–"}</td>
      <td class="num hide-sm">${esc(r.birthDate || "")}</td>
      <td class="hide-xs sub">${esc(r.list.replace(/ (Skater|Goalie)s?$/i, ""))} #${r.cssRank}</td></tr>`).join("");
  $("#board-table").hidden = !board.length;

  const tabs = document.querySelectorAll("[data-ltab]");
  tabs.forEach((b) => b.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".ltab-panel").forEach((p) => { p.hidden = p.id !== b.dataset.ltab; });
  }));

  $("#sim").addEventListener("click", () => { result = simulateLottery(); $("#chase-note").textContent = ""; renderOrder(); });
  $("#reset").addEventListener("click", () => { result = null; $("#chase-note").textContent = ""; renderOrder(); });
  $("#chase").addEventListener("click", () => {
    const target = Number($("#chase-team").value);
    let tries = 0;
    do { result = simulateLottery(); tries++; } while (result.order[0] !== target && tries < 1e6);
    $("#chase-note").innerHTML = `<b>${esc(lottery[target].name)}</b> won #1 on lottery number <b>${tries.toLocaleString()}</b>.`;
    renderOrder();
  });
  // Logos have light and dark versions; redraw when the theme flips.
  $("#theme-toggle").addEventListener("click", () => { renderOrder(); renderOdds(); });
  // Hovering a team in the pick grid lights up the header numbers of every pick that team can land.
  const headNums = () => [...document.querySelectorAll("#matrix-head th")].slice(1);
  $("#matrix-body").addEventListener("mouseover", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const cells = [...row.querySelectorAll("td.heat")];
    headNums().forEach((th, i) => th.classList.toggle("lit", !!cells[i]?.textContent));
  });
  $("#matrix-body").addEventListener("mouseleave", () => headNums().forEach((th) => th.classList.remove("lit")));

  renderOrder();
  renderOdds();
}

// ---------- boot ----------
const page = document.body.dataset.page;
header({ post: "editorials", player: "prospects" }[page] || page); // sub-pages highlight their section's tab
({ home: initHome, editorials: initEditorials, news: initExternalNews, roster: initRoster, post: initPost, prospects: initProspects, player: initPlayer, draft: initDraft, lottery: initLottery }[page])?.()
  .catch((e) => {
    console.error(e);
    $("main").insertAdjacentHTML("beforeend", `<div class="card empty">Couldn't load site data (${esc(e.message)}). If you opened this file directly, run a local server: <code>python -m http.server</code>.</div>`);
  });
