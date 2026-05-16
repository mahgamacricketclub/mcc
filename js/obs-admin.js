import { firebaseConfig } from "../firebase/firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, onValue, update, get, query, orderByChild, limitToLast, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const fsdb = getFirestore(app);
const $ = id => document.getElementById(id);
const cardThemes = ["matchboard","inningsboard","chaseboard","resultboard","scorestrip","tournamenttable","playerstatsboard","battingcard","bowlingcard","partnershipboard","fallwicketsboard","overbyoverboard","squadboard","tossboard","nextmatchboard","scorebug","lower","topbar","vertical","minimal","commentary","wicket","target","broadcast","player","partnership","rate","slate","sponsor","ticker","squad","neon","powerplay","fow","lastwicket","bowling","winprob","oversummary","nextbatter","summary","rrmeter","moment","toss","playingxi","battercomp","bowlercomp","timeline","result","venue","inningsbreak","milestone","review"];
const sceneMap = {
  Live:["scorestrip","sponsor"],
  Normal:["scorebug","ticker","sponsor"],
  Compact:["minimal","ticker","sponsor"],
  Wicket:["scorestrip","lastwicket","ticker"],
  Boundary:["scorestrip","oversummary","ticker"],
  Chase:["scorestrip","rate","rrmeter","winprob"],
  Powerplay:["scorestrip","powerplay","sponsor"],
  Batting:["scorestrip","player","partnership"],
  Bowling:["scorestrip","bowling","oversummary"],
  Review:["scorestrip","review"],
  Timeline:["scorestrip","timeline"],
  Break:["inningsbreak","summary","sponsor"],
  "Pre Match":["slate","toss","playingxi","venue","sponsor"],
  Result:["result","moment","summary","ticker"],
  Summary:["matchboard"],
  "TV Strip":["scorestrip"],
  "Points Table":["tournamenttable"],
  "Player Stats":["playerstatsboard"],
  "Batting Card":["battingcard"],
  "Bowling Card":["bowlingcard"],
  "Partnership Board":["partnershipboard"],
  "FOW Board":["fallwicketsboard"],
  "Over Board":["overbyoverboard"],
  "Squad Board":["squadboard"],
  "Toss Board":["tossboard"],
  "Next Match":["nextmatchboard"]
};
const hotTypes = ["FOUR","SIX","WICKET","50","100","REVIEW","POWERPLAY","TIMEOUT","DRINKS","TARGET","BATTER","PARTNERSHIP"];
const state = { matchId:"liveMatch1", selected:new Set(["scorebug","ticker","sponsor"]), selectedCard:"", positions:{}, edit:true, unsub:null, control:{} };
const LOCKED_MATCH_KEY = "obs_admin_locked_match_id";

