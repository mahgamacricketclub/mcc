import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  onDisconnect,
  serverTimestamp,
  remove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const realtimeDb = getDatabase(app);

export const liveMatchPath = (matchId) => `liveMatches/${matchId}`;

// Realtime Database is used only for volatile live data that must reach fans instantly:
// score, wickets, overs, striker/non-striker, bowler, ball timeline, commentary, status, and viewer presence.
export function listenLiveMatch(matchId, onData, onError) {
  return onValue(ref(realtimeDb, liveMatchPath(matchId)), (snapshot) => {
    onData(snapshot.exists() ? snapshot.val() : null);
  }, onError);
}

export function writeLiveMatch(matchId, payload) {
  return update(ref(realtimeDb, liveMatchPath(matchId)), {
    ...payload,
    updatedAt: serverTimestamp()
  });
}

export function patchLiveMatch(matchId, patch) {
  return update(ref(realtimeDb, liveMatchPath(matchId)), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export function archiveLiveMatch(matchId, archivePayload = {}) {
  return update(ref(realtimeDb, liveMatchPath(matchId)), {
    ...archivePayload,
    liveStarted: false,
    matchFinished: true,
    archived: true,
    liveControl: { mode: "paused", note: "Match Complete" },
    updatedAt: serverTimestamp()
  });
}

export function clearLiveMatch(matchId) {
  return remove(ref(realtimeDb, liveMatchPath(matchId)));
}

export function trackViewer(matchId, viewerId, onCount) {
  const viewerRef = ref(realtimeDb, `${liveMatchPath(matchId)}/viewers/${viewerId}`);
  const viewersRef = ref(realtimeDb, `${liveMatchPath(matchId)}/viewers`);
  set(viewerRef, { online: true, joinedAt: serverTimestamp() }).catch(console.warn);
  onDisconnect(viewerRef).remove();
  return onValue(viewersRef, (snapshot) => {
    const viewers = snapshot.val() || {};
    onCount(Object.keys(viewers).length);
  });
}

export function listenObsControl(matchId, onData, onError) {
  return onValue(ref(realtimeDb, `obsControls/${matchId}`), (snapshot) => {
    onData(snapshot.exists() ? snapshot.val() : null);
  }, onError);
}

export function saveObsControl(matchId, payload) {
  return update(ref(realtimeDb, `obsControls/${matchId}`), {
    ...payload,
    updatedAt: serverTimestamp()
  });
}

export async function fetchLiveMatchRest(matchId) {
  if (!firebaseConfig.databaseURL) return null;
  const url = `${firebaseConfig.databaseURL.replace(/\/$/, "")}/${liveMatchPath(matchId)}.json`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Realtime REST read failed: ${response.status}`);
  return response.json();
}
