import { archiveLiveMatch, clearLiveMatch } from "./firebase-live.js";
import { saveCompletedMatch, saveMatchStore } from "./firebase-store.js";
import { buildStorePayload } from "./live-sync.js";

// Completion is a Firestore workflow: final scorecards, league results, points table,
// tournament stats, and match history need durable indexed documents.
export async function persistCompletedMatch({ matchId, state, updatedBy, archiveRealtime = true }) {
  const latest = Array.isArray(state.completedMatches) ? state.completedMatches[0] : null;
  const storePayload = buildStorePayload(state, { matchId, updatedBy });
  const writes = [saveMatchStore(matchId, storePayload)];
  if (latest) writes.push(saveCompletedMatch(latest).catch((error) => console.warn("Completed match archive skipped", error)));
  if (archiveRealtime) {
    writes.push(archiveLiveMatch(matchId, {
      matchTitle: latest?.title || state.matchTitle || "Completed Match",
      winnerText: latest?.winnerText || state.winnerText || "",
      runs: Number(latest?.runs ?? state.runs ?? 0),
      wkts: Number(latest?.wkts ?? state.wkts ?? 0),
      balls: Number(latest?.balls ?? state.balls ?? 0),
      firstInnings: latest?.firstInnings || "",
      secondInnings: latest?.secondInnings || ""
    }));
  }
  await Promise.all(writes);
}

export function removeLiveArchive(matchId) {
  return clearLiveMatch(matchId);
}