function bindAuth(){
  $("loginBtn").onclick = login;
  $("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  $("logoutBtn").onclick = () => signOut(auth);
  onAuthStateChanged(auth, async user => {
    if (!user) return showLogin();
    try {
      const ok = await isAdmin(user.uid);
      if (!ok) {
        $("loginMessage").textContent = "This account does not have admin access.";
        await signOut(auth);
        return showLogin();
      }
      showAdmin();
      init();
    } catch (e) {
      $("loginMessage").textContent = e.message || String(e);
      await signOut(auth).catch(() => {});
      showLogin();
    }
  });
}

async function login(){
  $("loginMessage").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (e) {
    $("loginMessage").textContent = "Sign-in failed: " + (e.code || e.message);
  }
}

async function isAdmin(uid){
  if (!uid) return false;
  const snap = await getDoc(doc(fsdb, "admins", uid));
  const data = snap.exists() ? snap.data() : null;
  return !!(data && data.active === true && data.role === "admin");
}

function showLogin(){
  $("loginScreen").classList.remove("hidden");
  $("adminApp").classList.add("hidden");
  if (state.unsub) {
    state.unsub();
    state.unsub = null;
  }
}

function showAdmin(){
  $("loginScreen").classList.add("hidden");
  $("adminApp").classList.remove("hidden");
}

function init(){
  if (state.initialized) {
    fetchLiveMatches();
    loadMatch();
    refreshPreview();
    return;
  }
  state.initialized = true;
  buildCards(); buildScenes(); buildHot(); bind();
  applyLockedMatch();
  loadLocal();
  fetchLiveMatches();
  loadMatch();
  renderLinks();
  refreshPreview();
  scalePreview();
}

function buildCards(){
  $("cardsList").innerHTML = cardThemes.map(t => `<div class="card-row" data-toggle-card="${t}"><input type="checkbox" id="show_${t}" data-theme="${t}"><span>${t}</span><button class="small" data-preview="${t}">Preview</button><button class="small primary" data-push="${t}">Push</button><button class="small danger" data-unpush="${t}">Unpush</button></div>`).join("");
  cardThemes.forEach(t => $(`show_${t}`).checked = state.selected.has(t));
}
function buildScenes(){ $("sceneGrid").innerHTML = Object.keys(sceneMap).map(s => `<button data-scene="${s}">${s}</button>`).join(""); }
function buildHot(){ $("hotGrid").innerHTML = hotTypes.map(h => `<button data-hot="${h}">${h}</button>`).join(""); }

function bind(){
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => openTab(b.dataset.tab));
  $("loadBtn").onclick = loadMatch;
  $("lockMatchBtn").onclick = toggleMatchLock;
  $("pushLiveBtn").onclick = pushLive;
  $("clearAllCards").onclick = clearAllCards;
  $("refreshPreview").onclick = refreshPreview;
  $("toggleEdit").onclick = () => { state.edit = !state.edit; $("toggleEdit").textContent = state.edit ? "Edit Mode On" : "Edit Mode Off"; refreshPreview(); };
  $("resetPositions").onclick = () => { state.positions = {}; refreshPreview(); toast("Positions reset. Push Live to apply changes."); };
  $("saveLocal").onclick = saveLocal;
  $("clearLocal").onclick = () => { localStorage.removeItem(localKey()); toast("Local settings cleared."); };
  $("openOverlay").onclick = () => window.open(mainUrl(false), "_blank");
  $("matchId").addEventListener("change", loadMatch);
  $("matchSelect").addEventListener("change", () => {
    if (!$("matchSelect").value) return;
    $("matchId").value = $("matchSelect").value;
    loadMatch();
  });
  cardThemes.forEach(t => {
    $(`show_${t}`).onchange = e => { e.target.checked ? state.selected.add(t) : state.selected.delete(t); refreshPreview(); renderLinks(); };
  });
  document.addEventListener("click", e => {
    const p=e.target.dataset.preview, push=e.target.dataset.push, un=e.target.dataset.unpush, scene=e.target.dataset.scene, hot=e.target.dataset.hot, copy=e.target.dataset.copy;
    const toggleCard = e.target.closest(".card-row")?.dataset.toggleCard;
    if (p) { state.selected = new Set([p]); syncChecks(); refreshPreview(); }
    if (push) { state.selected.add(push); syncChecks(); pushLive(); }
    if (un) { state.selected.delete(un); syncChecks(); pushLive(); }
    if (toggleCard && !e.target.closest("button") && e.target.type !== "checkbox") {
      state.selected.has(toggleCard) ? state.selected.delete(toggleCard) : state.selected.add(toggleCard);
      syncChecks();
      refreshPreview();
    }
    if (scene) applyScene(scene);
    if (hot) triggerHot(hot);
    if (copy) copyText($(copy).textContent);
    if (e.target.dataset.copyUrl) copyText(e.target.dataset.copyUrl);
  });
  window.addEventListener("message", e => {
    if (e.data?.type === "obs-positions") {
      state.positions = cleanPositions(e.data.positions || {});
      saveLocal(false);
    }
    if (e.data?.type === "obs-selected-card") {
      state.selectedCard = e.data.cardId || "";
      if (state.selectedCard) toast(`Selected: ${state.selectedCard}`);
    }
  });
  window.addEventListener("keydown", handleKeyboardNudge);
  window.addEventListener("resize", scalePreview);
  ["sponsor","eventName","accent","opacity","zIndex","animation","poll","debug","autoTriggers","autoScenes","hotDuration"].forEach(id => $(id).addEventListener("input", () => { refreshPreview(); renderLinks(); }));
}

