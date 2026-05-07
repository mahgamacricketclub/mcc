import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const firestoreDb = getFirestore(app);

export const TEAM_CATALOG_ID = "teamCatalog";

// Cloud Firestore is used for durable structured cricket data:
// teams, players, history, league schedule, points table, settings, users, stats, and saved links.
export function listenTeamCatalog(onData, onError) {
  return onSnapshot(doc(firestoreDb, "teams", TEAM_CATALOG_ID), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data() : null);
  }, onError);
}

export async function saveTeamCatalogData({ teams, teamInfo, updatedBy }) {
  const teamMap = teams || {};
  const infoMap = teamInfo || {};
  await setDoc(doc(firestoreDb, "teams", TEAM_CATALOG_ID), {
    teams: teamMap,
    teamInfo: infoMap,
    updatedBy: updatedBy || "",
    timestamp: Date.now(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  const writes = [];
  Object.entries(teamMap).forEach(([teamName, players]) => {
    const teamId = safeDocId(teamName);
    writes.push(setDoc(doc(firestoreDb, "teams", teamId), {
      name: teamName,
      players: Array.isArray(players) ? players : [],
      ...(infoMap[teamName] || {}),
      updatedBy: updatedBy || "",
      updatedAt: serverTimestamp()
    }, { merge: true }));

    (Array.isArray(players) ? players : []).forEach((playerName) => {
      writes.push(setDoc(doc(firestoreDb, "players", safeDocId(`${teamName}_${playerName}`)), {
        name: playerName,
        team: teamName,
        ...(infoMap[teamName]?.players?.[playerName] || {}),
        updatedBy: updatedBy || "",
        updatedAt: serverTimestamp()
      }, { merge: true }));
    });
  });

  await Promise.allSettled(writes);
  return true;
}

export function listenMatchStore(matchId, onData, onError) {
  // Read from the compatibility mirror so existing Firebase rules and old public links keep working.
  // Admin saves the same durable payload to matchHistory/{matchId} for the professional data model.
  return onSnapshot(doc(firestoreDb, "matches", matchId), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data() : null);
  }, onError);
}

export async function getLegacyMatchStore(matchId) {
  const snapshot = await getDoc(doc(firestoreDb, "matches", matchId));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveMatchStore(matchId, payload, { mirrorLegacy = true } = {}) {
  const data = {
    ...payload,
    timestamp: Date.now(),
    updatedAt: serverTimestamp()
  };
  if (mirrorLegacy) {
    // Compatibility mirror is primary because existing deployed rules and public scorecard links use it.
    await setDoc(doc(firestoreDb, "matches", matchId), data, { merge: true });
  }

  const writes = [
    setDoc(doc(firestoreDb, "matchHistory", matchId), data, { merge: true }),
    setDoc(doc(firestoreDb, "settings", `match_${matchId}`), {
      matchId,
      matchTitle: payload.matchTitle || "",
      liveStarted: !!payload.liveStarted,
      matchFinished: !!payload.matchFinished,
      archived: !!payload.archived,
      updatedAt: serverTimestamp()
    }, { merge: true }),
    setDoc(doc(firestoreDb, "league", matchId), {
      league: payload.league || {},
      pointsTable: payload.pointsTable || {},
      updatedAt: serverTimestamp()
    }, { merge: true }),
    setDoc(doc(firestoreDb, "tournamentStats", matchId), {
      tournamentStats: payload.tournamentStats || { players: {} },
      mvpLog: payload.mvpLog || [],
      updatedAt: serverTimestamp()
    }, { merge: true })
  ];
  await Promise.allSettled(writes);
  return true;
}

export function saveCompletedMatch(match) {
  const id = String(match?.id || Date.now());
  return setDoc(doc(firestoreDb, "completedMatches", id), {
    ...match,
    completedAt: match?.playedAt || new Date().toISOString(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function saveSavedLinks(matchId, links) {
  return setDoc(doc(firestoreDb, "savedLinks", matchId), {
    links: Array.isArray(links) ? links : [],
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function safeDocId(value) {
  return encodeURIComponent(String(value || "item")).replace(/\./g, "%2E").slice(0, 140);
}
