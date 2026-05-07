import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const realtimeDb = getDatabase(firebaseApp);

export const liveMatchPath = (matchId) => `liveMatches/${matchId}`;
export const liveMatchRef = (matchId) => ref(realtimeDb, liveMatchPath(matchId));

export function sanitizeForRealtime(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sanitizeForRealtime);
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      if (typeof item !== "undefined") out[key] = sanitizeForRealtime(item);
    });
    return out;
  }
  return value;
}

export function buildLivePayload(state, matchId) {
  const maxBalls = Math.max(1, Number(state.totalOvers || 20) * 6);
  const balls = Number(state.balls || 0);
  const runs = Number(state.runs || 0);
  const target = state.target ? Number(state.target) : null;
  const need = target ? Math.max(target - runs, 0) : null;
  const remBalls = Math.max(maxBalls - balls, 0);
  const crr = balls > 0 ? Number((runs / (balls / 6)).toFixed(2)) : 0;
  const rrr = target ? (remBalls > 0 ? Number(((need * 6) / remBalls).toFixed(2)) : (need > 0 ? 999 : 0)) : null;

  return sanitizeForRealtime({
    matchId,
    liveSource: "realtime-db",
    liveStarted: !!state.liveStarted,
    matchFinished: !!state.matchFinished,
    matchTitle: state.matchTitle || "Live Match",
    battingTeam: state.battingTeam || "",
    bowlingTeam: state.bowlingTeam || "",
    teamA: state.teamA || "",
    teamB: state.teamB || "",
    teams: state.teams || {},
    teamInfo: state.teamInfo || {},
    tossText: state.tossText || "Toss pending",
    tossWinner: state.tossWinner || "",
    tossDecision: state.tossDecision || "",
    inningNumber: Number(state.inningNumber || 1),
    totalOvers: Number(state.totalOvers || 20),
    runs,
    wkts: Number(state.wkts || 0),
    balls,
    oversText: `${Math.floor(balls / 6)}.${balls % 6}`,
    extras: Number(state.extras || 0),
    striker: Number(state.striker || 1),
    bat1: state.bat1 || { name: "-", r: 0, b: 0, f: 0, s: 0 },
    bat2: state.bat2 || { name: "-", r: 0, b: 0, f: 0, s: 0 },
    bowler: state.bowler || { name: "-", balls: 0, r: 0, w: 0 },
    over: state.over || [],
    overSummary: state.overSummary || [],
    commentary: state.commentary || [],
    highlights: state.highlights || [],
    battingScorecard: state.battingScorecard || [],
    bowlerStats: state.bowlerStats || {},
    fallOfWickets: state.fallOfWickets || [],
    lastWicket: state.lastWicket || "-",
    lastOverBowler: state.lastOverBowler || "-",
    partnershipRuns: Number(state.partnershipRuns || 0),
    partnershipBalls: Number(state.partnershipBalls || 0),
    firstInningsScore: state.firstInningsScore ?? null,
    firstInningsWkts: state.firstInningsWkts ?? null,
    target,
    need,
    crr,
    rrr,
    liveControl: state.liveControl || { mode: "live", note: "Live" },
    scoringLocked: !!state.scoringLocked,
    winnerText: state.winnerText || "",
    inningsDetails: state.inningsDetails || {},
    completedInnings: state.completedInnings || {},
    completedBowling: state.completedBowling || {},
    followLink: state.followLink || "",
    updatedAt: Date.now(),
    serverUpdatedAt: serverTimestamp()
  });
}

export async function publishLiveMatch(matchId, state) {
  return set(liveMatchRef(matchId), buildLivePayload(state, matchId));
}

export async function patchLiveMatch(matchId, patch) {
  return update(liveMatchRef(matchId), sanitizeForRealtime({ ...patch, updatedAt: Date.now(), serverUpdatedAt: serverTimestamp() }));
}

export async function readLiveMatch(matchId) {
  const snap = await get(liveMatchRef(matchId));
  return snap.exists() ? snap.val() : null;
}

export function listenLiveMatch(matchId, callback, errorCallback) {
  return onValue(liveMatchRef(matchId), (snap) => callback(snap.exists() ? snap.val() : null), errorCallback);
}

export async function removeLiveMatch(matchId) {
  return remove(liveMatchRef(matchId));
}

export function trackViewer(matchId) {
  const viewerId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const viewerRef = ref(realtimeDb, `liveViewers/${matchId}/${viewerId}`);
  set(viewerRef, { online: true, joinedAt: Date.now() }).catch(() => {});
  onDisconnect(viewerRef).remove().catch(() => {});
  return viewerRef;
}