function handleKeyboardNudge(e){
  if (!state.edit || !state.selectedCard || !/^Arrow/.test(e.key)) return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (["input", "select", "textarea", "button"].includes(tag)) return;
  e.preventDefault();
  const step = e.shiftKey ? 10 : 1;
  const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  $("preview").contentWindow?.postMessage({
    type:"obs-nudge-card",
    matchId:state.matchId,
    cardId:state.selectedCard,
    dx,
    dy,
    step,
    resize:e.ctrlKey || e.metaKey
  }, "*");
}

function applyLockedMatch(){
  const locked = localStorage.getItem(LOCKED_MATCH_KEY) || "";
  if (locked) $("matchId").value = locked;
  setMatchLockUi(!!locked);
}

function setMatchLockUi(locked){
  $("matchId").disabled = locked;
  $("matchSelect").disabled = locked;
  $("loadBtn").disabled = locked;
  $("lockMatchBtn").textContent = locked ? "Unlock ID" : "Lock ID";
  $("lockMatchBtn").classList.toggle("danger", locked);
  $("lockMatchBtn").classList.toggle("light", !locked);
}

function toggleMatchLock(){
  const locked = localStorage.getItem(LOCKED_MATCH_KEY);
  if (locked) {
    localStorage.removeItem(LOCKED_MATCH_KEY);
    setMatchLockUi(false);
    toast("Match ID unlocked.");
    return;
  }
  const id = $("matchId").value.trim();
  if (!id) return toast("Match ID is required.");
  localStorage.setItem(LOCKED_MATCH_KEY, id);
  state.matchId = id;
  setMatchLockUi(true);
  loadMatch();
  toast("Match ID locked.");
}

function openTab(id){
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===id));
  document.querySelectorAll(".tabpage").forEach(p=>p.classList.toggle("active",p.id===id));
}

function loadMatch(){
  state.matchId = $("matchId").value.trim() || "liveMatch1";
  setSelectedMatchOption(state.matchId);
  fetchLiveMatches(false);
  if (state.unsub) state.unsub();
  loadLocal();
  state.unsub = onValue(ref(db, `obsControl/${state.matchId}`), snap => {
    state.control = snap.val() || {};
    hydrate(state.control);
    refreshPreview();
  });
  renderLinks();
}

async function fetchLiveMatches(showToast = false){
  try {
    const snap = await get(query(ref(db, "liveMatches"), orderByChild("updatedAt"), limitToLast(30)));
    const rows = [];
    snap.forEach(child => rows.push({ matchId: child.key, ...(child.val() || {}) }));
    rows.sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    renderMatchOptions(rows);
    if (showToast) toast("Live match list refreshed.");
  } catch (error) {
    console.warn(error);
    if (showToast) toast("Unable to load live matches.");
  }
}

function renderMatchOptions(rows = []){
  const current = $("matchId").value.trim();
  const options = [`<option value="">Select live match</option>`].concat(rows.map(m => {
    const title = m.title || m.matchTitle || `${m.battingTeam?.name || m.battingTeam || "Match"}${m.bowlingTeam ? " vs " + (m.bowlingTeam?.name || m.bowlingTeam) : ""}`;
    const score = m.runs !== undefined ? ` · ${m.runs}/${m.wickets ?? m.wkts ?? 0}` : "";
    return `<option value="${escapeAttr(m.matchId)}">${escapeHtml(title)} (${escapeHtml(m.matchId)})${escapeHtml(score)}</option>`;
  }));
  $("matchSelect").innerHTML = options.join("");
  setSelectedMatchOption(current);
}

function setSelectedMatchOption(matchId){
  const select = $("matchSelect");
  if ([...select.options].some(o => o.value === matchId)) select.value = matchId;
  else select.value = "";
}

