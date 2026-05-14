export function clone(value) {
  return JSON.parse(JSON.stringify(clean(value)));
}

export function clean(value) {
  if (value === undefined) return null;
  if (Number.isNaN(value)) return 0;
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) out[key] = clean(val);
    }
    return out;
  }
  return value;
}

export function overText(balls) {
  const n = Number(balls || 0);
  return `${Math.floor(n / 6)}.${n % 6}`;
}

export function calcSR(runs, balls) {
  return Number(balls || 0) ? ((Number(runs || 0) / Number(balls || 0)) * 100).toFixed(2) : "0.00";
}

export function calcER(runs, balls) {
  return Number(balls || 0) ? (Number(runs || 0) / (Number(balls || 0) / 6)).toFixed(2) : "0.00";
}

export function normalizeBatter(b = {}) {
  const fours = Number(b.fours ?? b.f ?? 0);
  const sixes = Number(b.sixes ?? b.s ?? 0);
  return {
    playerId: b.playerId || "",
    name: b.name || "-",
    r: Number(b.r ?? b.runs ?? 0),
    b: Number(b.b ?? b.balls ?? 0),
    f: fours,
    s: sixes,
    fours,
    sixes,
    dots: Number(b.dots ?? b.d ?? 0),
    d: Number(b.d ?? b.dots ?? 0),
    out: !!b.out,
    retired: !!b.retired,
    dismissal: b.dismissal || "",
    position: Number(b.position || 0)
  };
}

export function normalizeBowler(b = {}) {
  return {
    playerId: b.playerId || "",
    name: b.name || "-",
    balls: Number(b.balls || 0),
    r: Number(b.r ?? b.runs ?? 0),
    w: Number(b.w ?? b.wkts ?? 0),
    runs: Number(b.runs ?? b.r ?? 0),
    wkts: Number(b.wkts ?? b.w ?? 0),
    dots: Number(b.dots || 0),
    wides: Number(b.wides || 0),
    noBalls: Number(b.noBalls || 0)
  };
}

export function livePayload(state, matchId, updatedBy = "") {
  const s = normalizeState(state);
  return clean({
    matchId,
    updatedBy,
    matchTitle: s.matchTitle,
    leagueId: s.leagueId,
    leagueName: s.leagueName,
    liveStarted: !!s.liveStarted,
    matchFinished: !!s.matchFinished,
    status: s.status,
    scoringLocked: !!s.scoringLocked,
    liveControl: s.liveControl || { mode: "live" },
    teamA: s.teamA,
    teamB: s.teamB,
    battingTeam: s.battingTeam,
    bowlingTeam: s.bowlingTeam,
    tossWinner: s.tossWinner,
    tossDecision: s.tossDecision,
    tossText: s.tossText,
    inningNumber: Number(s.inningNumber || 1),
    totalOvers: Number(s.totalOvers || 20),
    runs: Number(s.runs || 0),
    wkts: Number(s.wkts || 0),
    wickets: Number(s.wkts || 0),
    balls: Number(s.balls || 0),
    overs: overText(s.balls || 0),
    extras: Number(s.extras || 0),
    target: s.target ?? null,
    firstInnings: s.firstInnings || "",
    secondInnings: s.secondInnings || "",
    firstInningsScore: s.firstInningsScore ?? null,
    firstInningsWkts: s.firstInningsWkts ?? null,
    firstBattingTeam: s.firstBattingTeam || null,
    secondBattingTeam: s.secondBattingTeam || null,
    bat1: normalizeBatter(s.bat1),
    bat2: normalizeBatter(s.bat2),
    striker: Number(s.striker || 1),
    bowler: normalizeBowler(s.bowler),
    bowlerStats: s.bowlerStats || {},
    battingScorecard: s.battingScorecard || [],
    completedInnings: s.completedInnings || {},
    completedBowling: s.completedBowling || {},
    inningsDetails: s.inningsDetails || {},
    commentary: (s.commentary || []).slice(0, 120),
    over: s.over || [],
    overSummary: s.overSummary || [],
    recentBalls: s.recentBalls || [],
    fallOfWickets: s.fallOfWickets || [],
    partnershipRuns: Number(s.partnershipRuns || 0),
    partnershipBalls: Number(s.partnershipBalls || 0),
    lastWicket: s.lastWicket || "-",
    highlights: (s.highlights || []).slice(0, 30),
    teamInfo: s.teamInfo || {},
    teams: s.teams || {},
    pointsTable: s.pointsTable || {},
    league: s.league || null,
    winnerText: s.winnerText || "",
    superOver: s.superOver || null,
    mvp: s.mvp || "",
    playerOfMatch: s.playerOfMatch || s.mvp || "",
    followLink: s.followLink || "",
    updatedAt: Date.now()
  });
}

export function storePayload(state, matchId, updatedBy = "") {
  const s = normalizeState(state);
  const copy = clone({ ...s, matchId, updatedBy });
  delete copy.undoStack;
  return clean(copy);
}

export function normalizeState(state = {}) {
  const s = { ...state };
  s.bat1 = normalizeBatter(s.bat1);
  s.bat2 = normalizeBatter(s.bat2);
  s.bowler = normalizeBowler(s.bowler);
  ["over", "overSummary", "recentBalls", "commentary", "fallOfWickets", "highlights", "battingScorecard"].forEach(k => {
    if (!Array.isArray(s[k])) s[k] = [];
  });
  ["bowlerStats", "completedInnings", "completedBowling", "inningsDetails", "teamInfo", "teams", "pointsTable"].forEach(k => {
    if (!s[k] || typeof s[k] !== "object" || Array.isArray(s[k])) s[k] = {};
  });
  return s;
}

export function mergeMatch(live, store, fallback = {}) {
  const f = fallback || {};
  const st = store || {};
  const lv = live || {};
  const merged = { ...f, ...st, ...lv };
  if (st.matchFinished || st.status === "completed") return normalizeState({ ...merged, ...st, onlineViewers: lv.onlineViewers || f.onlineViewers || 0 });
  return normalizeState(merged);
}
