let listenLiveMatch, trackViewer, listenMatch, getLatestPublicMatch;
let mergeMatch = (live, store, prev) => ({ ...(prev || {}), ...(store || {}), ...(live || {}) });
let overText = balls => `${Math.floor(Number(balls || 0) / 6)}.${Number(balls || 0) % 6}`;
let calcSR = (r, b) => Number(b || 0) ? ((Number(r || 0) * 100) / Number(b)).toFixed(2) : "0.00";
let calcER = (r, balls) => Number(balls || 0) ? ((Number(r || 0) * 6) / Number(balls)).toFixed(2) : "0.00";
let normalizeState = obj => ({
  runs:0,wkts:0,balls:0,totalOvers:20,inningNumber:1,extras:0,partnershipRuns:0,partnershipBalls:0,
  bat1:{name:"-",r:0,b:0,f:0,s:0},bat2:{name:"-",r:0,b:0,f:0,s:0},striker:1,bowler:{name:"-",balls:0,r:0,w:0},
  battingScorecard:[],bowlerStats:{},over:[],overSummary:[],inningsDetails:{},...(obj || {})
});
async function ensureFirebaseModules(){
  if (listenLiveMatch && listenMatch) return;
  const liveMod = await import("./firebase-live.js");
  const storeMod = await import("./firebase-store.js");
  const syncMod = await import("./live-sync.js");
  listenLiveMatch = liveMod.listenLiveMatch;
  trackViewer = liveMod.trackViewer;
  listenMatch = storeMod.listenMatch;
  getLatestPublicMatch = storeMod.getLatestPublicMatch;
  mergeMatch = syncMod.mergeMatch || mergeMatch;
  overText = syncMod.overText || overText;
  calcSR = syncMod.calcSR || calcSR;
  calcER = syncMod.calcER || calcER;
  normalizeState = syncMod.normalizeState || normalizeState;
}

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let MATCH_ID = (params.get("match") || "").trim();
const CARD = (params.get("card") || "scorebug").toLowerCase();
const THEME = (params.get("theme") || "gold").toLowerCase();
const DEMO = params.get("demo") === "1";
const SCALE = Number(params.get("scale") || 1);
const VIEWER_ID = crypto?.randomUUID?.() || `obs_${Date.now()}`;

const setText = (id, value) => { const el = $(id); if (el) el.textContent = value ?? "-"; };
const setHTML = (id, value) => { const el = $(id); if (el) el.innerHTML = value ?? ""; };
const safe = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const short = x => String(x || "-").split(/\s+/).filter(Boolean).map(v => v[0]).join("").slice(0, 3).toUpperCase() || "-";
const teamShort = t => t?.shortName || short(t?.name || t || "-");
const scoreOf = (m, teamName) => {
  const d = m.inningsDetails?.[teamName];
  if (d) return `${d.runs ?? 0}/${d.wkts ?? 0} (${d.overs || overText(d.balls || 0)})`;
  return "";
};
const crrOf = m => m.balls ? (Number(m.runs || 0) / (Number(m.balls || 0) / 6)).toFixed(2) : "0.00";
const needOf = m => m.target ? Math.max(Number(m.target) - Number(m.runs || 0), 0) : null;
const remBallsOf = m => Math.max(Number(m.totalOvers || 20) * 6 - Number(m.balls || 0), 0);
const rrrOf = m => { const need = needOf(m), rem = remBallsOf(m); return need == null ? "-" : (rem ? ((need * 6) / rem).toFixed(2) : "0.00"); };
const ballClass = x => String(x).includes("W") ? "wicket" : (["4", "6"].includes(String(x)) ? "boundary" : "");

