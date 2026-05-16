import { firebaseConfig } from "../firebase/firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";


const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getDatabase(app);
const params = new URLSearchParams(location.search);
const stage = document.getElementById("stage");
const debugBox = document.getElementById("debug");
const cardEls = [...document.querySelectorAll("[data-theme]")];
const defaultThemes = ["scorebug","ticker","sponsor"];
const defaultPositions = {};
const aliases = { bowling:"bowling", winprob:"winprob", powerplay:"powerplay", playingxi:"playingxi", lower:"lower", rate:"rate" };
const state = {
  matchId: params.get("match") || "liveMatch1",
  live: null,
  control: null,
  positions: {},
  hotShowing: false,
  lastAutoKey: "",
  lastRenderThemes: []
};

cardEls.forEach(el => {
  const cs = getComputedStyle(el);
  const w = parseFloat(cs.width) || el.offsetWidth || 200;
  const h = parseFloat(cs.height) || el.offsetHeight || 80;
  const left = parseFloat(cs.left);
  const top = parseFloat(cs.top);
  const right = parseFloat(cs.right);
  const bottom = parseFloat(cs.bottom);
  if (el.id) defaultPositions[el.id] = {
    x: Number.isFinite(left) ? left : (Number.isFinite(right) ? 1280 - right - w : 0),
    y: Number.isFinite(top) ? top : (Number.isFinite(bottom) ? 720 - bottom - h : 0),
    w,
    h
  };
});

