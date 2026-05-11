import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestoreDb = getFirestore(app);

export function loginAdmin(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logoutAdmin() {
  return signOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await getDoc(doc(firestoreDb, "admins", uid));
  const data = snap.exists() ? snap.data() : null;
  return !!(data && data.active === true && data.role === "admin");
}

export async function saveTeam(team) {
  const id = team.teamId || makeId("team");
  const now = serverTimestamp();
  await setDoc(doc(firestoreDb, "teams", id), { ...team, teamId: id, updatedAt: now, createdAt: team.createdAt || now }, { merge: true });
  return id;
}

export async function deleteTeam(teamId) {
  await deleteDoc(doc(firestoreDb, "teams", teamId));
}

export function listenTeams(callback, onError) {
  return onSnapshot(query(collection(firestoreDb, "teams"), orderBy("name")), async (snap) => {
    try {
      const teams = [];
      for (const teamDoc of snap.docs) {
        const playersSnap = await getDocs(query(collection(firestoreDb, "teams", teamDoc.id, "players"), orderBy("name")));
        const players = playersSnap.docs.map(p => ({ playerId: p.id, ...p.data() }));
        teams.push({ teamId: teamDoc.id, ...teamDoc.data(), players, playerCount: players.length });
      }
      callback(teams);
    } catch (error) {
      if (onError) onError(error);
      else console.error(error);
    }
  }, onError);
}

export async function savePlayer(teamId, player) {
  const id = player.playerId || makeId("player");
  const now = serverTimestamp();
  await setDoc(doc(firestoreDb, "teams", teamId, "players", id), { ...player, playerId: id, updatedAt: now, createdAt: player.createdAt || now }, { merge: true });
  // Touch parent team so listeners refresh player count after subcollection changes.
  await setDoc(doc(firestoreDb, "teams", teamId), { updatedAt: serverTimestamp() }, { merge: true });
  return id;
}

export async function deletePlayer(teamId, playerId) {
  await deleteDoc(doc(firestoreDb, "teams", teamId, "players", playerId));
}

export function listenPlayers(teamId, callback, onError) {
  if (!teamId) return () => {};
  return onSnapshot(query(collection(firestoreDb, "teams", teamId, "players"), orderBy("name")), (snap) => {
    callback(snap.docs.map(d => ({ playerId: d.id, ...d.data() })));
  }, onError);
}

export async function getTeamsWithPlayers() {
  const teamSnap = await getDocs(query(collection(firestoreDb, "teams"), orderBy("name")));
  const teams = [];
  for (const teamDoc of teamSnap.docs) {
    const playersSnap = await getDocs(query(collection(firestoreDb, "teams", teamDoc.id, "players"), orderBy("name")));
    teams.push({ teamId: teamDoc.id, ...teamDoc.data(), players: playersSnap.docs.map(p => ({ playerId: p.id, ...p.data() })) });
  }
  return teams;
}

export async function saveLeague(league) {
  const id = league.leagueId || makeId("league");
  const now = serverTimestamp();
  await setDoc(doc(firestoreDb, "leagues", id), { ...league, leagueId: id, updatedAt: now, createdAt: league.createdAt || now }, { merge: true });
  return id;
}

export async function deleteLeague(leagueId) {
  await deleteDoc(doc(firestoreDb, "leagues", leagueId));
}

export function listenLeagues(callback, onError) {
  return onSnapshot(query(collection(firestoreDb, "leagues"), orderBy("updatedAt", "desc")), (snap) => {
    callback(snap.docs.map(d => ({ leagueId: d.id, ...d.data() })));
  }, onError);
}

export async function saveMatch(matchId, payload) {
  await setDoc(doc(firestoreDb, "matches", matchId), { ...payload, matchId, updatedAt: serverTimestamp() }, { merge: true });
}

export function listenMatch(matchId, callback, onError) {
  if (!matchId) return () => {};
  return onSnapshot(doc(firestoreDb, "matches", matchId), (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError);
}

export async function getMatch(matchId) {
  const snap = await getDoc(doc(firestoreDb, "matches", matchId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveCompletedMatch(matchId, payload) {
  const clean = stripUndefined(payload);
  await Promise.all([
    setDoc(doc(firestoreDb, "matches", matchId), { ...clean, matchId, status: "completed", matchFinished: true, updatedAt: serverTimestamp(), completedAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(firestoreDb, "completedMatches", matchId), { ...clean, matchId, status: "completed", matchFinished: true, updatedAt: serverTimestamp(), completedAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(firestoreDb, "scorecards", matchId), { matchId, fullScorecardData: clean, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true })
  ]);
}

export async function updateCompletedMatchMvp(matchId, mvp) {
  const update = { playerOfMatch: mvp, mvp, updatedAt: serverTimestamp() };
  await Promise.all([
    updateDoc(doc(firestoreDb, "matches", matchId), update),
    updateDoc(doc(firestoreDb, "completedMatches", matchId), update)
  ]);
}

export async function deleteCompletedMatch(matchId) {
  await Promise.all([
    deleteDoc(doc(firestoreDb, "matches", matchId)),
    deleteDoc(doc(firestoreDb, "completedMatches", matchId)),
    deleteDoc(doc(firestoreDb, "scorecards", matchId))
  ]);
}

export async function getStoredScorecard(matchId) {
  const snap = await getDoc(doc(firestoreDb, "scorecards", matchId));
  return snap.exists() ? { matchId: snap.id, ...snap.data() } : null;
}

export function listenCompletedMatches(callback, onError) {
  return onSnapshot(query(collection(firestoreDb, "completedMatches"), orderBy("completedAt", "desc"), limit(50)), (snap) => {
    callback(snap.docs.map(d => ({ matchId: d.id, ...d.data() })));
  }, onError);
}

export async function getCompletedMatch(matchId) {
  const snap = await getDoc(doc(firestoreDb, "completedMatches", matchId));
  if (snap.exists()) return { matchId: snap.id, ...snap.data() };
  const m = await getMatch(matchId);
  return m && m.status === "completed" ? m : null;
}

export async function getLatestPublicMatch() {
  const liveSnap = await getDocs(query(collection(firestoreDb, "matches"), orderBy("updatedAt", "desc"), limit(25)));
  const live = liveSnap.docs
    .map(d => ({ matchId: d.id, ...d.data() }))
    .find(m => (m.liveStarted === true || m.status === "live") && m.matchFinished !== true && m.status !== "completed");
  if (live) return live;

  const completedSnap = await getDocs(query(collection(firestoreDb, "completedMatches"), orderBy("completedAt", "desc"), limit(1)));
  if (!completedSnap.empty) {
    const docSnap = completedSnap.docs[0];
    return { matchId: docSnap.id, ...docSnap.data() };
  }
  return null;
}

export async function savePlayerMatchStats(matchId, players) {
  const writes = [];
  Object.values(players || {}).forEach(stat => {
    const playerId = stat.playerId || safeId(stat.playerName || stat.name || "player");
    writes.push(setDoc(doc(firestoreDb, "playerMatchStats", `${matchId}_${playerId}`), { ...stat, matchId, playerId, updatedAt: serverTimestamp() }, { merge: true }));
  });
  await Promise.all(writes);
}

export async function saveSavedLink(link) {
  const id = link.linkId || link.matchId || makeId("link");
  await setDoc(doc(firestoreDb, "savedLinks", id), { ...link, linkId: id, updatedAt: serverTimestamp(), createdAt: link.createdAt || serverTimestamp() }, { merge: true });
  return id;
}

export function makeId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function safeId(text) {
  return String(text || "id").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || makeId("id");
}

export function stripUndefined(value) {
  if (value === undefined) return null;
  if (Number.isNaN(value)) return 0;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}