const app = {
  live: null,
  store: null,
  state: normalizeState({}),

  init() {
    const root = $("obsRoot");
    root.dataset.card = CARD;
    if (params.get("debug") === "1") root.classList.add("debug");
    root.classList.remove("theme-gold");
    root.classList.add(`theme-${THEME}`);
    if (params.get("safe") === "1") root.classList.add("safe");
    if (SCALE && SCALE !== 1) root.style.transform = `scale(${SCALE})`;

    if (DEMO) return this.demo();
    this.bootstrap();
  },

  async bootstrap() {
    try {
      this.badge("CONNECTING", "");
      await ensureFirebaseModules();
      if (!MATCH_ID) {
        const latest = await getLatestPublicMatch();
        if (!latest?.matchId) return this.noData("अभी कोई live match नहीं मिला");
        MATCH_ID = latest.matchId;
        this.store = latest;
        history.replaceState(null, "", this.urlWithMatch(MATCH_ID));
      }
      listenLiveMatch(MATCH_ID, live => { this.live = live; this.publish(); }, e => this.noData(`Realtime error: ${e.message}`));
      listenMatch(MATCH_ID, store => { this.store = store; this.publish(); }, e => this.noData(`Firestore error: ${e.message}`));
      trackViewer?.(MATCH_ID, VIEWER_ID, () => {});
    } catch (e) {
      this.noData(e.message);
    }
  },

  urlWithMatch(matchId) {
    const p = new URLSearchParams(location.search); p.set("match", matchId); return `${location.pathname}?${p.toString()}`;
  },

  publish() {
    this.state = normalizeState(mergeMatch(this.live, this.store, this.state));
    if (!this.hasData(this.state)) return this.noData("Waiting for admin data...");
    this.badge("LIVE DATA", "ok");
    this.render(this.state);
  },

  hasData(m) { return !!(m?.matchId || m?.matchTitle || m?.liveStarted || m?.matchFinished || Number(m?.runs || 0) || Number(m?.balls || 0)); },
  badge(text, type) { const el = $("connectionBadge"); el.textContent = text; el.className = `connection-badge ${type || ""}`; },
  noData(msg) { this.badge("NO DATA", "err"); setText("tickerText", msg); setText("ltMeta", msg); },

  render(m) {
    const batting = m.battingTeam || m.teamA || { name: "Team A" };
    const bowling = m.bowlingTeam || m.teamB || { name: "Team B" };
    const first = m.inningNumber === 1 ? batting : (m.teamA || bowling);
    const second = m.inningNumber === 1 ? bowling : batting;
    const firstName = first?.name || "Team A";
    const secondName = second?.name || "Team B";
    const firstScore = scoreOf(m, firstName) || m.firstInnings || (m.inningNumber === 1 ? `${m.runs}/${m.wkts} (${overText(m.balls)})` : "-");
    const secondScore = scoreOf(m, secondName) || m.secondInnings || (m.inningNumber === 2 || m.matchFinished ? `${m.runs}/${m.wkts} (${overText(m.balls)})` : "Yet to bat");
    const crr = crrOf(m), need = needOf(m), rem = remBallsOf(m), rrr = rrrOf(m);
    const status = m.matchFinished ? "RESULT" : (m.liveControl?.mode === "paused" ? "BREAK" : (m.liveControl?.mode === "delay" ? "DELAY" : "LIVE"));
    const striker = m.striker === 1 ? m.bat1 : m.bat2;
    const non = m.striker === 1 ? m.bat2 : m.bat1;
    const mainScore = `${m.runs || 0}/${m.wkts || 0}`;
    const overs = `${overText(m.balls || 0)} ov`;

    setText("bugTeamA", teamShort(first)); setText("bugTeamB", teamShort(second)); setText("bugStatus", status);
    setText("bugScoreA", firstScore); setText("bugScoreB", secondScore); setText("bugMainScore", mainScore); setText("bugOvers", overs);
    setText("bugSubA", m.inningNumber === 1 ? "Batting" : "1st Inn"); setText("bugSubB", m.inningNumber === 2 ? "Batting" : "2nd Inn");
    setText("bugMatchTitle", m.matchTitle || "Live Match");
    setText("bugInfo", m.matchFinished ? (m.winnerText || "Match Complete") : `CRR ${crr}${need != null ? ` · Need ${need} from ${rem} · RRR ${rrr}` : ""}`);

    setText("ltTitle", m.matchTitle || "Live Cricket"); setText("ltBattingTeam", teamShort(batting)); setText("ltScore", mainScore); setText("ltOvers", overs);
    setText("ltMeta", `${safe(m.tossText || status)} · CRR ${crr}${need != null ? ` · Need ${need} from ${rem}` : ""}`);

    setText("bat1Name", `${striker?.name || "-"}`); setText("bat1Score", `${striker?.r || 0} (${striker?.b || 0})`);
    setText("bat2Name", `${non?.name || "-"}`); setText("bat2Score", `${non?.r || 0} (${non?.b || 0})`);
    setText("batPartnership", `${m.partnershipRuns || 0} (${m.partnershipBalls || 0})`);
    setText("partRuns", m.partnershipRuns || 0); setText("partBalls", `${m.partnershipBalls || 0} balls`); setText("partNames", `${striker?.name || "-"} & ${non?.name || "-"}`);

    setText("bowlerName", m.bowler?.name || "-"); setText("bowlerFig", `${overText(m.bowler?.balls || 0)}-${m.bowler?.r || 0}-${m.bowler?.w || 0}`);
    setText("lastWicketSmall", m.lastWicket || "-");

    setText("targetRuns", m.target || "-"); setText("targetNeed", need == null ? "Target not set" : `Need ${need} from ${rem} · RRR ${rrr}`);
    this.renderBalls(m);

    setText("teamScoreNameA", firstName); setText("teamScoreValueA", firstScore); setText("teamScoreNameB", secondName); setText("teamScoreValueB", secondScore);
    setText("teamScoreResult", m.matchFinished ? (m.winnerText || "Match Complete") : `${status} · ${m.tossText || ""}`);

    setText("inningsKicker", m.matchFinished ? "MATCH COMPLETE" : (m.inningNumber === 2 ? "CHASE RUNNING" : "INNINGS SCORE"));
    setText("inningsScore", firstScore); setText("inningsText", m.target ? `${secondName} target ${m.target}` : `${firstName} batting · CRR ${crr}`);

    this.renderScoreboard(m, batting?.name || firstName, mainScore, overs);
    this.renderSummary(m, firstName, secondName, firstScore, secondScore, status, crr, rrr, need, rem);
    setText("tickerText", this.ticker(m, firstName, secondName, firstScore, secondScore, crr, rrr, need, rem));
  },

  renderBalls(m) {
    const arr = m.over?.length ? m.over : (m.overSummary?.length ? m.overSummary[m.overSummary.length - 1].timeline : []);
    setHTML("lastOverBalls", arr.length ? arr.map(x => `<span class="ball ${ballClass(x)}">${safe(String(x).slice(0,3))}</span>`).join("") : `<span class="ball">-</span>`);
    setText("lastOverText", m.over?.length ? "Current over" : "Last completed over");
  },

  currentBattingRows(m) {
    const rows = [...(m.battingScorecard || [])];
    [m.bat1, m.bat2].forEach(b => { if (b?.name && b.name !== "-" && !rows.some(x => x.name === b.name)) rows.push(b); });
    return rows;
  },

  renderScoreboard(m, battingTeamName, mainScore, overs) {
    setText("scoreboardTitle", `${battingTeamName || "Batting"} SCOREBOARD`); setText("scoreboardScore", `${mainScore} (${overs})`);
    const detail = m.inningsDetails?.[battingTeamName];
    const batting = detail?.battingScorecard || this.currentBattingRows(m);
    const bowling = detail?.bowlerStats || m.bowlerStats || {};
    setHTML("scoreboardBatting", batting.length ? batting.slice(0, 9).map(b => `<tr><td><b>${safe(b.name)}</b>${b.out ? "" : " *"}<span class="outtext">${safe(b.dismissal || "not out")}</span></td><td>${b.r || 0}</td><td>${b.b || 0}</td><td>${b.f || 0}</td><td>${b.s || 0}</td><td>${calcSR(b.r || 0, b.b || 0)}</td></tr>`).join("") : `<tr><td colspan="6">No batting data</td></tr>`);
    setHTML("scoreboardBowling", Object.keys(bowling).length ? Object.entries(bowling).slice(0, 8).map(([name, s]) => `<tr><td><b>${safe(name)}</b></td><td>${overText(s.balls || 0)}</td><td>${s.runs || 0}</td><td>${s.wkts || 0}</td><td>${calcER(s.runs || 0, s.balls || 0)}</td></tr>`).join("") : `<tr><td colspan="5">No bowling data</td></tr>`);
  },

  allBatters(m) {
    const out = [];
    Object.values(m.inningsDetails || {}).forEach(i => out.push(...(i.battingScorecard || [])));
    if (!out.length) out.push(...this.currentBattingRows(m));
    return out;
  },

  bestBowler(m) {
    const bowl = {};
    Object.values(m.inningsDetails || {}).forEach(i => Object.entries(i.bowlerStats || {}).forEach(([n, s]) => { bowl[n] = bowl[n] || { runs: 0, balls: 0, wkts: 0 }; bowl[n].runs += Number(s.runs || 0); bowl[n].balls += Number(s.balls || 0); bowl[n].wkts += Number(s.wkts || 0); }));
    if (!Object.keys(bowl).length) Object.assign(bowl, m.bowlerStats || {});
    const best = Object.entries(bowl).sort((a, b) => Number(b[1].wkts || 0) - Number(a[1].wkts || 0) || Number(a[1].runs || 0) - Number(b[1].runs || 0))[0];
    return best ? `${best[0]} ${best[1].wkts || 0}/${best[1].runs || 0}` : "-";
  },

  renderSummary(m, firstName, secondName, firstScore, secondScore, status, crr, rrr, need, rem) {
    const top = [...this.allBatters(m)].sort((a, b) => Number(b.r || 0) - Number(a.r || 0))[0];
    setText("summaryStatus", status); setText("sumTeamA", firstName); setText("sumScoreA", firstScore); setText("sumTeamB", secondName); setText("sumScoreB", secondScore);
    setText("sumTopBatter", top ? `${top.name} ${top.r || 0}` : "-"); setText("sumBestBowler", this.bestBowler(m));
    setText("summaryResult", m.matchFinished ? (m.winnerText || "Match Complete") : (need != null ? `Need ${need} from ${rem}` : "Match Running"));
    setText("summaryInfo", `${m.tossText || ""} · CRR ${crr} · RRR ${rrr} · Extras ${m.extras || 0}`);
  },

  ticker(m, firstName, secondName, firstScore, secondScore, crr, rrr, need, rem) {
    const striker = m.striker === 1 ? m.bat1 : m.bat2, non = m.striker === 1 ? m.bat2 : m.bat1;
    return `${m.matchTitle || "Live Match"}  |  ${firstName}: ${firstScore}  |  ${secondName}: ${secondScore}  |  ${striker?.name || "-"} ${striker?.r || 0}(${striker?.b || 0})  |  ${non?.name || "-"} ${non?.r || 0}(${non?.b || 0})  |  Bowler: ${m.bowler?.name || "-"} ${overText(m.bowler?.balls || 0)}-${m.bowler?.r || 0}-${m.bowler?.w || 0}  |  CRR ${crr} ${need != null ? ` | Need ${need} from ${rem} | RRR ${rrr}` : ""}  |  ${m.winnerText || m.tossText || ""}`;
  },

  demo() {
    this.badge("DEMO DATA", "ok");
    const demo = normalizeState({
      matchId:"demo", matchTitle:"MCC Premier League · Final", inningNumber:2, totalOvers:20,
      teamA:{name:"Mahagama Cricket Club",shortName:"MCC"}, teamB:{name:"Tech Source XI",shortName:"TSX"},
      battingTeam:{name:"Tech Source XI",shortName:"TSX"}, bowlingTeam:{name:"Mahagama Cricket Club",shortName:"MCC"},
      runs:118,wkts:4,balls:94,target:156,extras:8,tossText:"MCC won the toss and elected to bat", partnershipRuns:42, partnershipBalls:29,
      bat1:{name:"Sahil Khan",r:36,b:24,f:4,s:2}, bat2:{name:"Md Raza",r:21,b:17,f:2,s:1}, striker:1,
      bowler:{name:"Aman Raj",balls:16,r:19,w:1}, lastWicket:"Rahul 14 (Run Out)",
      firstInnings:"155/7 (20.0)", secondInnings:"118/4 (15.4)", over:["1","4","0","W","2","6"],
      battingScorecard:[{name:"Sahil Khan",r:36,b:24,f:4,s:2},{name:"Md Raza",r:21,b:17,f:2,s:1},{name:"Rahul",r:14,b:12,f:1,s:0,out:true,dismissal:"run out"}],
      bowlerStats:{"Aman Raj":{balls:16,runs:19,wkts:1},"Vikash":{balls:18,runs:26,wkts:2},"Saddam":{balls:12,runs:18,wkts:1}}
    });
    this.render(demo);
  }
};

window.obsOverlay = app;
app.init();
