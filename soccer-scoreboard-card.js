/**
 * Soccer Scoreboard Card — live Premier League (and other league) scores, goals, stats and the table
 * https://github.com/AOPW-llc/soccer-scoreboard-card
 *
 * Data: ESPN's public scoreboard, match summary, standings and team schedule
 * feeds (CORS-open, no key). Times are shown in the browser's time zone; a
 * "day" is the local calendar day.
 */

const VERSION = '1.0.0';
const CARD_TAG = 'soccer-scoreboard-card';

const ESPN = 'https://site.api.espn.com/apis';
const IDLE_REFRESH_S = 300;        // no live matches in the days on screen
const STANDINGS_REFRESH_S = 1800;
const SCHEDULE_REFRESH_S = 600;
const FETCH_TIMEOUT_MS = 10000;

// ESPN league slugs the card is tested with: [slug, name]
const LEAGUES = [
  ['eng.1', 'Premier League'], ['eng.2', 'EFL Championship'], ['esp.1', 'LALIGA'], ['ger.1', 'Bundesliga'],
  ['ita.1', 'Serie A'], ['fra.1', 'Ligue 1'], ['usa.1', 'MLS'],
];

// Match stats rows: [ESPN stat name, label, better: 1 = higher, -1 = lower, 0 = neither]
// "passAccuracy" is worked out from accurate and total passes.
const STAT_ROWS = [
  ['possessionPct', 'Possession', 1],
  ['totalShots', 'Shots', 1],
  ['shotsOnTarget', 'On Target', 1],
  ['wonCorners', 'Corners', 1],
  ['passAccuracy', 'Pass Accuracy', 1],
  ['saves', 'Saves', 0],
  ['foulsCommitted', 'Fouls', -1],
  ['offsides', 'Offsides', -1],
  ['yellowCards', 'Yellow Cards', -1],
  ['redCards', 'Red Cards', -1],
];
const RESULTS_SHOWN = 5;
const FIXTURES_SHOWN = 5;