function hydrate(c){
  if (!c || !Object.keys(c).length) return;
  state.selected = new Set(Array.isArray(c.showThemes) ? c.showThemes : String(c.showThemes || "").split(",").filter(Boolean));
  if (!state.selected.size) state.selected = new Set(["scorebug","ticker","sponsor"]);
  state.positions = cleanPositions(c.positions || state.positions || {});
  ["sponsor","eventName","accent","opacity","zIndex","animation","poll","hotDuration"].forEach(id => { if (c[id] !== undefined) $(id).value = c[id]; });
  ["manualStatus","manualTicker","manualCommentary","manualSummary","manualLastWicket","manualNextBatter","manualMomentPlayer","manualMomentDetail","manualPowerplayRuns","manualPowerplayWickets","manualPowerplayOvers","manualWinProbability"].forEach(id => { if (c[id] !== undefined) $(id).value = c[id] || ""; });
  ["debug","autoTriggers","autoScenes"].forEach(id => { if (c[id] !== undefined) $(id).checked = !!c[id]; });
  syncChecks();
}

function syncChecks(){ cardThemes.forEach(t => { const el=$(`show_${t}`); if (el) el.checked = state.selected.has(t); }); renderLinks(); }
function applyScene(name){ state.selected = new Set(sceneMap[name] || []); syncChecks(); refreshPreview(); toast(`${name} scene selected.`); }

function clearAllCards(){
  state.selected = new Set();
  syncChecks();
  refreshPreview();
  toast("All cards cleared. Push Live to apply changes.");
}
function triggerHot(type, push=true){
  const detail = type === "FOUR" || type === "SIX" ? "Boundary!" : type === "WICKET" ? "Big breakthrough" : type;
  $("manualMomentDetail").value = $("manualMomentDetail").value || detail;
  const hotDuration = Number($("hotDuration").value || 2200);
  const hotNonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const patch = { hot:true, hotNonce, hotType:type, hotText:detail, hotDuration, updatedAt:serverTimestamp() };
  if (push) {
    update(ref(db, `obsControl/${state.matchId}`), patch)
      .then(() => {
        toast(`${type} pushed live.`);
        setTimeout(() => {
          update(ref(db, `obsControl/${state.matchId}`), { hot:false, updatedAt:serverTimestamp() }).catch(console.warn);
        }, hotDuration + 250);
      })
      .catch(e=>toast(e.message));
  }
}

function collect(){
  return {
    enabled:true,
    mode:"custom",
    showThemes:[...state.selected],
    sponsor:$("sponsor").value.trim(),
    eventName:$("eventName").value.trim(),
    accent:$("accent").value,
    opacity:Number($("opacity").value || 1),
    zIndex:Number($("zIndex").value || 10),
    animation:$("animation").value,
    poll:Number($("poll").value || 1000),
    debug:$("debug").checked,
    autoTriggers:$("autoTriggers").checked,
    autoScenes:$("autoScenes").checked,
    hot:false,
    positions:cleanPositions(state.positions || {}),
    hotDuration:Number($("hotDuration").value || 2200),
    manualStatus:$("manualStatus").value.trim(),
    manualTicker:$("manualTicker").value.trim(),
    manualCommentary:$("manualCommentary").value.trim(),
    manualSummary:$("manualSummary").value.trim(),
    manualLastWicket:$("manualLastWicket").value.trim(),
    manualNextBatter:$("manualNextBatter").value.trim(),
    manualMomentPlayer:$("manualMomentPlayer").value.trim(),
    manualMomentDetail:$("manualMomentDetail").value.trim(),
    manualPowerplayRuns:$("manualPowerplayRuns").value.trim(),
    manualPowerplayWickets:$("manualPowerplayWickets").value.trim(),
    manualPowerplayOvers:$("manualPowerplayOvers").value.trim(),
    manualWinProbability:$("manualWinProbability").value.trim(),
    updatedAt:serverTimestamp()
  };
}

function cleanPositions(positions = {}){
  const out = {};
  Object.entries(positions || {}).forEach(([id,p]) => {
    const w = Number(p?.w);
    const h = Number(p?.h);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 70 || h < 34) return;
    out[id] = {
      x:Math.max(0, Math.min(1260, Math.round(Number(p.x) || 0))),
      y:Math.max(0, Math.min(700, Math.round(Number(p.y) || 0))),
      w:Math.round(w),
      h:Math.round(h)
    };
  });
  return out;
}