function n(v, fallback = 0){ const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function text(v, fallback = "-"){ return String(v ?? fallback); }
function short(name){ return text(name,"-").split(/\s+/).map(x=>x[0]).join("").slice(0,3).toUpperCase(); }
function ballsFromOvers(overs){ if (typeof overs === "number") return overs; const [o,b="0"] = text(overs,"0.0").split("."); return n(o)*6+n(b); }
function overText(balls){ const b=n(balls); return `${Math.floor(b/6)}.${b%6}`; }
function csv(v){ return text(v,"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>aliases[x]||x); }
function parseJsonParam(name){ try { return params.get(name) ? JSON.parse(decodeURIComponent(params.get(name))) : null; } catch { return null; } }
function logoHtml(url, label){ return url ? `<img src="${escapeAttr(url)}">` : short(label); }
function escapeHtml(v){ return text(v,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function escapeAttr(v){ return escapeHtml(v).replace(/`/g,""); }

function normalizeLive(raw = {}){
  const m = raw || {};
  const batTeam = typeof m.battingTeam === "object" ? m.battingTeam : { name:m.battingTeam };
  const bowlTeam = typeof m.bowlingTeam === "object" ? m.bowlingTeam : { name:m.bowlingTeam };
  const bat1 = m.striker ? {} : (m.striker === 2 ? m.bat2 : m.bat1) || {};
  const bowler = typeof m.bowler === "object" ? m.bowler : { name:m.bowler };
  const balls = m.balls ?? ballsFromOvers(m.overs);
  const overs = m.overs || overText(balls);
  const runs = n(m.runs);
  const wickets = n(m.wickets ?? m.wkts);
  const target = m.target ?? "";
  const need = m.need ?? (target ? Math.max(n(target)-runs,0) : "");
  const crr = m.crr ?? (balls ? (runs/(balls/6)).toFixed(2) : "0.00");
  const remBalls = Math.max(n(m.totalOvers,20)*6 - balls, 0);
  const rrr = m.rrr ?? (need !== "" ? (remBalls ? ((n(need)*6)/remBalls).toFixed(2) : "0.00") : "-");
  return {
    ...m,
    title:m.title || m.matchTitle || `${batTeam?.name || "Team A"} vs ${bowlTeam?.name || "Team B"}`,
    status:m.status || (m.matchFinished ? "RESULT" : "LIVE"),
    battingTeam:batTeam?.name || "Batting Team",
    bowlingTeam:bowlTeam?.name || "Bowling Team",
    battingTeamShort:m.battingTeamShort || batTeam?.shortName || short(batTeam?.name),
    bowlingTeamShort:m.bowlingTeamShort || bowlTeam?.shortName || short(bowlTeam?.name),
    battingLogo:m.battingLogo || batTeam?.logo || "",
    bowlingLogo:m.bowlingLogo || bowlTeam?.logo || "",
    runs,wickets,overs,balls,target,need,crr,rrr,
    striker:m.striker || bat1?.name || "-",
    nonStriker:m.nonStriker || (m.striker === 2 ? m.bat1?.name : m.bat2?.name) || "-",
    bowler:bowler?.name || "-",
    strikerRuns:m.strikerRuns ?? bat1?.r ?? 0,
    strikerBalls:m.strikerBalls ?? bat1?.b ?? 0,
    strikerSR:m.strikerSR || (n(bat1?.b) ? ((n(bat1?.r)/n(bat1?.b))*100).toFixed(2) : "0.00"),
    bowlerOvers:m.bowlerOvers || overText(bowler?.balls || 0),
    bowlerRuns:m.bowlerRuns ?? bowler?.runs ?? bowler?.r ?? 0,
    bowlerWickets:m.bowlerWickets ?? bowler?.wkts ?? bowler?.w ?? 0,
    bowlerEconomy:m.bowlerEconomy || (n(bowler?.balls) ? (n(bowler?.runs ?? bowler?.r)/(n(bowler?.balls)/6)).toFixed(2) : "0.00"),
    thisOver:Array.isArray(m.thisOver) ? m.thisOver : (Array.isArray(m.over) ? m.over : []),
    lastCommentary:m.lastCommentary || m.commentary?.[0]?.text || "Waiting for live commentary",
    lastWicket:m.lastWicket || "-",
    fallOfWickets:Array.isArray(m.fallOfWickets) ? m.fallOfWickets : [],
    partnership:m.partnership || `${m.partnershipRuns || 0} (${m.partnershipBalls || 0})`,
    players:Array.isArray(m.players) ? m.players : Object.values(m.teams || {}).flat().slice(0,11),
    venue:m.venue || "-",
    result:m.result || m.winnerText || "Match in progress"
  };
}

function blankLive(){
  return normalizeLive({
    title:"Waiting for live data",
    status:"WAITING",
    battingTeam:{ name:"-" },
    bowlingTeam:{ name:"-" },
    battingTeamShort:"-",
    bowlingTeamShort:"-",
    runs:0,
    wickets:0,
    overs:"0.0",
    crr:"0.00",
    rrr:"-",
    striker:"-",
    nonStriker:"-",
    bowler:"-",
    strikerRuns:0,
    strikerBalls:0,
    strikerSR:"0.00",
    bowlerOvers:"0.0",
    bowlerRuns:0,
    bowlerWickets:0,
    bowlerEconomy:"0.00",
    thisOver:[],
    lastCommentary:"Waiting for live data",
    lastWicket:"-",
    fallOfWickets:[],
    partnership:"0 (0)",
    venue:"-",
    result:"Waiting for live data",
    players:[],
    inningsDetails:{}
  });
}

function control(){
  const c = state.control || {};
  const urlThemes = csv(params.get("show") || params.get("theme"));
  const firebaseThemes = Array.isArray(c.showThemes) ? c.showThemes : csv(c.showThemes || "");
  const themes = params.get("layout") === "custom" || urlThemes.length ? urlThemes : (firebaseThemes.length ? firebaseThemes : defaultThemes);
  return {
    enabled:c.enabled !== false,
    themes,
    sponsor:params.get("sponsor") || c.sponsor || "TECH SOURCE",
    event:params.get("event") || c.eventName || "Live Cricket",
    accent:params.get("accent") || c.accent || "#16f2b3",
    opacity:n(params.get("opacity") ?? c.opacity, 1),
    zIndex:n(params.get("z") ?? c.zIndex, 10),
    animation:params.get("anim") || c.animation || "slide",
    poll:n(params.get("poll") ?? c.poll, 1000),
    debug:params.has("debug") || !!c.debug,
    edit:params.has("edit") || !!c.edit,
    preview:params.has("preview"),
    positions:{...defaultPositions,...(parseJsonParam("positions") || {}),...(c.positions || {})},
    hot:c.hot,
    hotType:c.hotType,
    hotText:c.hotText,
    hotDuration:n(c.hotDuration, 2200),
    manualStatus:c.manualStatus || "",
    manualTicker:c.manualTicker || "",
    manualCommentary:c.manualCommentary || "",
    manualSummary:c.manualSummary || "",
    manualLastWicket:c.manualLastWicket || "",
    manualNextBatter:c.manualNextBatter || "",
    manualMomentPlayer:c.manualMomentPlayer || "",
    manualMomentDetail:c.manualMomentDetail || "",
    manualPowerplayRuns:c.manualPowerplayRuns || "",
    manualPowerplayWickets:c.manualPowerplayWickets || "",
    manualPowerplayOvers:c.manualPowerplayOvers || "",
    manualWinProbability:c.manualWinProbability || "",
    autoTriggers:c.autoTriggers !== false
  };
}

function viewModel(){
  const m = state.live ? normalizeLive(state.live) : blankLive();
  const c = control();
  const score = `${m.runs}/${m.wickets}`;
  const hotText = c.hotText || `${m.battingTeamShort} ${score}`;
  return {
    ...m,
    sponsor:c.sponsor,
    event:c.event,
    score,
    oversLine:`${m.overs} ov`,
    status:c.manualStatus || m.status || "LIVE",
    statusLine:c.manualStatus || `${m.battingTeamShort} ${score} (${m.overs})`,
    chaseLine:m.target ? `Target ${m.target} · Need ${m.need}` : `CRR ${m.crr}`,
    commentary:c.manualCommentary || m.lastCommentary,
    ticker:c.manualTicker || `${m.title} · ${m.battingTeamShort} ${score} (${m.overs}) · ${m.striker} ${m.strikerRuns}(${m.strikerBalls}) · ${m.bowler} ${m.bowlerWickets}/${m.bowlerRuns}`,
    bowlerLine:`${m.bowlerOvers}-${m.bowlerRuns}-${m.bowlerWickets} · ER ${m.bowlerEconomy}`,
    strikerLine:`${m.strikerRuns} (${m.strikerBalls}) · SR ${m.strikerSR}`,
    strikerInitials:short(m.striker),
    bowlerInitials:short(m.bowler),
    summary:c.manualSummary || m.result || `${m.battingTeamShort} ${score} (${m.overs})`,
    lastWicket:c.manualLastWicket || m.lastWicket,
    fow:m.fallOfWickets.slice(-4).join(" · ") || "-",
    nextBatter:c.manualNextBatter || "Awaiting update",
    momentPlayer:c.manualMomentPlayer || m.striker,
    momentDetail:c.manualMomentDetail || `${m.strikerRuns} from ${m.strikerBalls}`,
    powerplay:`${c.manualPowerplayRuns || "-"} / ${c.manualPowerplayWickets || "-"} (${c.manualPowerplayOvers || "-"})`,
    winProbability:c.manualWinProbability || autoWinProbability(m),
    toss:m.tossWinner ? `${m.tossWinner} chose ${m.tossDecision || "-"}` : "Toss update pending",
    result:m.winner ? `${m.winner} won ${m.winMargin || ""}` : m.result,
    hotType:c.hotType || "LIVE",
    hotText,
    venue:m.venue || "-",
    pointsTable:m.pointsTable || m.league?.pointsTable || {}
  };
}

function autoWinProbability(m){
  if (!m.target) return "50% / 50%";
  const needRate = n(m.rrr,0), currentRate = n(m.crr,0);
  const batting = Math.max(12, Math.min(88, 50 + Math.round((currentRate - needRate) * 5)));
  return `${m.battingTeamShort} ${batting}%`;
}

function render(){
  const c = control();
  const vm = viewModel();
  document.documentElement.style.setProperty("--accent", c.accent);
  document.documentElement.style.setProperty("--opacity", String(Math.max(0, Math.min(1, c.opacity))));
  document.documentElement.style.setProperty("--z", String(c.zIndex));
  debugBox.classList.toggle("show", c.debug);
  debugBox.textContent = `match=${state.matchId}\nshow=${c.themes.join(",")}\nupdated=${new Date().toLocaleTimeString()}\n${JSON.stringify({live:!!state.live,control:!!state.control},null,2)}`;
  if (!c.enabled) {
    cardEls.forEach(el => el.classList.remove("show"));
    return;
  }
  applyScale();
  applyPositions(c.positions);
  cardEls.forEach(el => {
    const theme = el.dataset.theme;
    if (theme === "hot") return;
    const show = c.themes.includes(theme);
    el.classList.toggle("show", show);
    el.classList.toggle("edit-outline", show && c.edit);
    el.classList.toggle("selected", show && c.edit && el.id === state.selectedEditId);
    if (show && !state.lastRenderThemes.includes(theme)) {
      el.classList.remove("slide-in","fade-in","zoom-in");
      void el.offsetWidth;
      el.classList.add(c.animation === "fade" ? "fade-in" : c.animation === "zoom" ? "zoom-in" : "slide-in");
    }
  });
  state.lastRenderThemes = [...c.themes];
  document.querySelectorAll("[data-text]").forEach(el => {
    const key = el.dataset.text;
    if (key in vm) el.textContent = vm[key];
  });
  document.querySelectorAll("[data-logo]").forEach(el => {
    const key = el.dataset.logo;
    el.innerHTML = key === "batting" ? logoHtml(vm.battingLogo, vm.battingTeamShort) : logoHtml(vm.bowlingLogo, vm.bowlingTeamShort);
  });
  document.querySelectorAll("[data-list='players']").forEach(el => {
    el.innerHTML = (vm.players || []).slice(0,11).map((p,i)=>`<div>${i+1}. ${escapeHtml(p)}</div>`).join("");
  });
  document.querySelectorAll("[data-balls='thisOver']").forEach(el => el.innerHTML = ballsHtml(vm.thisOver));
  document.querySelectorAll("[data-timeline='thisOver']").forEach(el => el.innerHTML = (vm.thisOver || []).slice(-8).map(x=>`<div class="timeline-item ${/4|6|w/i.test(String(x)) ? "hot" : ""}"></div>`).join(""));
  document.querySelectorAll("[data-matchboard]").forEach(el => el.innerHTML = matchboardHtml(vm));
  document.querySelectorAll("[data-scorestrip]").forEach(el => el.innerHTML = scorestripHtml(vm));
  document.querySelectorAll("[data-inningsboard]").forEach(el => el.innerHTML = inningsBoardHtml(vm));
  document.querySelectorAll("[data-chaseboard]").forEach(el => el.innerHTML = chaseBoardHtml(vm));
  document.querySelectorAll("[data-resultboard]").forEach(el => el.innerHTML = resultBoardHtml(vm));
  document.querySelectorAll("[data-tournamenttable]").forEach(el => el.innerHTML = tournamentTableHtml(vm));
  document.querySelectorAll("[data-playerstatsboard]").forEach(el => el.innerHTML = playerStatsBoardHtml(vm));
  document.querySelectorAll("[data-battingcard]").forEach(el => el.innerHTML = battingCardHtml(vm));
  document.querySelectorAll("[data-bowlingcard]").forEach(el => el.innerHTML = bowlingCardHtml(vm));
  document.querySelectorAll("[data-partnershipboard]").forEach(el => el.innerHTML = partnershipBoardHtml(vm));
  document.querySelectorAll("[data-fallwicketsboard]").forEach(el => el.innerHTML = fallWicketsBoardHtml(vm));
  document.querySelectorAll("[data-overbyoverboard]").forEach(el => el.innerHTML = overByOverBoardHtml(vm));
  document.querySelectorAll("[data-squadboard]").forEach(el => el.innerHTML = squadBoardHtml(vm));
  document.querySelectorAll("[data-tossboard]").forEach(el => el.innerHTML = tossBoardHtml(vm));
  document.querySelectorAll("[data-nextmatchboard]").forEach(el => el.innerHTML = nextMatchBoardHtml(vm));
  handleManualHot(c, vm);
  handleAutoHot(c, vm);
  setupEdit(c.edit);
}

function matchboardHtml(vm){
  const teams = [vm.battingTeam, vm.bowlingTeam];
  const details = vm.inningsDetails || {};
  const first = details[teams[0]] || Object.values(details)[0] || currentDetail(vm);
  const second = details[teams[1]] || Object.values(details)[1] || { team:vm.bowlingTeam, runs:0, wkts:0, overs:"0.0", battingScorecard:[], bowlerStats:{} };
  return `
    <div class="mb-title">Match Summary</div>
    ${summarySection(first, vm.battingTeamShort, "blue")}
    ${summarySection(second, vm.bowlingTeamShort, "green")}
    <div class="mb-result">${escapeHtml(vm.result || vm.summary || "Match in progress")}</div>
  `;
}

function currentDetail(vm){
  return {
    team:vm.battingTeam,
    runs:vm.runs,
    wkts:vm.wickets,
    overs:vm.overs,
    battingScorecard:[
      {name:vm.striker,r:vm.strikerRuns,b:vm.strikerBalls},
      {name:vm.nonStriker,r:0,b:0}
    ],
    bowlerStats:{[vm.bowler]:{wkts:vm.bowlerWickets,runs:vm.bowlerRuns,balls:ballsFromOvers(vm.bowlerOvers)}}
  };
}

function summarySection(detail = {}, shortName = "", color = "blue"){
  const bat = (detail.battingScorecard || []).slice(0,4);
  const bowl = Object.entries(detail.bowlerStats || {}).slice(0,4);
  while (bat.length < 4) bat.push({name:"-",r:"-",b:"-"});
  while (bowl.length < 4) bowl.push(["-",{wkts:"-",runs:"-",balls:0}]);
  return `
    <div class="mb-section">
      <div class="mb-head ${color}">
        <div class="mb-team"><span class="mb-logo">${escapeHtml(shortName || short(detail.team))}</span>${escapeHtml(detail.team || "Team")}</div>
        <div class="mb-score">${escapeHtml(detail.overs || overText(detail.balls || 0))} Overs&nbsp;&nbsp;|&nbsp;&nbsp;<b>${n(detail.runs) || 0}-${n(detail.wkts) || 0}</b></div>
      </div>
      <div class="mb-grid">
        <div class="mb-col">${bat.map(r => `<div class="mb-row"><span>${escapeHtml(r.name)}</span><b>${escapeHtml(r.r ?? r.runs ?? "-")}</b><b>${escapeHtml(r.b ?? r.balls ?? "-")}</b></div>`).join("")}</div>
        <div class="mb-col bowl">${bowl.map(([name,s]) => `<div class="mb-row"><span>${escapeHtml(name)}</span><b>${escapeHtml((s.wkts ?? s.w ?? 0) + "-" + (s.runs ?? s.r ?? 0))}</b><b>${escapeHtml(overText(s.balls || 0))}</b></div>`).join("")}</div>
      </div>
    </div>
  `;
}

function scorestripHtml(vm){
  const overBalls = (vm.thisOver || []).slice(-6);
  return `
    <div class="ss-logo">${escapeHtml(vm.battingTeamShort)}</div>
    <div class="ss-score">${escapeHtml(vm.battingTeamShort)} ${escapeHtml(vm.score)}<small>v ${escapeHtml(vm.bowlingTeamShort)} &nbsp; ${escapeHtml(vm.overs)} ov</small></div>
    <div class="ss-batters"><span>${escapeHtml(vm.striker)}</span><b>${escapeHtml(vm.strikerRuns)}</b><b>${escapeHtml(vm.strikerBalls)}</b><span>${escapeHtml(vm.nonStriker)}</span><b>-</b><b>-</b></div>
    <div class="ss-rate"><small>Run-rate</small>${escapeHtml(vm.crr)}</div>
    <div class="ss-over">${ballsHtml(overBalls)}</div>
  `;
}

function inningsBoardHtml(vm){
  const detail = (vm.inningsDetails && (vm.inningsDetails[vm.battingTeam] || Object.values(vm.inningsDetails)[0])) || currentDetail(vm);
  const bat = (detail.battingScorecard || []).slice(0,7);
  const bowl = Object.entries(detail.bowlerStats || {}).slice(0,7);
  while (bat.length < 7) bat.push({name:"-",r:"-",b:"-"});
  while (bowl.length < 7) bowl.push(["-",{wkts:"-",runs:"-",balls:0}]);
  return `
    <div class="full-board">
      <div class="fb-top"><h2>Innings Card</h2><span>${escapeHtml(vm.event)}</span></div>
      <div class="fb-body">
        <div class="fb-panel">
          <div class="fb-head"><b>${escapeHtml(detail.team || vm.battingTeam)}</b><strong>${n(detail.runs)||0}-${n(detail.wkts)||0}</strong></div>
          <div class="fb-list">${bat.map(r => `<div class="fb-row"><span>${escapeHtml(r.name)}</span><b>${escapeHtml(r.r ?? r.runs ?? "-")}</b><small>${escapeHtml(r.b ?? r.balls ?? "-")}b</small></div>`).join("")}</div>
        </div>
        <div class="fb-panel green">
          <div class="fb-head"><b>Bowling</b><strong>${escapeHtml(detail.overs || overText(detail.balls || 0))}</strong></div>
          <div class="fb-list">${bowl.map(([name,s]) => `<div class="fb-row"><span>${escapeHtml(name)}</span><b>${escapeHtml((s.wkts ?? s.w ?? 0) + "-" + (s.runs ?? s.r ?? 0))}</b><small>${escapeHtml(overText(s.balls || 0))}</small></div>`).join("")}</div>
        </div>
      </div>
      <div class="fb-foot">${escapeHtml(vm.statusLine)}</div>
    </div>
  `;
}

function chaseBoardHtml(vm){
  return `
    <div class="full-board">
      <div class="fb-top"><h2>Chase Tracker</h2><span>${escapeHtml(vm.title)}</span></div>
      <div class="fb-body">
        <div class="fb-panel orange">
          <div class="fb-head"><b>${escapeHtml(vm.battingTeamShort)}</b><strong>${escapeHtml(vm.score)}</strong></div>
          <div class="result-hero">
            <h2>${escapeHtml(vm.battingTeam)}</h2>
            <p>${escapeHtml(vm.chaseLine)}</p>
            <div class="scoreline-big">${escapeHtml(vm.oversLine)}</div>
          </div>
        </div>
        <div class="fb-panel">
          <div class="fb-head"><b>Required</b><strong>${escapeHtml(vm.rrr)}</strong></div>
          <div class="chase-metrics">
            <div><span>Target</span><b>${escapeHtml(vm.target || "-")}</b></div>
            <div><span>Need</span><b>${escapeHtml(vm.need || "-")}</b></div>
            <div><span>CRR</span><b>${escapeHtml(vm.crr)}</b></div>
          </div>
          <div class="fb-list">
            <div class="fb-row"><span>${escapeHtml(vm.striker)}</span><b>${escapeHtml(vm.strikerRuns)}</b><small>${escapeHtml(vm.strikerBalls)}b</small></div>
            <div class="fb-row"><span>${escapeHtml(vm.nonStriker)}</span><b>-</b><small>-</small></div>
            <div class="fb-row"><span>${escapeHtml(vm.bowler)}</span><b>${escapeHtml(vm.bowlerWickets)}-${escapeHtml(vm.bowlerRuns)}</b><small>${escapeHtml(vm.bowlerOvers)}</small></div>
          </div>
        </div>
      </div>
      <div class="fb-foot">${escapeHtml(vm.winProbability)}</div>
    </div>
  `;
}

function resultBoardHtml(vm){
  return `
    <div class="full-board">
      <div class="fb-top"><h2>Result</h2><span>${escapeHtml(vm.event)}</span></div>
      <div class="result-hero">
        <h2>${escapeHtml(vm.result || "Result pending")}</h2>
        <p>${escapeHtml(vm.summary)}</p>
        <div class="scoreline-big">${escapeHtml(vm.battingTeamShort)} ${escapeHtml(vm.score)} (${escapeHtml(vm.overs)})</div>
      </div>
      <div class="fb-foot">${escapeHtml(vm.title)}</div>
    </div>
  `;
}

function activeDetail(vm){
  return (vm.inningsDetails && (vm.inningsDetails[vm.battingTeam] || Object.values(vm.inningsDetails)[0])) || currentDetail(vm);
}

function boardWrap(title, sub, body, foot = ""){
  return `<div class="tv-board"><div class="tv-title"><b>${escapeHtml(title)}</b><span>${escapeHtml(sub || "")}</span></div>${body}<div class="tv-foot">${escapeHtml(foot || sub || "")}</div></div>`;
}

function tournamentTableHtml(vm){
  const rows = Object.entries(vm.pointsTable || {}).slice(0,8);
  const bodyRows = rows.length ? rows.map(([team,p]) => `<div class="tv-row"><span>${escapeHtml(team)}</span><b>${p.P||0}</b><b>${p.W||0}</b><b>${p.L||0}</b><b>${p.Pts||0}</b><b>${nrr(p)}</b></div>`).join("") : `<div class="tv-row"><span>No points table</span><b>-</b><b>-</b><b>-</b><b>-</b><b>-</b></div>`;
  return boardWrap("Points Table", vm.event, `<div class="tv-table"><div class="tv-row head"><span>Team</span><b>P</b><b>W</b><b>L</b><b>Pts</b><b>NRR</b></div>${bodyRows}</div>`, vm.title);
}

function playerStatsBoardHtml(vm){
  const detail = activeDetail(vm);
  const bat = [...(detail.battingScorecard || [])].sort((a,b)=>n(b.r ?? b.runs)-n(a.r ?? a.runs)).slice(0,6);
  const bowl = Object.entries(detail.bowlerStats || {}).sort((a,b)=>n(b[1].wkts ?? b[1].w)-n(a[1].wkts ?? a[1].w) || n(a[1].runs ?? a[1].r)-n(b[1].runs ?? b[1].r)).slice(0,6);
  return boardWrap("Player Stats", vm.title, `<div class="two-col-board"><div class="tv-panel blue"><div class="tv-row head three"><span>Batters</span><b>R</b><b>B</b><b>SR</b></div>${padRows(bat,6).map(r=>`<div class="tv-row three"><span>${escapeHtml(r.name||"-")}</span><b>${escapeHtml(r.r ?? r.runs ?? "-")}</b><b>${escapeHtml(r.b ?? r.balls ?? "-")}</b><b>${calcSR(r.r ?? r.runs, r.b ?? r.balls)}</b></div>`).join("")}</div><div class="tv-panel"><div class="tv-row head three"><span>Bowlers</span><b>W</b><b>R</b><b>O</b></div>${padBowls(bowl,6).map(([name,s])=>`<div class="tv-row three"><span>${escapeHtml(name)}</span><b>${escapeHtml(s.wkts ?? s.w ?? "-")}</b><b>${escapeHtml(s.runs ?? s.r ?? "-")}</b><b>${escapeHtml(overText(s.balls||0))}</b></div>`).join("")}</div></div>`, vm.statusLine);
}

function battingCardHtml(vm){
  const detail = activeDetail(vm);
  const rows = padRows(detail.battingScorecard || [], 9);
  return boardWrap("Batting Card", `${detail.team || vm.battingTeam} ${n(detail.runs)||0}-${n(detail.wkts)||0}`, `<div class="tv-table"><div class="tv-row head four"><span>Batter</span><b>R</b><b>B</b><b>4s</b><b>6s</b></div>${rows.map(r=>`<div class="tv-row four"><span>${escapeHtml(r.name||"-")}</span><b>${escapeHtml(r.r ?? r.runs ?? "-")}</b><b>${escapeHtml(r.b ?? r.balls ?? "-")}</b><b>${escapeHtml(r.f ?? r.fours ?? "-")}</b><b>${escapeHtml(r.s ?? r.sixes ?? "-")}</b></div>`).join("")}</div>`, vm.oversLine);
}

function bowlingCardHtml(vm){
  const detail = activeDetail(vm);
  const rows = padBowls(Object.entries(detail.bowlerStats || {}), 9);
  return boardWrap("Bowling Card", vm.bowlingTeam, `<div class="tv-table"><div class="tv-row head four"><span>Bowler</span><b>O</b><b>R</b><b>W</b><b>ER</b></div>${rows.map(([name,s])=>`<div class="tv-row four"><span>${escapeHtml(name)}</span><b>${escapeHtml(overText(s.balls||0))}</b><b>${escapeHtml(s.runs ?? s.r ?? "-")}</b><b>${escapeHtml(s.wkts ?? s.w ?? "-")}</b><b>${calcER(s.runs ?? s.r, s.balls)}</b></div>`).join("")}</div>`, vm.score);
}

function partnershipBoardHtml(vm){
  return boardWrap("Partnership", vm.battingTeam, `<div class="two-col-board"><div class="tv-panel blue"><div class="result-hero"><h2>${escapeHtml(vm.partnership)}</h2><p>Current Stand</p><div class="scoreline-big">${escapeHtml(vm.score)}</div></div></div><div class="tv-panel"><div class="fb-list"><div class="fb-row"><span>${escapeHtml(vm.striker)}</span><b>${escapeHtml(vm.strikerRuns)}</b><small>${escapeHtml(vm.strikerBalls)}b</small></div><div class="fb-row"><span>${escapeHtml(vm.nonStriker)}</span><b>-</b><small>-</small></div><div class="fb-row"><span>Run Rate</span><b>${escapeHtml(vm.crr)}</b><small>CRR</small></div></div></div></div>`, vm.statusLine);
}

function fallWicketsBoardHtml(vm){
  const rows = (vm.fallOfWickets || []).slice(-8);
  const body = rows.length ? rows.map((x,i)=>`<div class="timeline-line"><b>${i+1}</b><span>${escapeHtml(x)}</span></div>`).join("") : `<div class="timeline-line"><b>-</b><span>No wickets</span></div>`;
  return boardWrap("Fall of Wickets", vm.battingTeam, `<div class="tv-table"><div class="timeline-list">${body}</div></div>`, vm.score);
}

function overByOverBoardHtml(vm){
  const source = Array.isArray(vm.overSummary) ? vm.overSummary : [];
  const rows = source.slice(0,8);
  const body = rows.length ? rows.map(o=>`<div class="timeline-line"><b>Over ${escapeHtml(o.overNo ?? "-")}</b><span>${(o.timeline||[]).map(x=>`<span class="ball ${ballClass(x)}">${escapeHtml(String(x).slice(0,3))}</span>`).join("")}</span></div>`).join("") : `<div class="timeline-line"><b>Current</b><span>${ballsHtml(vm.thisOver)}</span></div>`;
  return boardWrap("Over by Over", vm.title, `<div class="tv-table"><div class="timeline-list">${body}</div></div>`, vm.oversLine);
}

function squadBoardHtml(vm){
  const players = (vm.players || []).slice(0,22);
  const body = players.length ? players.map((p,i)=>`<div>${i+1}. ${escapeHtml(p)}</div>`).join("") : `<div>No squad data</div>`;
  return boardWrap("Playing Squad", vm.battingTeam, `<div class="tv-table"><div class="squad-grid">${body}</div></div>`, vm.title);
}

function tossBoardHtml(vm){
  return boardWrap("Toss", vm.venue, `<div class="result-hero"><h2>${escapeHtml(vm.toss)}</h2><p>${escapeHtml(vm.title)}</p><div class="scoreline-big">${escapeHtml(vm.event)}</div></div>`, vm.status);
}

function nextMatchBoardHtml(vm){
  const schedule = Array.isArray(vm.league?.schedule) ? vm.league.schedule : [];
  const next = schedule.find(x => !["completed","done"].includes(String(x.status||"").toLowerCase())) || {};
  const label = next.teamA || next.teamA?.name ? `${next.teamA?.name || next.teamA} vs ${next.teamB?.name || next.teamB}` : "Next match data pending";
  return boardWrap("Next Match", vm.event, `<div class="result-hero"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(next.stage || next.round || vm.venue || "")}</p><div class="scoreline-big">${escapeHtml(next.status || "Upcoming")}</div></div>`, vm.title);
}

function padRows(rows, count){ const out=[...(rows||[])]; while(out.length<count) out.push({name:"-",r:"-",b:"-",f:"-",s:"-"}); return out.slice(0,count); }
function padBowls(rows, count){ const out=[...(rows||[])]; while(out.length<count) out.push(["-",{wkts:"-",runs:"-",balls:0}]); return out.slice(0,count); }
function calcSR(runs, balls){ return n(balls) ? ((n(runs)/n(balls))*100).toFixed(1) : "-"; }
function calcER(runs, balls){ return n(balls) ? (n(runs)/(n(balls)/6)).toFixed(1) : "-"; }
function nrr(p){ const rf=p?.BF ? n(p.RF)/(n(p.BF)/6) : 0, ra=p?.BA ? n(p.RA)/(n(p.BA)/6) : 0; return (rf-ra).toFixed(3); }

function ballsHtml(items = []){
  return items.length ? items.map(x => `<span class="ball ${ballClass(x)}">${escapeHtml(String(x).slice(0,3))}</span>`).join("") : `<span class="ball">-</span>`;
}
function ballClass(x){ const t=String(x); return /^W|wicket/i.test(t) ? "wicket" : t.includes("4") ? "four" : t.includes("6") ? "six" : ""; }

function applyPositions(pos = {}){
  Object.entries(pos).forEach(([id,p]) => {
    const el = document.getElementById(id);
    if (!el || id === "hot") return;
    const base = defaultPositions[id] || { x:0, y:0, w:240, h:90 };
    const x = Number.isFinite(+p.x) ? +p.x : base.x;
    const y = Number.isFinite(+p.y) ? +p.y : base.y;
    const w = Number.isFinite(+p.w) && +p.w >= 70 ? +p.w : base.w;
    const h = Number.isFinite(+p.h) && +p.h >= 34 ? +p.h : base.h;
    el.style.left = `${Math.max(0, Math.min(1280 - 20, x))}px`;
    el.style.top = `${Math.max(0, Math.min(720 - 20, y))}px`;
    el.style.right = "auto"; el.style.bottom = "auto";
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  });
}

function applyScale(){
  const isPreview = params.has("preview") || params.has("edit");
  if (!isPreview) return;
  const scale = Math.min(innerWidth / 1280, innerHeight / 720);
  stage.style.transform = `scale(${scale})`;
}
addEventListener("resize", applyScale);

function showHot(type, hotText, duration = 2200){
  if (!type || state.hotShowing) return;
  const hot = document.getElementById("hot");
  hot.querySelector("[data-text='hotType']").textContent = type;
  hot.querySelector("[data-text='hotText']").textContent = hotText || "";
  hot.classList.add("show");
  state.hotShowing = true;
  setTimeout(() => { hot.classList.remove("show"); state.hotShowing = false; }, duration);
}

function handleManualHot(c, vm){
  if (!c.hot) return;
  const key = c.hotNonce || `${c.hotType}|${c.hotText}|${state.control?.updatedAt || ""}`;
  if (state.lastManualHot === key) return;
  state.lastManualHot = key;
  showHot(c.hotType || "LIVE", c.hotText || vm.hotText, c.hotDuration);
}

function handleAutoHot(c, vm){
  if (!c.autoTriggers) return;
  const m = normalizeLive(state.live || {});
  const last = text(m.lastBall || (m.thisOver || []).slice(-1)[0] || "");
  const key = `${m.updatedAt || ""}|${last}`;
  if (!last || key === state.lastAutoKey) return;
  let type = "";
  if (/^w|wicket/i.test(last)) type = "WICKET";
  else if (String(last).includes("6")) type = "SIX";
  else if (String(last).includes("4")) type = "FOUR";
  if (type) {
    state.lastAutoKey = key;
    showHot(type, type === "WICKET" ? vm.lastWicket : vm.striker, control().hotDuration);
  }
}

let editBound = false;
function setupEdit(enabled){
  if (!enabled || editBound) return;
  editBound = true;
  cardEls.filter(el => el.id && el.id !== "hot").forEach(el => {
    if (!el.querySelector(".resize-handle")) {
      const h = document.createElement("div");
      h.className = "resize-handle";
      el.appendChild(h);
    }
    el.addEventListener("pointerdown", startDrag);
  });
  window.addEventListener("message", handleEditMessage);
  window.addEventListener("keydown", handleEditKeydown);
}

function startDrag(e){
  const el = e.currentTarget;
  if (!el.classList.contains("show")) return;
  selectEditCard(el);
  const resizing = e.target.classList.contains("resize-handle");
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  const scale = stage.getBoundingClientRect().width / 1280;
  const start = { x:e.clientX/scale, y:e.clientY/scale, left:parseFloat(el.style.left)||el.offsetLeft, top:parseFloat(el.style.top)||el.offsetTop, w:el.offsetWidth, h:el.offsetHeight };
  const move = ev => {
    const x = ev.clientX/scale, y = ev.clientY/scale;
    if (resizing) {
      el.style.width = `${Math.max(70, start.w + x - start.x)}px`;
      el.style.height = `${Math.max(34, start.h + y - start.y)}px`;
    } else {
      el.style.left = `${Math.max(0, Math.min(1280 - el.offsetWidth, start.left + x - start.x))}px`;
      el.style.top = `${Math.max(0, Math.min(720 - el.offsetHeight, start.top + y - start.y))}px`;
      el.style.right = "auto"; el.style.bottom = "auto";
    }
    postPositions();
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    postPositions();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

function selectEditCard(el){
  if (!el?.id) return;
  state.selectedEditId = el.id;
  cardEls.forEach(card => card.classList.toggle("selected", card.id === el.id));
  parent?.postMessage?.({ type:"obs-selected-card", matchId:state.matchId, cardId:el.id }, "*");
}

function handleEditKeydown(e){
  if (!control().edit || !state.selectedEditId || !/^Arrow/.test(e.key)) return;
  e.preventDefault();
  nudgeSelectedCard({
    dx:e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
    dy:e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0,
    resize:e.ctrlKey || e.metaKey,
    step:e.shiftKey ? 10 : 1
  });
}

function handleEditMessage(e){
  if (e.data?.type !== "obs-nudge-card") return;
  if (e.data.matchId && e.data.matchId !== state.matchId) return;
  if (e.data.cardId) {
    const el = document.getElementById(e.data.cardId);
    if (el) selectEditCard(el);
  }
  nudgeSelectedCard(e.data);
}

function nudgeSelectedCard({ dx = 0, dy = 0, step = 1, resize = false } = {}){
  const el = document.getElementById(state.selectedEditId || "");
  if (!el || !el.classList.contains("show")) return;
  const amount = Math.max(1, Number(step || 1));
  const moveX = Number(dx || 0) * amount;
  const moveY = Number(dy || 0) * amount;
  if (resize) {
    el.style.width = `${Math.max(70, Math.round(el.offsetWidth + moveX))}px`;
    el.style.height = `${Math.max(34, Math.round(el.offsetHeight + moveY))}px`;
  } else {
    const left = parseFloat(el.style.left) || el.offsetLeft || 0;
    const top = parseFloat(el.style.top) || el.offsetTop || 0;
    el.style.left = `${Math.max(0, Math.min(1280 - el.offsetWidth, Math.round(left + moveX)))}px`;
    el.style.top = `${Math.max(0, Math.min(720 - el.offsetHeight, Math.round(top + moveY)))}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }
  postPositions();
}

function collectPositions(){
  const out = {};
  cardEls.filter(el => el.id && el.id !== "hot").forEach(el => {
    const base = defaultPositions[el.id] || { x:0, y:0, w:240, h:90 };
    const w = Math.max(70, Math.round(el.offsetWidth || base.w));
    const h = Math.max(34, Math.round(el.offsetHeight || base.h));
    out[el.id] = {
      x:Math.round(parseFloat(el.style.left)||el.offsetLeft||base.x),
      y:Math.round(parseFloat(el.style.top)||el.offsetTop||base.y),
      w,
      h
    };
  });
  return out;
}
function postPositions(){
  const positions = collectPositions();
  state.control = { ...(state.control || {}), positions };
  parent?.postMessage?.({ type:"obs-positions", matchId:state.matchId, positions }, "*");
}

onValue(ref(db, `liveMatches/${state.matchId}`), snap => { state.live = snap.val(); render(); }, err => { debugBox.textContent = err.message; debugBox.classList.add("show"); });
onValue(ref(db, `obsControl/${state.matchId}`), snap => { state.control = snap.val(); render(); }, err => { debugBox.textContent = err.message; debugBox.classList.add("show"); });

render();