/* ── helpers ── */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtDate = d => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
const fmtTime = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const fmtShortDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
const firstNum = v => { const m = String(v ?? '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
/** The minute of a match event, for sorting: "45'+2'" → 45.02. */
const minuteOf = c => { const m = String(c ?? '').match(/(\d+)'?(?:\s*\+\s*(\d+))?/); return m ? Number(m[1]) + Number(m[2] ?? 0) / 100 : 0; };
/** A score from either feed: a string on the scoreboard, { displayValue } on team schedules. */
const scoreOf = v => (v && typeof v === 'object' ? v.displayValue ?? v.value ?? '' : v ?? '');

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ── game model ── */

/** Flatten an ESPN scoreboard event into what the card needs. */
function parseGame(ev) {
  const comp = ev.competitions?.[0] ?? {};
  const status = comp.status ?? ev.status ?? {};
  const type = status.type ?? {};
  const team = c => ({
    id: c.team?.id,
    abbr: c.team?.abbreviation ?? '',
    short: c.team?.shortDisplayName ?? c.team?.name ?? '',
    full: c.team?.displayName ?? '',
    logo: c.team?.logo ?? '',
    color: c.team?.color ? `#${c.team.color}` : null,
    score: scoreOf(c.score),
    shootout: c.shootoutScore ?? null,
    winner: c.winner === true,
    record: c.records?.find(r => r.type === 'total')?.summary ?? '',  // W-D-L (ESPN's "form" is across competitions, so it's not used)
  });
  const comps = comp.competitors ?? [];
  const home = comps.find(c => c.homeAway === 'home') ?? comps[0];
  const away = comps.find(c => c.homeAway === 'away') ?? comps[1];
  const odds = comp.odds?.[0];
  return {
    id: ev.id,
    date: new Date(comp.date ?? ev.date),
    timeValid: comp.timeValid !== false,
    state: type.state ?? 'pre',           // pre | in | post
    statusName: type.name ?? '',
    shortDetail: type.shortDetail ?? '',
    clock: status.displayClock ?? '',
    home: team(home ?? {}),
    away: team(away ?? {}),
    venue: comp.venue?.fullName ?? '',
    venueCity: [comp.venue?.address?.city, comp.venue?.address?.country].filter(Boolean).join(', '),
    tv: (comp.broadcasts ?? []).flatMap(b => b.names ?? []).join(', '),
    odds: odds ? { details: odds.details ?? '', overUnder: odds.overUnder ?? null } : null,
    neutral: comp.neutralSite === true,
    note: comp.notes?.[0]?.headline ?? '',  // playoffs, finals, …
    // Goals and cards, in match order
    events: (comp.details ?? []).map(d => ({
      minute: d.clock?.displayValue ?? '',
      team: d.team?.id,
      who: d.athletesInvolved?.[0]?.shortName ?? d.athletesInvolved?.[0]?.displayName ?? '',
      goal: d.scoringPlay === true,
      pen: d.penaltyKick === true,
      og: d.ownGoal === true,
      red: d.redCard === true,
      yellow: d.yellowCard === true || (/yellow/i.test(d.type?.text ?? '') && d.redCard !== true),
    })).filter(e => e.goal || e.red || e.yellow).sort((a, b) => minuteOf(a.minute) - minuteOf(b.minute)),
  };
}

const LIVE_BREAKS = { STATUS_HALFTIME: ['HT', 'Half time'], STATUS_END_OF_REGULATION: ['90\'', 'End of 90'], STATUS_END_OF_EXTRATIME: ['ET', 'End of extra time'] };
const OFF = /postponed|canceled|cancelled|abandoned|suspended|delayed/i;

/** Clock part of the dropdown label: "67'", "HT", "FT". */
function clockLabel(g) {
  if (g.state === 'post') return g.shortDetail || 'FT';
  if (LIVE_BREAKS[g.statusName]) return LIVE_BREAKS[g.statusName][0];
  if (OFF.test(g.statusName)) return g.shortDetail;
  return g.clock;
}

/** Status shown in the middle of the matchup. */
function statusLabel(g) {
  if (g.state === 'pre') {
    if (OFF.test(g.statusName)) return g.shortDetail;
    return g.timeValid ? fmtTime(g.date) : 'TBD';
  }
  if (g.state === 'post') return g.shortDetail || 'FT';
  if (LIVE_BREAKS[g.statusName]) return LIVE_BREAKS[g.statusName][1];
  return g.clock;
}

/** "Chelsea v Man Utd, 8:30 AM" / "Chelsea (1) - Man Utd (2) 67'". The home side comes first, as soccer lists it. */
function gameLabel(g) {
  if (g.state === 'pre') {
    const when = OFF.test(g.statusName) ? g.shortDetail : (g.timeValid ? fmtTime(g.date) : 'TBD');
    return `${g.home.short} v ${g.away.short}, ${when}`;
  }
  return `${g.home.short} (${g.home.score}) - ${g.away.short} (${g.away.score}) ${clockLabel(g)}`;
}

/* ── table ── */

/**
 * League table: [{ name, teams }] (one group; MLS has two conferences) and
 * teamId → { group, team }. Teams in table order with their zone (Champions
 * League, relegation, …) as ESPN colors it.
 */
function parseTable(data) {
  const groups = [];
  const byTeam = {};
  const nodes = data?.children?.length ? data.children : [data];
  for (const node of nodes) {
    const entries = node?.standings?.entries ?? [];
    if (!entries.length) continue;
    const teams = entries.map((e, i) => {
      const stat = type => e.stats?.find(s => s.type === type);
      const num = type => stat(type)?.displayValue ?? '';
      return {
        id: e.team?.id,
        abbr: e.team?.abbreviation ?? '',
        short: e.team?.shortDisplayName ?? e.team?.name ?? '',
        full: e.team?.displayName ?? '',
        logo: e.team?.logos?.[0]?.href ?? '',
        rank: Number(num('rank')) || i + 1,
        gp: num('gamesplayed'), w: num('wins'), d: num('ties'), l: num('losses'),
        gd: num('pointdifferential'), pts: num('points'),
        zone: e.note ? { color: /^#+([0-9a-f]{3,8})$/i.test(e.note.color ?? '') ? `#${e.note.color.replace(/^#+/, '')}` : null, name: e.note.description ?? '' } : null,
      };
    }).sort((a, b) => a.rank - b.rank); // MLS lists its conferences out of order
    // "2026-27 English Premier League" is the season, not a group: name only real groups (MLS conferences)
    const group = { name: nodes.length > 1 ? (node.name ?? '') : '', teams };
    groups.push(group);
    teams.forEach(t => { byTeam[t.id] = { group, team: t }; });
  }
  return { groups, byTeam };
}

/** A team's matches from its schedule feed: [{ id, date, done, home, opp, gf, ga, result, label }] */
function parseSchedule(data, teamId) {
  return (data?.events ?? []).map(ev => {
    const comp = ev.competitions?.[0] ?? {};
    const me = comp.competitors?.find(c => c.team?.id === teamId);
    const opp = comp.competitors?.find(c => c.team?.id !== teamId);
    if (!me || !opp) return null;
    const type = comp.status?.type ?? {};
    const gf = scoreOf(me.score), ga = scoreOf(opp.score);
    const done = type.completed === true;
    const result = !done ? '' : me.winner ? 'W' : opp.winner ? 'L' : Number(gf) > Number(ga) ? 'W' : Number(gf) < Number(ga) ? 'L' : 'D';
    return {
      id: ev.id,
      date: new Date(comp.date ?? ev.date),
      timeValid: comp.timeValid !== false,
      done,
      state: type.state ?? 'pre',
      detail: type.shortDetail ?? '',
      home: me.homeAway === 'home',
      opp: { id: opp.team?.id, short: opp.team?.shortDisplayName ?? opp.team?.displayName ?? '', logo: opp.team?.logos?.[0]?.href ?? opp.team?.logo ?? '' },
      gf, ga, result,
    };
  }).filter(Boolean);
}

const rankLabel = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const signed = v => (Number(v) > 0 && !String(v).startsWith('+') ? `+${v}` : String(v ?? ''));
/** Last results as W / D / L badges, the latest on the right. */
const formHTML = results => (results.length ? `<span class="form" title="Last ${results.length} league results, latest on the right">${results.map(r => `<i class="r${esc(r)}">${esc(r)}</i>`).join('')}</span>` : '');

/* ═════════════════════════════ Card ═════════════════════════════ */

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .muted { color: var(--secondary-text-color); }

  /* card header */
  .top { display: flex; align-items: center; gap: 8px; padding: 12px 16px 4px; }
  .range { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
  .clock { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nav { background: none; border: none; color: var(--secondary-text-color); cursor: pointer; padding: 2px 10px;
    font-size: 26px; line-height: 1; border-radius: 8px; font-family: inherit; }
  .nav:hover, .today:hover { background: var(--secondary-background-color); }
  .today { font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 14px; cursor: pointer;
    border: 1px solid var(--primary-color); background: none; color: var(--primary-color); }
  .refresh { background: none; border: none; color: var(--secondary-text-color); cursor: pointer; font-size: 17px; padding: 2px 6px; }

  /* week strip: seven day columns, as many on screen as fit (--vis), swipe or scroll through the rest */
  .wkt { display: flex; flex-direction: column; justify-content: center; min-width: 0; margin-left: 4px; line-height: 1.2; }
  .wkn { font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wk { font-size: 15px; font-weight: 600; color: var(--secondary-text-color); white-space: nowrap; }
  .wkn + .wk { font-size: 12px; font-weight: 500; }
  .chips { display: flex; justify-content: safe center; gap: 4px; padding: 2px 12px 0; overflow-x: auto; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { font: inherit; flex: none; display: flex; flex-direction: column; align-items: center; min-width: 36px; padding: 3px 4px;
    border-radius: 10px; border: 1px solid transparent; background: none; color: var(--primary-text-color); cursor: pointer; line-height: 1.15; }
  .chip .l { font-size: 11px; color: var(--secondary-text-color); }
  .chip .d { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .chip.none .d { color: var(--secondary-text-color); font-weight: 400; }
  .chip.on { background: var(--secondary-background-color); }
  .chip.today { border-color: var(--primary-color); }
  .chip.today .l { color: var(--primary-color); font-weight: 600; }
  .cols { --gap: 12px; display: grid; grid-auto-flow: column; gap: var(--gap);
    grid-auto-columns: calc((100% - (var(--vis, 3) - 1) * var(--gap)) / var(--vis, 3));
    padding: 8px 16px 16px; scroll-padding-inline: 16px; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; }
  .cols.single { --gap: 24px; padding: 8px 12px 12px; scroll-padding-inline: 12px; }
  .cols.single .col { border: none; box-shadow: none; padding: 4px 2px; scroll-snap-stop: always; }
  .cols.single .col.is-today .dow { color: var(--primary-color); }
  .single-top .nav { padding: 4px 14px; font-size: 30px; }
  .cols.sliding { scroll-snap-type: none; scrollbar-width: none; pointer-events: none; }
  .cols.sliding::-webkit-scrollbar { display: none; }
  .col { container-type: inline-size; scroll-snap-align: start; min-width: 0; display: flex; flex-direction: column; gap: 14px;
    padding: 12px; border-radius: 14px; border: 1px solid var(--divider-color); }
  .col.is-today { border-color: var(--primary-color); box-shadow: inset 0 3px 0 var(--primary-color); }
  .dhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .date { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .count { font-size: 14px; font-weight: 400; color: var(--secondary-text-color); margin-left: 6px; }
  .dow { font-size: 13px; color: var(--secondary-text-color); }
  .is-today .dow { color: var(--primary-color); font-weight: 600; }
  .picker { position: relative; }
  select { width: 100%; box-sizing: border-box; appearance: none; -webkit-appearance: none;
    font: inherit; font-size: 14px; padding: 9px 32px 9px 10px; border-radius: 10px;
    border: 1px solid var(--divider-color); background: var(--secondary-background-color);
    color: var(--primary-text-color); cursor: pointer; text-overflow: ellipsis; }
  .picker::after { content: ''; position: absolute; right: 12px; top: 50%; width: 7px; height: 7px; margin-top: -6px;
    border-right: 2px solid var(--secondary-text-color); border-bottom: 2px solid var(--secondary-text-color);
    transform: rotate(45deg); pointer-events: none; }
  .empty { text-align: center; padding: 18px 4px; }

  /* matchup */
  /* one grid for both teams: each row (logo, name, record, score) is shared, so a name that wraps on one side keeps the other side level */
  .matchup { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); column-gap: 6px; row-gap: 4px; align-items: start; justify-items: center; text-align: center; }
  .matchup > .left { grid-column: 1; }
  .matchup > .right { grid-column: 3; }
  .matchup > .mid { grid-column: 2; }
  .t-logo { align-self: stretch; justify-self: stretch; display: flex; justify-content: center;
    padding-top: 10px; border-top: 4px solid var(--tc, var(--divider-color)); border-radius: 2px; }
  .t-logo img { width: 52px; height: 52px; object-fit: contain; }
  .matchup .score { align-self: center; }
  .tname { font-size: 14px; font-weight: 600; line-height: 1.25; }
  .tname .seed { color: var(--secondary-text-color); font-weight: 500; }
  .trec { font-size: 11px; color: var(--secondary-text-color); }
  .score { font-size: 38px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .lost.score, .lost.tname { opacity: .55; }
  .poss { font-size: 14px; }
  .mid { min-width: 52px; display: flex; flex-direction: column; align-items: center; gap: 6px; align-self: center; }
  .vs { font-size: 12px; color: var(--secondary-text-color); }
  .status { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .status.live { color: var(--error-color, #db4437); }
  .note { text-align: center; font-size: 12px; font-weight: 600; color: var(--secondary-text-color); margin-bottom: -6px; }
  .pens { font-size: 16px; font-weight: 500; color: var(--secondary-text-color); margin-left: 3px; }
  .form { display: inline-flex; gap: 2px; margin-left: 6px; vertical-align: 1px; }
  .form i, .res i { font-style: normal; font-size: 9px; font-weight: 700; width: 13px; height: 13px; line-height: 13px; text-align: center;
    border-radius: 3px; color: #fff; background: var(--disabled-text-color, #9e9e9e); display: inline-block; }
  .form i.rW, .res i.rW { background: var(--success-color, #43a047); }
  .form i.rL, .res i.rL { background: var(--error-color, #db4437); }
  .res i { width: 16px; height: 16px; line-height: 16px; font-size: 10px; }
  .events { width: 100%; border-collapse: collapse; font-size: 12px; }
  .events td { padding: 4px 3px; border-top: 1px solid var(--divider-color); }
  .events td.h { text-align: right; width: 44%; }
  .events td.a { text-align: left; width: 44%; }
  .events td.m { text-align: center; color: var(--secondary-text-color); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .events tr.bk td.h, .events tr.bk td.a { color: var(--secondary-text-color); }
  .events .who { font-weight: 600; }
  .card { display: inline-block; width: 8px; height: 11px; border-radius: 1.5px; background: #f5c518; vertical-align: -1px; }
  .card.red { background: #d32f2f; }
  .sit { text-align: center; font-size: 13px; padding: 7px 8px; border-radius: 10px; background: var(--secondary-background-color); }
  .sit.rz { box-shadow: inset 0 0 0 2px var(--error-color, #db4437); }
  .sit .tag { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: var(--error-color, #db4437); margin-left: 6px; }

  /* tables */
  h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); }
  .fold { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; margin: 0 0 6px; cursor: pointer;
    font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); }
  .fold .hint { font-weight: 400; letter-spacing: 0; text-transform: none; opacity: .75; }
  .fold.closed { margin: 0; }
  .fold.closed::after { content: ''; flex: 1; border-top: 1px solid var(--divider-color); }
  .fold:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .lines th, .lines td { padding: 4px 3px; text-align: center; font-size: 13px; }
  .lines th { font-size: 11px; font-weight: 500; color: var(--secondary-text-color); }
  .lines td:first-child, .lines th:first-child { text-align: left; }
  .lines td:last-child { font-weight: 700; }
  .lines tr + tr td { border-top: 1px solid var(--divider-color); }
  .stats td { padding: 5px 3px; font-size: 13px; border-top: 1px solid var(--divider-color); }
  .stats td:first-child { text-align: left; width: 32%; }
  .stats td:last-child { text-align: right; width: 32%; }
  .stats td.lbl { text-align: center; color: var(--secondary-text-color); font-size: 12px; }
  .stats .best { font-weight: 700; }
  .stats tr.head td { border-top: none; font-weight: 600; font-size: 12px; }
  .leaders td { font-size: 12px; vertical-align: top; }
  .leaders .who { font-weight: 600; }
  .info { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 13px; }
  .info .k { color: var(--secondary-text-color); }

  /* divisions */
  .logo-btn { background: none; border: none; padding: 0; cursor: pointer; border-radius: 50%; line-height: 0; }
  .logo-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  /* team view */
  .back { font: inherit; font-size: 15px; background: none; border: none; color: var(--primary-color); cursor: pointer; padding: 6px 8px; border-radius: 8px; }
  .back:hover { background: var(--secondary-background-color); }
  .tv { container-type: inline-size; padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 18px; }
  .tv-head { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 4px solid var(--tc, var(--divider-color)); }
  .tv-head img { width: 72px; height: 72px; object-fit: contain; flex: none; }
  .tv-name { font-size: 22px; font-weight: 700; line-height: 1.2; }
  .tv-name .seed { color: var(--secondary-text-color); font-weight: 500; }
  .tv-sub { font-size: 14px; color: var(--secondary-text-color); margin-top: 2px; }
  .tv-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 24px; align-items: start; }
  .season td { padding: 7px 4px; font-size: 14px; border-top: 1px solid var(--divider-color); vertical-align: middle; }
  .season th { padding: 0 4px 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color); text-align: right; }
  .season th:first-child, .season td:first-child { text-align: left; }
  .season td.v, .season td.ld { text-align: right; white-space: nowrap; }
  .season td.v b { font-size: 15px; }
  .season .rk { display: block; font-size: 11px; color: var(--secondary-text-color); }
  .season tr.top .rk { color: var(--primary-color); font-weight: 700; }
  .season .ld img { width: 18px; height: 18px; vertical-align: -4px; margin-right: 4px; }
  .season .ld .who { color: var(--secondary-text-color); font-size: 12px; margin-right: 4px; }
  .confs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .conf td { padding: 4px 3px; font-size: 13px; border-top: 1px solid var(--divider-color); }
  .conf td.sd { width: 22px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .conf td.tm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; width: 100%; }
  .conf td.tm img { width: 18px; height: 18px; vertical-align: -4px; margin-right: 6px; }
  .conf td.wl { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .conf td.n { text-align: right; width: 22px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .conf td.pt { text-align: right; width: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .conf td.sd { box-shadow: inset 3px 0 0 var(--zc, transparent); padding-left: 7px; width: 28px; }
  .conf td.dt { width: 40px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .conf td.res { width: 22px; text-align: right; }
  .conf th { padding: 0 3px 2px; font-size: 10px; font-weight: 500; color: var(--secondary-text-color); text-align: right; }
  .conf tr.gap td { border-top-style: dashed; }
  .sched td.tm { cursor: pointer; }
  .side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: var(--secondary-text-color); }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
  .conf tr.me td { font-weight: 700; background: var(--secondary-background-color); }
  .conf-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .conf-col h3 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .04em; }
  .cdiv h4 { margin-bottom: 2px; }
  .conf tr[data-team] { cursor: pointer; }
  @container (max-width: 760px) { .tv-body { grid-template-columns: minmax(0, 1fr); } }
  @container (max-width: 420px) {
    .tv { padding: 4px 12px 12px; }
    .tv-head img { width: 56px; height: 56px; }
    .tv-name { font-size: 18px; }
    .confs { grid-template-columns: minmax(0, 1fr); }
  }

  .divs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .div { min-width: 0; }
  .div h4 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .drow { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; padding: 4px 0;
    border-top: 1px solid var(--divider-color); }
  .drow .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .drow .r { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; flex: none; }
  .drow.me .n { font-weight: 700; }
  .err { color: var(--error-color, #db4437); font-size: 13px; text-align: center; padding: 0 16px 8px; }
  .foot { font-size: 11px; color: var(--secondary-text-color); padding: 0 16px 12px; }

  /* narrow columns */
  @container (max-width: 340px) {
    .t-logo img { width: 44px; height: 44px; }
    .tname { font-size: 13px; }
    .score { font-size: 32px; }
    .mid { min-width: 46px; }
    .status { font-size: 12px; }
  }
`;

const BLOCK_DAYS = 7;              // the longest a round can be on screen at once
const DAY_MS = 864e5;
const MIN_COL_PX = 300;           // Auto: a day column is never narrower than this
const MIN_FIXED_COL_PX = 220;     // a chosen day count shrinks columns to this at most, then scrolls
const SINGLE_DAY_BELOW_PX = 600;  // Auto, narrower than this (phones): one day at a time
const SLIDE_MS = 500;
const fitCols = (width, min) => Math.floor((width - 32 + 12) / (min + 12));
/**
 * How many of the week's days are on screen at once. `days` is the config
 * choice: 'auto' fits as many whole columns as the width allows (one on a
 * phone); 1–7 shows that many, unless the columns would get unreadably narrow.
 */
const visFor = (width, days = 'auto', weekDays = BLOCK_DAYS) => {
  const n = Math.min(Number(days), weekDays);
  if (n >= 1) return width ? Math.max(1, Math.min(n, fitCols(width, MIN_FIXED_COL_PX))) : n;
  if (!width) return weekDays;
  return width < SINGLE_DAY_BELOW_PX ? 1 : Math.max(1, Math.min(weekDays, fitCols(width, MIN_COL_PX)));
};
/** The calendar day (Eastern) of an ESPN calendar entry, as a local date. Entries start at 3 AM Eastern. */
const etDay = iso => { const d = new Date(Date.parse(iso) - 5 * 3600e3); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
/** Weekend (Fri–Mon) or midweek (Tue–Thu): a round never spans both. */
const phase = d => ([2, 3, 4].includes(d.getDay()) ? 'Midweek' : 'Weekend');
/**
 * A season's rounds from a scoreboard response. ESPN's soccer calendar is just
 * the list of match days (no matchweek numbers), so a round is a run of match
 * days in the same weekend or midweek, allowing one free day inside it (a
 * Saturday and Monday round): [{ start, days, label }].
 */
const parseRounds = league => {
  const days = [...new Set((league?.calendar ?? []).map(x => (typeof x === 'string' ? x : x?.startDate)).filter(Boolean)
    .map(iso => dayKey(etDay(iso))))].sort().map(k => parseDayKey(k));
  const rounds = [];
  for (const d of days) {
    const r = rounds[rounds.length - 1];
    const gap = r ? Math.round((d - addDays(r.start, r.days)) / DAY_MS) : Infinity;
    if (r && gap <= 1 && phase(d) === r.label) r.days += gap + 1;
    else rounds.push({ start: d, days: 1, label: phase(d) });
  }
  return rounds;
};
/** A plain Monday–Sunday week, for when the calendar can't load. */
const fallbackWeek = d => ({ start: addDays(startOfDay(d), -((d.getDay() + 6) % 7)), days: BLOCK_DAYS, label: '' });
const VIEW_KEY = 'soccer-scoreboard-card:view';
const parseDayKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const FOLD_KEY = 'soccer-scoreboard-card:folded';
const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // by getDay()

class SoccerScoreboardCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rounds = [];                    // every round loaded so far, in date order
    this._calTried = new Set();           // months whose calendar has been asked for
    this._todayKey = dayKey(new Date());
    this._week = fallbackWeek(new Date()); // replaced by the real round on the first refresh
    this._start = this._week.start;
    this._cols = [];                      // [{ day, games, selId, summary }]
    this._table = null;                   // { groups, byTeam }
    this._standingsAt = 0;
    this._schedules = {};                 // teamId → { results, fixtures, at }
    this._error = null;
    this._loading = true;
    this._updated = null;
    this._scrollToToday = true;
    // Sections the viewer has folded, remembered on this device
    try { this._folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY)) || []); } catch { this._folded = new Set(); }
    // Where the viewer left off (Home Assistant rebuilds the card on every visit). Only for this tab, and only today.
    try {
      const v = JSON.parse(sessionStorage.getItem(VIEW_KEY));
      if (v?.day === this._todayKey && /^\d{4}-\d\d-\d\d$/.test(v.start)) this._restore = v;
    } catch { /* start at today */ }
    this._width = window.innerWidth;       // refined by the ResizeObserver once laid out
    this._vis = visFor(this._width, 'auto', this._week.days);
    this._buildCols();
  }

  setConfig(config) {
    const league = this._config?.league;
    this._config = { league: 'eng.1', refresh_interval: 30, show_odds: true, days: 'auto', ...config };
    this._config.team = String(this._config.team ?? '').trim().toLowerCase();
    if (league && league !== this._config.league) this._resetLeague();
    const vis = visFor(this._width, this._config.days, this._week.days);
    if (vis !== this._vis) { this._vis = vis; this._scrollToToday = this._showingThisWeek; }
    if (this.isConnected) this._refresh();
    this._render();
  }

  set hass(hass) { this._hass = hass; }

  connectedCallback() {
    this._tickClock();
    if (this._scrollToToday) requestAnimationFrame(() => this._render()); // drawn before it was on the page
    this._refresh();
    // Fit as many whole day columns as the card's own width allows (one on a phone)
    if (!window.ResizeObserver) return;
    this._resizeObs ??= new ResizeObserver(([entry]) => {
      if (!entry.contentRect.width) return;
      this._width = entry.contentRect.width;
      const vis = visFor(this._width, this._config?.days, this._week.days);
      if (vis === this._vis || this._sliding) return;
      this._vis = vis;
      this._scrollToToday = this._showingThisWeek;
      this._render();
    });
    this._resizeObs.observe(this);
  }

  disconnectedCallback() {
    clearTimeout(this._clockTimer);
    clearTimeout(this._timer);
    clearTimeout(this._saveTimer);
    this._resizeObs?.disconnect();
  }

  getCardSize() { return 12; }
  getGridOptions() { return { columns: 'full', rows: 'auto', min_columns: 12 }; }

  static getConfigForm() {
    return {
      schema: [
        { name: 'league', selector: { select: { mode: 'dropdown', custom_value: true, options: LEAGUES.map(([v, l]) => ({ value: v, label: l })) } } },
        { name: 'team', selector: { text: {} } },
        { name: 'days', selector: { select: { mode: 'dropdown', options: [{ value: 'auto', label: 'Auto (as many as fit)' },
          ...Array.from({ length: 7 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))] } } },
        { name: 'refresh_interval', selector: { number: { min: 10, max: 300, step: 5, mode: 'box', unit_of_measurement: 's' } } },
        { name: 'show_odds', selector: { boolean: {} } },
      ],
      computeLabel: s => ({ league: 'League', team: 'Favorite team', days: 'Days on screen', refresh_interval: 'Refresh during live matches', show_odds: 'Show betting line before kickoff' }[s.name]),
      computeHelper: s => ({
        league: 'Or type any ESPN soccer league slug, e.g. sco.1',
        team: 'Abbreviation or name, e.g. ARS, Liverpool, Man City. Selected automatically on match days',
        days: 'How many days of the round show at once; swipe or scroll for the rest',
      }[s.name]),
    };
  }

  static getStubConfig() { return { league: 'eng.1' }; }

  get _api() { return `${ESPN}/site/v2/sports/soccer/${encodeURIComponent(this._config?.league || 'eng.1')}`; }

  /** Start over when the league changes: its rounds, table and teams are all different. */
  _resetLeague() {
    this._rounds = [];
    this._calTried = new Set();
    this._table = null;
    this._standingsAt = 0;
    this._schedules = {};
    this._teamView = null;
    this._calendarReady = false;
    this._cols.forEach(c => { c.games = []; c.selId = null; c.summary = null; });
  }

  /** Whether `t` (a match side or table row) is the favorite team, by abbreviation or name. */
  _isFavTeam(t) {
    const f = this._config?.team;
    return !!f && [t.abbr, t.short, t.full].some(x => String(x ?? '').toLowerCase() === f);
  }

  /* ── days ── */

  _buildCols() {
    const prev = new Map(this._cols.map(c => [dayKey(c.day), c]));
    this._cols = Array.from({ length: this._week.days }, (_, i) => {
      const day = addDays(this._start, i);
      return prev.get(dayKey(day)) ?? { day, games: [], selId: null, summary: null };
    });
  }

  /** Make `week` the one on screen (columns only; _setWeek also draws and loads it). */
  _useWeek(week) {
    this._week = week;
    this._start = week.start;
    this._vis = visFor(this._width, this._config?.days, week.days);
    this._buildCols();
  }

  _setWeek(week) {
    this._useWeek(week);
    this._loading = true;
    this._render();
    this._refresh();
  }

  /**
   * The round holding `d`, else the next one after it (dir > 0) or the last
   * one before it (dir < 0), from the rounds loaded so far; null if none.
   */
  _findWeek(d, dir) {
    const r = this._rounds;
    const end = x => addDays(x.start, x.days);
    const hit = r.find(x => d >= x.start && d < end(x));
    if (hit) return hit;
    return dir > 0 ? r.find(x => x.start > d) ?? null : [...r].reverse().find(x => end(x) <= d) ?? null;
  }

  /** Add a season's rounds, keeping them in order and without duplicates. */
  _addRounds(rounds) {
    const have = new Set(this._rounds.map(x => dayKey(x.start)));
    this._rounds.push(...rounds.filter(x => !have.has(dayKey(x.start))));
    this._rounds.sort((a, b) => a.start - b.start);
  }

  /**
   * The round holding `day`, or the nearest one in direction `dir` (today:
   * the next round when there's no match today). Loads that season's calendar
   * if needed. Never fails: at the ends of what ESPN has, the nearest round.
   */
  async _weekFor(day, dir = 1) {
    day = startOfDay(day);
    const last = this._rounds[this._rounds.length - 1];
    const covered = this._rounds.length && day >= this._rounds[0].start && day < addDays(last.start, last.days);
    let w = covered ? this._findWeek(day, dir) : null;
    const month = `${day.getFullYear()}-${day.getMonth()}`;
    if (!w && !this._calTried.has(month)) {
      this._calTried.add(month);
      try {
        const j = await getJSON(`${this._api}/scoreboard?dates=${ymd(day)}`);
        this._addRounds(parseRounds(j.leagues?.[0]));
      } catch { /* fall back below */ }
    }
    w ??= this._findWeek(day, dir) ?? this._findWeek(day, -dir);
    return w ?? fallbackWeek(day);
  }

  async _goToday() {
    this._scrollToToday = true;
    this._setWeek(await this._weekFor(new Date()));
  }

  /** Whether the round on screen is today's (or, with no match today, the next one). */
  get _showingThisWeek() {
    if (this._cols.some(c => dayKey(c.day) === this._todayKey)) return true;
    const w = this._findWeek(startOfDay(new Date()), 1);
    return !!w && dayKey(w.start) === dayKey(this._start);
  }

  _tickClock() {
    clearTimeout(this._clockTimer);
    const now = new Date();
    const el = this.shadowRoot.getElementById('clock');
    if (el) el.textContent = fmtTime(now);
    // At midnight, follow today (into the next round) if today's round is what's on screen
    const key = dayKey(now);
    if (key !== this._todayKey) {
      const wasThisWeek = this._showingThisWeek;
      this._todayKey = key;
      this._scrollToToday = wasThisWeek;
      if (wasThisWeek && !this._showingThisWeek) this._goToday(); else this._render();
    }
    this._clockTimer = setTimeout(() => this._tickClock(), 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  /* ── data ── */

  async _refresh() {
    clearTimeout(this._timer);
    if (!this._calendarReady) {
      // First load: swap the placeholder week for the real round, or for where the viewer left off
      const saved = this._restore;
      this._restore = null;
      const w = await this._weekFor(saved ? parseDayKey(saved.start) : new Date());
      if (!this._calendarReady) {
        this._calendarReady = true;
        if (dayKey(w.start) !== dayKey(this._start) || w.days !== this._week.days || w.label !== this._week.label) {
          this._useWeek(w);
          this._scrollToToday = true;
        }
        if (saved) {
          this._scrollToToday = false;
          this._scrollToDay = Math.max(0, Math.min(Number(saved.col) || 0, this._cols.length - this._vis));
          if (saved.team) this._openTeam(String(saved.team), { restoring: true });
        }
      }
    }
    const start = this._start;
    const cols = this._cols;
    try {
      const standingsDue = Date.now() - this._standingsAt > STANDINGS_REFRESH_S * 1000;
      // ESPN buckets games by US Eastern date; one extra date each side covers every local time zone
      const dates = Array.from({ length: cols.length + 2 }, (_, i) => addDays(start, i - 1));
      const league = this._config.league;
      const [events, st] = await Promise.all([
        this._getEvents(dates),
        standingsDue ? getJSON(`${ESPN}/v2/sports/soccer/${encodeURIComponent(league)}/standings`).catch(() => null) : null,
      ]);
      if (start !== this._start || league !== this._config.league) return; // the user moved on while this was loading
      if (st) { this._table = parseTable(st); this._standingsAt = Date.now(); }
      const games = events.map(parseGame).sort((a, b) => a.date - b.date);
      for (const c of cols) {
        c.games = games.filter(g => dayKey(g.date) === dayKey(c.day));
        this._pickGame(c);
      }
      await Promise.all(cols.map(c => this._loadSummary(c)));
      this._error = null;
      this._updated = new Date();
    } catch (e) {
      this._error = `Couldn't load scores (${e.message}). Retrying…`;
    }
    if (start !== this._start) return;
    this._loading = false;
    this._render();
    this._schedule();
  }

  /** Scoreboard events for each ESPN date (YYYYMMDD); the feed doesn't take date ranges. */
  async _getEvents(days) {
    const all = await Promise.all(days.map(d => getJSON(`${this._api}/scoreboard?dates=${ymd(d)}`)));
    this._leagueName = all.find(r => r.leagues?.[0])?.leagues[0].abbreviation ?? this._leagueName;
    const seen = new Set();
    return all.flatMap(r => r.events ?? []).filter(e => !seen.has(e.id) && seen.add(e.id));
  }

  _pickGame(c) {
    if (c.selId && c.games.some(g => g.id === c.selId)) return;
    const g = c.games.find(x => this._isFavTeam(x.home) || this._isFavTeam(x.away))
      || c.games.find(x => x.state === 'in')
      || c.games.find(x => x.state === 'pre')
      || c.games[0];
    c.selId = g?.id ?? null;
  }

  _selected(c) { return c.games.find(g => g.id === c.selId) ?? null; }

  /** Box score + leaders, only once a game has started (pre-game info is on the scoreboard). */
  async _loadSummary(c) {
    const g = this._selected(c);
    if (!g || g.state === 'pre') return;
    if (c.summary?.id === g.id && c.summary.final) return; // a finished game's stats don't change
    try {
      const data = await getJSON(`${this._api}/summary?event=${g.id}`);
      if (c.selId === g.id) c.summary = { id: g.id, data, final: g.state === 'post' };
    } catch { /* keep whatever we had; the scoreboard still shows the score */ }
  }

  _schedule() {
    const now = Date.now();
    const live = this._cols.some(c => c.games.some(g => g.state === 'in'
      || (g.state === 'pre' && g.date - now < 10 * 60000 && g.date - now > -3 * 3600000)));
    const s = this._error ? 30 : live ? Math.max(10, Number(this._config.refresh_interval) || 30) : IDLE_REFRESH_S;
    this._timer = setTimeout(() => this._refresh(), s * 1000);
  }

  /* ── render ── */

  _render() {
    if (!this._config || this._sliding) return; // the slide renders when it lands
    // Don't rebuild under an open dropdown; catch up when it closes
    const active = this.shadowRoot.activeElement;
    if (active?.tagName === 'SELECT') { this._pending = true; return; }
    const scroller = this.shadowRoot.querySelector('.cols');
    const scrollLeft = scroller?.scrollLeft;
    const single = this._vis === 1;
    const tv = this._teamView;
    if (tv && scroller) this._colsScroll = scrollLeft; // come back to the same place
    const last = addDays(this._start, this._cols.length - 1);
    const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
      <div class="top${single ? ' single-top' : ''}">
        <div class="range">${tv ? '<button class="back" id="back">‹ Back</button>' : `
          <button class="nav" id="left" aria-label="Previous round" title="Previous round">‹</button>
          <button class="nav" id="right" aria-label="Next round" title="Next round">›</button>
          <div class="wkt">${this._leagueName ? `<span class="wkn">${esc(this._leagueName)}</span>` : ''}<span class="wk">${esc(this._week.label)}${this._week.label && !single ? ' · ' : ''}${single ? '' : `${md(this._start)}${last > this._start ? ` – ${md(last)}` : ''}`}</span></div>
          ${this._showingThisWeek ? '' : '<button class="today" id="today">Today</button>'}`}
        </div>
        <div class="clock" id="clock">${fmtTime(new Date())}</div>
        <button class="refresh" id="refresh" title="Refresh now">↻</button>
      </div>
      ${this._error ? `<div class="err">${esc(this._error)}</div>` : ''}
      ${tv ? this._teamViewHTML(tv) : `${this._vis < this._cols.length ? this._chipsHTML() : ''}
      <div class="cols${single ? ' single' : ''}" style="--vis:${this._vis}">${this._cols.map((c, i) => this._colHTML(c, i)).join('')}</div>`}
      ${this._updated ? `<div class="foot">Updated ${fmtTime(this._updated)}</div>` : ''}
    </ha-card>`;
    const cols = this.shadowRoot.querySelector('.cols');
    if (!cols) { this._bind(); this._saveView(); return; }
    if (this._colsScroll != null) { this._keepScroll = this._colsScroll; this._colsScroll = null; }
    // Jumps wait until the card is on screen and its columns have a width
    const step = this._colStep(cols);
    if (this._scrollToToday && step) {
      this._setScroll(cols, this._todayCol() * step);
      this._scrollToToday = false;
    } else if (this._scrollToDay != null && step) { this._setScroll(cols, this._scrollToDay * step); this._scrollToDay = null; }
    else if (this._keepScroll != null) { this._setScroll(cols, this._keepScroll); this._keepScroll = null; }
    else if (scrollLeft) this._setScroll(cols, scrollLeft);
    this._markChips();
    this._bind();
    this._saveView();
  }

  /** Remember the week, the day scrolled to and any open team page, for when the card is rebuilt. */
  _saveView() {
    if (!this._calendarReady || this._sliding) return;
    const cols = this.shadowRoot.querySelector('.cols');
    const step = cols ? this._colStep(cols) : 0;
    this._viewCol = this._scrollToDay ?? (this._scrollToToday ? this._todayCol()
      : step ? Math.round(cols.scrollLeft / step) : this._viewCol ?? 0);
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({
        day: this._todayKey, start: dayKey(this._start), col: this._viewCol, team: this._teamView ?? null,
      }));
    } catch { /* not remembered */ }
  }

  /**
   * The first column to show so today is the left-most day on screen (late in
   * the week, as far right as the week goes). The week's first day when today isn't in it.
   */
  _todayCol() {
    const t = this._cols.findIndex(c => dayKey(c.day) === this._todayKey);
    return t < 0 ? 0 : Math.min(t, this._cols.length - this._vis);
  }

  /** Width of one day column plus the gap after it (0 until the card is laid out). */
  _colStep(cols) {
    const w = cols.querySelector('.col')?.getBoundingClientRect().width;
    return w ? w + (parseFloat(getComputedStyle(cols).columnGap) || 0) : 0;
  }

  /**
   * Scroll a freshly drawn strip. Snapping is off while it's set, and the
   * position is set again a frame later: Safari otherwise re-snaps a new strip
   * back to its first day as the logos load.
   */
  _setScroll(cols, left) {
    cols.style.scrollSnapType = 'none';
    cols.scrollLeft = left;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cols.isConnected || this._sliding) return;
      cols.scrollLeft = left;
      cols.style.scrollSnapType = '';
      this._markChips();
    }));
  }

  /** One button per day of the week that jumps to it, shown when the week doesn't fit across. */
  _chipsHTML() {
    return `<div class="chips">${this._cols.map((c, i) => `<button class="chip${c.games.length ? '' : ' none'}${dayKey(c.day) === this._todayKey ? ' today' : ''}"
      data-day="${i}" aria-label="${esc(c.day.toLocaleDateString('en-US', { weekday: 'long' }))} ${fmtDate(c.day)}">
      <span class="l">${DOW_LETTERS[c.day.getDay()]}</span><span class="d">${c.day.getDate()}</span></button>`).join('')}</div>`;
  }

  /** Highlight the chips of the days currently on screen. */
  _markChips() {
    const cols = this.shadowRoot.querySelector('.cols');
    const chips = this.shadowRoot.querySelectorAll('.chip');
    if (!cols || !chips.length) return;
    const step = this._colStep(cols);
    const first = step ? Math.round(cols.scrollLeft / step) : 0;
    chips.forEach((ch, i) => ch.classList.toggle('on', i >= first && i < first + this._vis));
  }

  _colHTML(c, i) {
    const isToday = dayKey(c.day) === this._todayKey;
    const g = this._selected(c);
    return `<div class="col${isToday ? ' is-today' : ''}">
      <div class="dhead"><span class="date">${fmtDate(c.day)}${c.games.length ? `<span class="count">${c.games.length} ${c.games.length === 1 ? 'match' : 'matches'}</span>` : ''}</span>
        <span class="dow">${isToday ? 'Today' : esc(c.day.toLocaleDateString('en-US', { weekday: 'long' }))}</span></div>
      ${this._pickerHTML(c, i)}
      ${g ? this._gameHTML(g, c) : ''}
    </div>`;
  }

  _pickerHTML(c, i) {
    if (!c.games.length) return `<div class="empty muted">${this._loading ? 'Loading matches…' : 'No matches'}</div>`;
    return `<div class="picker"><select data-col="${i}" aria-label="Match on ${fmtDate(c.day)}">
      ${c.games.map(g => `<option value="${esc(g.id)}"${g.id === c.selId ? ' selected' : ''}>${esc(gameLabel(g))}</option>`).join('')}
    </select></div>`;
  }

  /** One team's cells in the shared matchup grid; `side` picks the column (home on the left). */
  _teamHTML(t, g, side) {
    const lost = g.state === 'post' && !t.winner && (g.away.winner || g.home.winner) ? ' lost' : '';
    const pos = this._table?.byTeam[t.id]?.team.rank;
    const cell = (row, cls, html, style = '') => `<div class="${side} ${cls}" style="grid-row:${row}${style}">${html}</div>`;
    return cell(1, 't-logo', t.logo ? `<button class="logo-btn" data-team="${esc(t.id)}" aria-label="${esc(t.full)} results and table" title="Results and table"><img src="${esc(t.logo)}" alt="" loading="lazy"></button>` : '', `;--tc:${esc(t.color ?? '')}`)
      + cell(2, `tname${lost}`, esc(t.full))
      + cell(3, 'trec', `${pos ? `${rankLabel(pos)} · ` : ''}${esc(t.record)}`)
      + (g.state !== 'pre' ? cell(4, `score${lost}`, `${esc(t.score)}${t.shootout != null ? `<span class="pens">(${esc(t.shootout)})</span>` : ''}`) : '');
  }

  _gameHTML(g, c) {
    const live = g.state === 'in';
    let html = `${g.note ? `<div class="note">${esc(g.note)}</div>` : ''}<div class="matchup">
      ${this._teamHTML(g.home, g, 'left')}
      <div class="mid vs-cell" style="grid-row:1"><div class="vs">v</div>${g.state === 'pre' ? `<div class="status">${esc(statusLabel(g))}</div>` : ''}</div>
      ${g.state === 'pre' ? '' : `<div class="mid st-cell" style="grid-row:4"><div class="status${live ? ' live' : ''}">${esc(statusLabel(g))}</div></div>`}
      ${this._teamHTML(g.away, g, 'right')}
    </div>`;
    html += this._eventsHTML(g);
    html += g.state === 'pre' ? this._preHTML(g) : this._boxHTML(g, c.summary?.id === g.id ? c.summary.data : null);
    html += this._tableSnippetHTML(g);
    return html;
  }

  /** Goals and cards: the minute in the middle, each event on its team's side. */
  _eventsHTML(g) {
    if (!g.events.length) return '';
    const icon = e => (e.goal ? '⚽' : e.red ? '<i class="card red"></i>' : '<i class="card"></i>');
    const what = e => `${icon(e)} <span class="${e.goal ? 'who' : ''}">${esc(e.who)}</span>${e.pen ? ' <span class="muted">(pen)</span>' : ''}${e.og ? ' <span class="muted">(OG)</span>' : ''}`;
    const rows = g.events.map(e => {
      const home = e.team === g.home.id;
      return `<tr class="${e.goal ? 'goal' : 'bk'}"><td class="h">${home ? what(e) : ''}</td><td class="m">${esc(e.minute)}</td><td class="a">${home ? '' : what(e)}</td></tr>`;
    }).join('');
    return this._foldHTML('events', 'Goals & cards', `<table class="events">${rows}</table>`);
  }

  _preHTML(g) {
    const rows = [
      ['Kickoff', `${fmtShortDay(g.date)} · ${g.timeValid ? fmtTime(g.date) : 'TBD'}`],
      g.venue && ['Venue', `${g.venue}${g.venueCity ? `, ${g.venueCity}` : ''}`],
      g.tv && ['TV', g.tv],
      this._config.show_odds && g.odds?.details && ['Line', `${g.odds.details}${g.odds.overUnder != null ? ` · O/U ${g.odds.overUnder} goals` : ''}`],
    ].filter(Boolean);
    return `<div class="info">${rows.map(([k, v]) => `<span class="k">${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`;
  }

  _boxHTML(g, data) {
    if (!data) return '';
    const byTeam = id => data.boxscore?.teams?.find(t => t.team?.id === id)?.statistics ?? [];
    const hs = byTeam(g.home.id), as = byTeam(g.away.id);
    const val = (list, n) => {
      const v = k => list.find(s => s.name === k)?.displayValue;
      if (n === 'possessionPct') return v(n) != null ? `${Math.round(Number(v(n)))}%` : null;
      if (n === 'passAccuracy') {
        const ok = Number(v('accuratePasses')), all = Number(v('totalPasses'));
        return all > 0 ? `${Math.round((ok / all) * 100)}%` : null;
      }
      return v(n);
    };
    const rows = STAT_ROWS.map(([n, label, better]) => {
      const h = val(hs, n), a = val(as, n);
      if (a == null && h == null) return '';
      let hb = '', ab = '';
      const x = firstNum(h), y = firstNum(a);
      if (better && x != null && y != null && x !== y) { ((x > y) === (better > 0) ? (hb = ' best') : (ab = ' best')); }
      return `<tr><td class="${hb}">${esc(h ?? '–')}</td><td class="lbl">${esc(label)}</td><td class="${ab}">${esc(a ?? '–')}</td></tr>`;
    }).join('');
    return rows ? this._foldHTML('stats', 'Match stats',
      `<table class="stats"><tr class="head"><td>${esc(g.home.abbr)}</td><td></td><td>${esc(g.away.abbr)}</td></tr>${rows}</table>`) : '';
  }

  /** A section whose heading hides / shows it. Folding applies to that section in every day column. */
  _foldHTML(key, title, body) {
    const closed = this._folded.has(key);
    return `<div><button class="fold${closed ? ' closed' : ''}" data-fold="${key}" aria-expanded="${!closed}">
      ${esc(title)} <span class="hint">(tap to ${closed ? 'expand' : 'hide'})</span></button>${closed ? '' : body}</div>`;
  }

  /** The table around both teams: each one with the clubs either side of it. */
  _tableSnippetHTML(g) {
    const a = this._table?.byTeam[g.home.id], b = this._table?.byTeam[g.away.id];
    if (!a && !b) return '';
    const blocks = [];
    for (const group of new Set([a?.group, b?.group].filter(Boolean))) {
      const keep = new Set();
      for (const s of [a, b]) {
        if (s?.group !== group) continue;
        const i = group.teams.indexOf(s.team);
        for (let j = Math.max(0, i - 1); j <= Math.min(group.teams.length - 1, i + 1); j++) keep.add(j);
      }
      let prev = -1;
      const rows = [...keep].sort((x, y) => x - y).map(j => {
        const t = group.teams[j];
        const gap = prev >= 0 && j > prev + 1;
        prev = j;
        return `<tr class="${t.id === g.home.id || t.id === g.away.id ? 'me' : ''}${gap ? ' gap' : ''}" data-team="${esc(t.id)}">
          <td class="sd"${t.zone?.color ? ` style="--zc:${esc(t.zone.color)}"` : ''}>${t.rank}</td><td class="tm">${esc(t.short)}</td>
          <td class="n">${esc(t.gp)}</td><td class="n">${esc(signed(t.gd))}</td><td class="pt">${esc(t.pts)}</td></tr>`;
      }).join('');
      blocks.push(`<div>${group.name ? `<h4>${esc(group.name)}</h4>` : ''}<table class="conf mini"><tr><th></th><th></th><th>P</th><th>GD</th><th>Pts</th></tr>${rows}</table></div>`);
    }
    return `<div><h4>Table</h4>${blocks.join('')}</div>`;
  }

  /**
   * Carousel move by one round. Lays this round and the next (or previous)
   * one out as one strip, scrolls across it, then settles on the new round's
   * first day (or today). Rounds differ in length.
   */
  async _slide(dir) {
    if (this._sliding || this._finding) return;
    this._finding = true;
    const week = await this._weekFor(dir > 0 ? addDays(this._start, this._cols.length) : addDays(this._start, -1), dir);
    this._finding = false;
    if (dayKey(week.start) === dayKey(this._start)) return; // no round further that way
    const strip = this.shadowRoot.querySelector('.cols');
    if (this._sliding || this._teamView) return;
    if (!strip?.querySelector('.col') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this._useWeek(week);
      this._scrollToDay = this._todayCol();
      this._setWeek(week);
      return;
    }
    const step = this._colStep(strip);
    const old = this._cols;
    this._useWeek(week);
    const land = this._todayCol();
    const cols = dir > 0 ? [...old, ...this._cols] : [...this._cols, ...old];
    const start = strip.scrollLeft;
    strip.classList.add('sliding');
    strip.innerHTML = cols.map(c => this._colHTML(c, -1)).join('');
    // the header catches up when the strip lands
    const from = dir > 0 ? start : start + this._cols.length * step;
    const to = dir > 0 ? (old.length + land) * step : land * step;
    strip.scrollLeft = from;
    this._sliding = true;
    this._loading = true;
    this._refresh(); // fetch the new week while the strip moves
    const t0 = performance.now();
    const frame = now => {
      const p = Math.min(1, (now - t0) / SLIDE_MS);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease in-out
      strip.scrollLeft = from + (to - from) * e;
      if (p < 1) { requestAnimationFrame(frame); return; }
      this._sliding = false;
      this._scrollToDay = land;
      this._render();
    };
    requestAnimationFrame(frame);
  }

  /* ── team view ── */

  async _openTeam(id, { restoring = false } = {}) {
    this._teamView = id;
    this._render();
    if (!restoring) this.shadowRoot.querySelector('ha-card')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    const have = this._schedules[id];
    if (have && !have.error && Date.now() - have.at < SCHEDULE_REFRESH_S * 1000) return;
    try {
      const [past, next] = await Promise.all([
        getJSON(`${this._api}/teams/${encodeURIComponent(id)}/schedule`),
        getJSON(`${this._api}/teams/${encodeURIComponent(id)}/schedule?fixture=true`).catch(() => null),
      ]);
      const results = parseSchedule(past, id).filter(m => m.done).sort((a, b) => b.date - a.date);
      const fixtures = parseSchedule(next, id).filter(m => !m.done).sort((a, b) => a.date - b.date);
      this._schedules[id] = { results, fixtures, at: Date.now() };
    } catch (e) { this._schedules[id] = { error: `Couldn't load results (${e.message}).`, at: Date.now() }; }
    if (this._teamView === id) this._render();
  }

  _closeTeam() {
    this._teamView = null;
    this._render();
  }

  _teamViewHTML(id) {
    const st = this._table?.byTeam[id];
    const g = this._cols.flatMap(c => c.games).find(x => x.away.id === id || x.home.id === id);
    const gt = g && (g.away.id === id ? g.away : g.home);
    const full = gt?.full || st?.team.full || '';
    const logo = gt?.logo || st?.team.logo || '';
    const t = st?.team;
    const sub = t ? `${rankLabel(t.rank)}${st.group.name ? ` in the ${esc(st.group.name)}` : ''} · ${esc(t.pts)} pts · W${esc(t.w)} D${esc(t.d)} L${esc(t.l)}` : esc(gt?.record ?? '');
    let html = `<div class="tv"><div class="tv-head" style="--tc:${esc(gt?.color ?? '')}">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
      <div><div class="tv-name">${esc(full)}</div>
        <div class="tv-sub">${sub}${this._schedules[id]?.results ? ` ${formHTML(this._schedules[id].results.slice(0, 5).map(m => m.result).reverse())}` : ''}</div></div>
    </div><div class="tv-body">`;

    // Recent results and upcoming fixtures
    const sch = this._schedules[id];
    if (sch?.results) {
      const when = m => `${m.date.getMonth() + 1}/${m.date.getDate()}`;
      const opp = m => `<td class="tm" data-team="${esc(m.opp.id)}">${m.opp.logo ? `<img src="${esc(m.opp.logo)}" alt="" loading="lazy">` : ''}${m.home ? '' : '<span class="muted">at </span>'}${esc(m.opp.short)}</td>`;
      const res = sch.results.slice(0, RESULTS_SHOWN).map(m => `<tr><td class="dt">${when(m)}</td>${opp(m)}
          <td class="wl">${esc(m.gf)}–${esc(m.ga)}</td><td class="res"><i class="r${m.result}">${m.result}</i></td></tr>`).join('');
      const fix = sch.fixtures.slice(0, FIXTURES_SHOWN).map(m => `<tr><td class="dt">${when(m)}</td>${opp(m)}
          <td class="wl" colspan="2">${m.state === 'in' ? 'Live' : m.timeValid ? fmtTime(m.date) : 'TBD'}</td></tr>`).join('');
      html += `<div class="side">${res ? `<div><h4>Results</h4><table class="conf sched">${res}</table></div>` : ''}
        ${fix ? `<div><h4>Fixtures</h4><table class="conf sched">${fix}</table></div>` : ''}
        ${!res && !fix ? '<div class="empty muted">No matches this season yet.</div>' : ''}</div>`;
    } else {
      html += `<div class="${sch?.error ? 'err' : 'empty muted'}">${esc(sch?.error ?? 'Loading results…')}</div>`;
    }

    // The full table, with the zones ESPN marks (Champions League, relegation, …). Tap a club to switch to it.
    if (this._table?.groups.length) {
      const zones = new Map();
      const tables = this._table.groups.map(gr => {
        const rows = gr.teams.map(r => {
          if (r.zone?.color && r.zone.name) zones.set(r.zone.name, r.zone.color);
          return `<tr data-team="${esc(r.id)}" class="${r.id === id ? 'me' : ''}">
            <td class="sd"${r.zone?.color ? ` style="--zc:${esc(r.zone.color)}" title="${esc(r.zone.name)}"` : ''}>${r.rank}</td>
            <td class="tm">${r.logo ? `<img src="${esc(r.logo)}" alt="" loading="lazy">` : ''}${esc(r.short)}</td>
            <td class="n">${esc(r.gp)}</td><td class="n">${esc(r.w)}</td><td class="n">${esc(r.d)}</td><td class="n">${esc(r.l)}</td>
            <td class="n">${esc(signed(r.gd))}</td><td class="pt">${esc(r.pts)}</td></tr>`;
        }).join('');
        return `<div>${gr.name ? `<h4>${esc(gr.name)}</h4>` : ''}<table class="conf full">
          <tr><th></th><th></th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>${rows}</table></div>`;
      }).join('');
      const legend = [...zones].map(([name, color]) => `<span><i style="background:${esc(color)}"></i>${esc(name)}</span>`).join('');
      html += `<div class="side"><h4>Table</h4>${tables}${legend ? `<div class="legend">${legend}</div>` : ''}</div>`;
    }
    return html + '</div></div>';
  }

  _bind() {
    const $ = id => this.shadowRoot.getElementById(id);
    // Arrows move a whole round; within the round, swipe / scroll or tap a day chip
    $('left')?.addEventListener('click', () => this._slide(-1));
    $('right')?.addEventListener('click', () => this._slide(1));
    $('today')?.addEventListener('click', () => this._goToday());
    const strip = this.shadowRoot.querySelector('.cols');
    strip?.addEventListener('scroll', () => {
      this._markChips();
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._saveView(), 300); // once the swipe settles
    }, { passive: true });
    this.shadowRoot.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
      const step = this._colStep(strip);
      const i = Math.min(Number(ch.dataset.day), this._cols.length - this._vis); // the last days share the final screen
      strip.scrollTo({ left: i * step, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }));
    $('back')?.addEventListener('click', () => this._closeTeam());
    this.shadowRoot.querySelectorAll('[data-fold]').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.fold;
      if (!this._folded.delete(k)) this._folded.add(k);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify([...this._folded])); } catch { /* not remembered */ }
      this._render();
    }));
    this.shadowRoot.querySelectorAll('[data-team]').forEach(el =>
      el.addEventListener('click', () => this._openTeam(el.dataset.team)));
    $('refresh')?.addEventListener('click', () => { this._cols.forEach(c => { c.summary = null; }); this._schedules = {}; this._standingsAt = 0; this._refresh(); });
    this.shadowRoot.querySelectorAll('select[data-col]').forEach(sel => {
      const c = this._cols[Number(sel.dataset.col)];
      sel.addEventListener('change', async () => {
        c.selId = sel.value;
        sel.blur();
        this._render();
        await this._loadSummary(c);
        this._render();
      });
      sel.addEventListener('blur', () => { if (this._pending) { this._pending = false; setTimeout(() => this._render(), 0); } });
    });
  }
}

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, SoccerScoreboardCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: 'Soccer Scoreboard Card',
  description: 'Premier League (and other league) scores a round at a time, with goals, cards, match stats and the table.',
  preview: true,
  documentationURL: 'https://github.com/AOPW-llc/soccer-scoreboard-card',
});

console.info(`%c SOCCER-SCOREBOARD-CARD %c v${VERSION} `,
  'color:#fff;background:#3d195b;font-weight:bold', 'color:#3d195b;background:#fff');
