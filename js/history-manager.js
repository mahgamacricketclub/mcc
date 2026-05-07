import { firestoreDb, doc, getDoc, onSnapshot } from "./firebase-store.js";

export async function readPermanentMatch(matchId) {
  const snap = await getDoc(doc(firestoreDb, "matches", matchId));
  return snap.exists() ? snap.data() : null;
}

export function listenPermanentMatch(matchId, callback, errorCallback) {
  return onSnapshot(doc(firestoreDb, "matches", matchId), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  }, errorCallback);
}
