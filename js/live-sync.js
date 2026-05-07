const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const compactBallEvent = (ev) => ({
  id: ev?.id || "",
  ball: ev?.ball || "",
  label: ev?.label || "",
  text: ev?.text || "",
  score: ev?.score || ""
});

// Keep this payload small and hot. It is the Cricbuzz-style live feed.
// Anything long-lived or administrative stays in Firestore via firebase-store.js.
export function buildLivePayload(state, { matchId, updatedBy } = {}) {
  const liveControl = state.liveControl || { mode: "live", note: "" };
  return {
    matchId,
    updatedBy: updatedBy || "",
    liveStarted: !!state.liveStarted,
    matchFinished: !!state.matchFinished,
    archived: !!state.archived,
    matchTitle: state.matchTitle || "Live Match",
    battingTeam: state.battingTeam || "",
    bowlingTeam: state.bowlingTeam || "",
    tossText: state.tossText || "Toss pending",
    inningNumber: Number(state.inningNumber || 1),
    totalOvers: Number(state.totalOvers || 20),
    runs: Number(state.runs || 0),
    wkts: Number(state.wkts || 0),
    wickets: Number(state.wkts || 0),
    balls: Number(state.balls || 0),
    overs: overText(state.balls || 0),
    extras: Number(state.extras || 0),
    striker: Number(state.striker || 1),
    bat1: clone(state.bat1 || { name: "-", r: 0, b: 0, f: 0, s: 0 }),
    bat2: clone(state.bat2 || { name: "-", r: 0, b: 0, f: 0, s: 0 }),
    bowler: clone(state.bowler || { name: "-", balls: 0, r: 0, w: 0 }),
    bowlerStats: clone(state.bowlerStats || {}),
    currentBowler: state.bowler?.name || "-",
    over: clone(state.over || []),
    currentOverTimeline: clone(state.over || []),
    overSummary: clone(state.overSummary || []),
    commentary: clone((state.commentary || []).slice(-80)),
    highlights: clone((state.highlights || []).slice(-30)),
    ballEvents: clone((state.ballEvents || []).slice(-20).map(compactBallEvent)),
    fallOfWickets: clone(state.fallOfWickets || []),
    lastWicket: state.lastWicket || "-",
    lastOverBowler: state.lastOverBowler || "-",
    partnershipRuns: Number(state.partnershipRuns || 0),
    partnershipBalls: Number(state.partnershipBalls || 0),
    firstInningsScore: state.firstInningsScore ?? null,
    firstInningsWkts: state.firstInningsWkts ?? null,
    target: state.target ?? null,
    scoringLocked: !!state.scoringLocked,
    liveControl,
    liveStatus: liveControl.mode === "paused" ? "BREAK" : (liveControl.mode === "delay" ? "DELAY" : "LIVE"),
    winnerText: state.winnerText || "",
    followLink: state.followLink || ""
  };
}

export function buildStorePayload(state, { matchId, updatedBy } = {}) {
  const data = {
    ...clone(state),
    matchId,
    updatedBy: updatedBy || "",
    teamCatalog: state.teams || {},
    teams: state.teams || {},
    teamInfo: state.teamInfo || {}
  };
  delete data.history;
  delete data.ballHistory;
  delete data.ballEvents;
  return data;
}

export function mergeLiveAndStore(liveData, storeData, cachedState = {}) {
  const store = storeData && typeof storeData === "object" ? storeData : {};
  const live = liveData && typeof liveData === "object" ? liveData : {};
  const cached = cachedState && typeof cachedState === "object" ? cachedState : {};
  const storeCompleted = Array.isArray(store.completedMatches) && store.completedMatches.length ? store.completedMatches : null;
  const cachedCompleted = Array.isArray(cached.completedMatches) ? cached.completedMatches : [];
  const storeLeagueHasSchedule = Array.isArray(store.league?.schedule) && store.league.schedule.length;
  return {
    ...cached,
    ...store,
    ...live,
    teams: store.teams || store.teamCatalog || cached.teams || cached.teamCatalog || {},
    teamInfo: store.teamInfo || cached.teamInfo || {},
    completedMatches: storeCompleted || cachedCompleted,
    tournamentStats: store.tournamentStats || cached.tournamentStats || { players: {} },
    pointsTable: store.pointsTable || cached.pointsTable || {},
    mvpLog: store.mvpLog || cached.mvpLog || [],
    league: storeLeagueHasSchedule ? store.league : (cached.league || store.league || { name: "", teams: [], overs: 20, format: "single", playoffs: true, schedule: [] }),
    onlineViewers: live.onlineViewers || cached.onlineViewers || 0
  };
}

function overText(balls) {
  const n = Number(balls || 0);
  return Math.floor(n / 6) + "." + (n % 6);
}
