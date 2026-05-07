import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firestoreDb = getFirestore(firebaseApp);

export { doc, setDoc, getDoc, onSnapshot, collection, serverTimestamp };

export function cleanForFirestore(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(cleanForFirestore);
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      if (typeof item !== "undefined") out[key] = cleanForFirestore(item);
    });
    return out;
  }
  return value;
}

export function permanentMatchDoc(state, matchId) {
  const data = cleanForFirestore({
    ...state,
    matchId,
    teamCatalog: state.teams || {},
    teamInfo: state.teamInfo || {},
    timestamp: Date.now(),
    firestoreUpdatedAt: serverTimestamp()
  });
  delete data.history;
  delete data.ballHistory;
  delete data.ballEvents;
  return data;
}

export async function saveMatchPermanent(matchId, state, { merge = false } = {}) {
  return setDoc(doc(firestoreDb, "matches", matchId), permanentMatchDoc(state, matchId), { merge });
}

export async function saveCompletedMatchEverywhere(matchId, completedMatch, state = {}) {
  const cleanMatch = cleanForFirestore({
    ...completedMatch,
    matchId,
    completedAt: completedMatch.playedAt || new Date().toISOString(),
    firestoreSavedAt: serverTimestamp()
  });

  await setDoc(doc(firestoreDb, "matchHistory", matchId), cleanMatch, { merge: true });
  await setDoc(doc(firestoreDb, "completedMatches", matchId), cleanMatch, { merge: true });

  if (cleanMatch.id) {
    await setDoc(doc(firestoreDb, "matchHistoryItems", String(cleanMatch.id)), cleanMatch, { merge: true });
  }

  const summary = permanentMatchDoc(state, matchId);
  await setDoc(doc(firestoreDb, "matches", matchId), summary, { merge: true });
}
