import { readLiveMatch, removeLiveMatch } from "./firebase-live.js";
import { saveCompletedMatchEverywhere } from "./firebase-store.js";

export async function completeHybridMatch(matchId, completedMatch, state) {
  const latestLive = await readLiveMatch(matchId).catch(() => null);
  const finalMatch = {
    ...(latestLive || {}),
    ...(completedMatch || {}),
    matchFinished: true,
    liveStarted: false,
    completedAt: new Date().toISOString()
  };
  await saveCompletedMatchEverywhere(matchId, finalMatch, state);
  await removeLiveMatch(matchId);
  return finalMatch;
}
