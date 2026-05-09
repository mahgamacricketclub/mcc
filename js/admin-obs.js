const CARDS = [
  { id: "scorebug", title: "Bottom Scorebug", desc: "main live score" },
  { id: "lower", title: "Lower Third", desc: "title + score" },
  { id: "batters", title: "Batters", desc: "striker + non-striker" },
  { id: "bowler", title: "Bowler", desc: "current bowler" },
  { id: "partner", title: "Partnership", desc: "runs + balls" },
  { id: "target", title: "Target", desc: "need / RRR" },
  { id: "lastover", title: "Last Over", desc: "ball circles" },
  { id: "teams", title: "Team Score", desc: "both innings" },
  { id: "innings", title: "Innings Banner", desc: "full screen banner" },
  { id: "scoreboard", title: "Full Scoreboard", desc: "batting + bowling" },
  { id: "summary", title: "Match Summary", desc: "result / top stats" },
  { id: "ticker", title: "Ticker", desc: "bottom news strip" }
];

const $ = id => document.getElementById(id);
const storeKey = "mcc_obs_admin_settings_v2";
let selectedCard = "scorebug";

function loadSettings(){
  try { return JSON.parse(localStorage.getItem(storeKey) || "{}"); } catch { return {}; }
}
function saveSettings(){
  const data = {
    matchId: $("matchIdInput").value.trim(),
    theme: $("themeSelect").value,
    mode: $("modeSelect").value,
    safe: $("safeArea").checked,
    debug: $("debugBadge").checked,
    card: selectedCard
  };
  localStorage.setItem(storeKey, JSON.stringify(data));
}
function buildUrl(absolute=false){
  const matchId = $("matchIdInput").value.trim();
  const p = new URLSearchParams();
  if (matchId) p.set("match", matchId);
  p.set("card", selectedCard);
  p.set("theme", $("themeSelect").value);
  if ($("modeSelect").value === "demo") p.set("demo", "1");
  if ($("safeArea").checked) p.set("safe", "1");
  if ($("debugBadge").checked) p.set("debug", "1");
  const rel = `obs.html?${p.toString()}`;
  return absolute ? new URL(rel, location.href).href : rel;
}
function renderCards(){
  const grid = $("cardGrid");
  grid.innerHTML = CARDS.map(c => `
    <button type="button" class="card-btn ${c.id === selectedCard ? "active" : ""}" data-card="${c.id}">
      <b>${c.title}</b><small>${c.desc}</small>
    </button>
  `).join("");
  grid.querySelectorAll(".card-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedCard = btn.dataset.card;
      renderCards();
      updatePreview();
    });
  });
}
function updatePreview(){
  saveSettings();
  const url = buildUrl(false);
  $("obsUrl").value = buildUrl(true);
  $("previewFrame").src = `${url}&_=${Date.now()}`;
  const card = CARDS.find(c => c.id === selectedCard);
  $("statusPill").textContent = card ? card.title.toUpperCase() : "READY";
}
function init(){
  const settings = loadSettings();
  $("matchIdInput").value = settings.matchId || "";
  $("themeSelect").value = settings.theme || "gold";
  $("modeSelect").value = settings.mode || "demo";
  $("safeArea").checked = !!settings.safe;
  $("debugBadge").checked = !!settings.debug;
  selectedCard = settings.card || "scorebug";
  renderCards();
  ["matchIdInput","themeSelect","modeSelect","safeArea","debugBadge"].forEach(id => $(id).addEventListener("input", updatePreview));
  $("refreshBtn").addEventListener("click", updatePreview);
  $("openBtn").addEventListener("click", () => window.open(buildUrl(true), "_blank"));
  $("copyBtn").addEventListener("click", async () => {
    const url = buildUrl(true);
    $("obsUrl").value = url;
    try {
      await navigator.clipboard.writeText(url);
      $("copyBtn").textContent = "Copied!";
      setTimeout(() => $("copyBtn").textContent = "Copy URL", 1200);
    } catch {
      $("obsUrl").select();
      document.execCommand("copy");
    }
  });
  updatePreview();
}
init();