async function pushLive(){
  const data = collect();
  await update(ref(db, `obsControl/${state.matchId}`), data);
  saveLocal(false);
  toast("OBS controls pushed live.");
}

function refreshPreview(){
  $("preview").src = mainUrl(true);
  scalePreview();
}
function scalePreview(){
  const shell = document.querySelector(".preview-frame");
  const widthScale = Math.max(.18, (shell.clientWidth - 24) / 1280);
  const scale = Math.min(widthScale, .72);
  $("previewStage").style.transform = `scale(${scale})`;
  $("previewStage").style.width = "1280px";
  $("previewStage").style.height = `${720 * scale}px`;
}
function mainUrl(preview){
  if (!preview) {
    const qs = new URLSearchParams();
    qs.set("match", state.matchId);
    return new URL(`obs.html?${qs.toString()}`, location.href).href;
  }
  const qs = new URLSearchParams();
  qs.set("match", state.matchId);
  qs.set("layout", "custom");
  qs.set("show", [...state.selected].join(","));
  qs.set("sponsor", $("sponsor").value.trim());
  qs.set("event", $("eventName").value.trim());
  qs.set("accent", $("accent").value);
  qs.set("opacity", $("opacity").value);
  qs.set("z", $("zIndex").value);
  qs.set("anim", $("animation").value);
  if ($("debug").checked) qs.set("debug","1");
  if (preview) {
    qs.set("preview","1");
    const clean = cleanPositions(state.positions || {});
    if (Object.keys(clean).length) qs.set("positions", JSON.stringify(clean));
    if (state.edit) qs.set("edit","1");
    qs.set("_", Date.now().toString());
  }
  return new URL(`obs.html?${qs.toString()}`, location.href).href;
}
function renderLinks(){
  $("mainUrl").textContent = mainUrl(false);
  $("sourceUrls").innerHTML = cardThemes.slice(0,18).map(t => {
    const url = new URL(`obs.html?match=${encodeURIComponent(state.matchId)}&layout=custom&show=${encodeURIComponent(t)}&sponsor=${encodeURIComponent($("sponsor").value)}&event=${encodeURIComponent($("eventName").value)}&accent=${encodeURIComponent($("accent").value)}`, location.href).href;
    return `<div class="copybox"><b>${t}</b><br>${url}</div><button class="small" data-copy-url="${url}">Copy ${t}</button>`;
  }).join("");
}

function localKey(){ return `obs_admin_${state.matchId}`; }
function saveLocal(show=true){ localStorage.setItem(localKey(), JSON.stringify({ selected:[...state.selected], positions:cleanPositions(state.positions), values:collectForLocal() })); if(show) toast("Settings saved locally."); }
function collectForLocal(){
  const ids=["sponsor","eventName","accent","opacity","zIndex","animation","poll","debug","autoTriggers","autoScenes","hotDuration","manualStatus","manualTicker","manualCommentary","manualSummary","manualLastWicket","manualNextBatter","manualMomentPlayer","manualMomentDetail","manualPowerplayRuns","manualPowerplayWickets","manualPowerplayOvers","manualWinProbability"];
  const out={}; ids.forEach(id=>out[id]=$(id).type==="checkbox"?$(id).checked:$(id).value); return out;
}
function loadLocal(){
  try {
    const saved = JSON.parse(localStorage.getItem(localKey()) || "{}");
    if (saved.selected) state.selected = new Set(saved.selected);
    if (saved.positions) state.positions = saved.positions;
    Object.entries(saved.values || {}).forEach(([id,v]) => { if ($(id)) $(id).type==="checkbox" ? $(id).checked=!!v : $(id).value=v; });
    syncChecks();
  } catch {}
}
function copyText(text){ navigator.clipboard?.writeText(text).then(()=>toast("Copied to clipboard.")); }
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>t.classList.remove("show"),2200); }
function escapeHtml(v){ return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function escapeAttr(v){ return escapeHtml(v).replace(/`/g,""); }

bindAuth();
