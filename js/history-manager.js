import { saveMatchStore, saveCompletedMatch } from "./firebase-store.js";

function cleanForFirebase(value) {
  if (value === undefined) return null;
  if (typeof value === "number" && Number.isNaN(value)) return 0;

  if (Array.isArray(value)) {
    return value.map(cleanForFirebase);
  }

  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((key) => {
      const v = value[key];
      if (v !== undefined) out[key] = cleanForFirebase(v);
    });
    return out;
  }

  return value;
}

function deepClone(value) {
  return cleanForFirebase(JSON.parse(JSON.stringify(value ?? {})));
}

function overText(balls) {
  const n = Number(balls || 0);
  return Math.floor(n / 6) + "." + (n % 6);
}

function buildFinalSnapshot({ matchId, state = {}, updatedBy = "" }) {
  const snapshot = deepClone(state);

  snapshot.matchId = matchId;
  snapshot.id = snapshot.id || matchId;
  snapshot.status = "completed";
  snapshot.liveStarted = false;
  snapshot.matchFinished = true;
  snapshot.scoringLocked = true;
  snapshot.updatedBy = updatedBy || snapshot.updatedBy || "";
  snapshot.completedAt = snapshot.completedAt || new Date().toISOString();

  snapshot.title = snapshot.title || snapshot.matchTitle || "Completed Match";
  snapshot.matchTitle = snapshot.matchTitle || snapshot.title || "Completed Match";
  snapshot.winnerText = snapshot.winnerText || "Result pending";

  if (!snapshot.firstInnings && snapshot.firstInningsScore !== undefined && snapshot.firstInningsScore !== null) {
    snapshot.firstInnings = `${Number(snapshot.firstInningsScore || 0)}/${Number(snapshot.firstInningsWkts || 0)}`;
  }

  if (!snapshot.secondInnings) {
    snapshot.secondInnings = `${Number(snapshot.runs || 0)}/${Number(snapshot.wkts || 0)} (${overText(snapshot.balls || 0)})`;
  }

  // Scorecard data same snapshot me Firestore matches/matchHistory me bhi save rahega.
  snapshot.fullScorecardData = snapshot.fullScorecardData || {
    matchId,
    title: snapshot.matchTitle || snapshot.title || "Scorecard",
    winnerText: snapshot.winnerText || "",
    firstInnings: snapshot.firstInnings || "",
    secondInnings: snapshot.secondInnings || "",
    inningsDetails: snapshot.inningsDetails || {},
    completedInnings: snapshot.completedInnings || {},
    completedBowling: snapshot.completedBowling || {},
    commentary: snapshot.commentary || [],
    fallOfWickets: snapshot.fallOfWickets || []
  };

  return cleanForFirebase(snapshot);
}

export async function persistCompletedMatch({ matchId, state, updatedBy = "", archiveRealtime = true } = {}) {
  if (!matchId) throw new Error("persistCompletedMatch: matchId missing");

  const finalSnapshot = buildFinalSnapshot({ matchId, state, updatedBy });

  // matches/{matchId}, matchHistory/{matchId}, settings, league, tournamentStats
  await saveMatchStore(matchId, finalSnapshot, { mirrorLegacy: true });

  // completedMatches/{matchId or id}
  if (typeof saveCompletedMatch === "function") {
    await saveCompletedMatch({
      ...finalSnapshot,
      id: matchId,
      matchId
    });
  }

  return finalSnapshot;
}

export default persistCompletedMatch;
