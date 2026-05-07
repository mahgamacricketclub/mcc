﻿import { firestoreDb as db, doc, onSnapshot } from "./firebase-store.js";
import { listenLiveMatch, trackViewer } from "./live-sync.js";
const params = new URLSearchParams(location.search);
const MATCH_ID = (params.get("match") || "liveMatch1").trim();
const USER_MATCH_BACKUP_KEY = `cricket_user_match_backup_${MATCH_ID}`;

window.app = {
  state: {},
  permanentState: {},
  unsubscribeLive: null,
  unsubscribePermanent: null,
  scorecardView: "teamA",
  matchesFilter: "all",
  selectedMatchIndex: undefined,
  selectedPlayer: null,
  renderQueued: false,

  init() {
    this.showNoLive("Connecting to live match...");
    this.loadMatchBackup();
    document.addEventListener("keydown", (event) => {
      if(event.key === "Escape") this.closeMatchModal();
    });
    this.setupFirebase();
  },

  showNoLive(message) {
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
    const setHtml = (id, value) => { const el = document.getElementById(id); if (el) el.innerHTML = value; };
    setText("matchTitle", `Live Match > ${MATCH_ID}`);
    setHtml("mainScore", "--/--<br><small>(--)</small>");
    setText("teamA", "-");
    setText("teamB", "-");
    setText("logo1", "-");
    setText("logo2", "-");
    setText("tossText", "-");
    setText("liveInfo", message);
    setHtml("battingInfo", '<span class="batter-line striker-line">- <span class="strike-mark">🏏</span></span><span class="batter-line">-</span>');
    setHtml("bowlingInfo", '-<br>Last: -<br>This Over: <span class="mini-over"><span class="ball-dot">-</span></span>');
    setHtml("allOverStrip", '<div class="over-row"><div class="bowler-line">Over: -</div><div class="mini-over"><span class="ball-dot">-</span></div></div>');
    this.renderMatchesList();
    this.renderLeaguePanel();
  },
  showLatestCompletedNoLive(matchData) {
    const titleTeams = String(matchData.title || "").split(" vs ");
    const rawBatting = matchData.battingTeam || "";
    const rawBowling = matchData.bowlingTeam || "";
    const teamA = matchData.teamA || ((matchData.inningNumber || 2) > 1 ? rawBowling : rawBatting) || titleTeams[0] || "-";
    const teamB = matchData.teamB || ((matchData.inningNumber || 2) > 1 ? rawBatting : rawBowling) || titleTeams[1] || "-";
    const leftShort = this.teamShort(matchData, teamA);
    const rightShort = this.teamShort(matchData, teamB);
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
    const setHtml = (id, value) => { const el = document.getElementById(id); if (el) el.innerHTML = value; };
    setText("matchTitle", `${matchData.title || "Last Match"} > ${MATCH_ID}`);
    setText("teamA", leftShort);
    setText("teamB", rightShort);
    setHtml("logo1", this.logoHtml(matchData, teamA));
    setHtml("logo2", this.logoHtml(matchData, teamB));
    setHtml("mainScore", `${this.safe(matchData.firstInnings || this.inningsScoreText(matchData, teamA, "-"))}<br><small>1st innings</small>`);
    setHtml("teamBScore", `${this.safe(matchData.secondInnings || this.inningsScoreText(matchData, teamB, "-"))}<br><small>2nd innings</small>`);
    const tossEl = document.getElementById("tossText");
    if(tossEl){
      tossEl.innerText = "Complete";
      tossEl.classList.remove("live", "delay", "break", "locked", "result", "pending", "ready");
      tossEl.classList.add("result");
    }
    const mom = this.manOfMatch(matchData);
    setText("liveInfo", `${matchData.winnerText || "Latest match completed"}${mom ? ` · Man of the Match: ${mom.name}` : ""}`);
    setHtml("battingInfo", '<span class="batter-line">No live match</span><span class="batter-line">Start next match from admin</span>');
    setHtml("bowlingInfo", `${this.safe(matchData.title || `${teamA} vs ${teamB}`)}<br>Completed`);
    setHtml("allOverStrip", '<div class="over-row"><div class="bowler-line">Latest result</div><div class="mini-over"><span class="ball-dot">OK</span></div></div>');
    document.querySelector(".header")?.classList.add("compact-complete");
    this.renderMatchesList();
    this.renderLeaguePanel();
  },

  setupFirebase() {
    // Firestore: permanent data like completed matches, league, points table, teams.
    this.unsubscribePermanent = onSnapshot(doc(db, "matches", MATCH_ID), (snap) => {
      if (snap.exists()) {
        this.permanentState = snap.data() || {};
        // Jab live RTDB data available nahi ho, tab permanent Firestore fallback use hota hai.
        if(!this.state || !this.state.liveStarted){
          this.state = { ...(this.state || {}), ...this.permanentState };
          this.persistMatchBackup();
          this.scheduleRender();
        }
      } else if(!this.state || Object.keys(this.state).length === 0) {
        this.showNoLive("No live match created yet");
      }
    }, (error) => {
      console.error("Firestore Error:", error);
      if(!this.state || Object.keys(this.state).length === 0) this.showNoLive("Unable to connect to match history");
    });

    // Realtime Database: ultra-fast live score, commentary, over timeline.
    this.unsubscribeLive = listenLiveMatch(MATCH_ID, (liveData) => {
      if(liveData && liveData.liveStarted && !liveData.matchFinished){
        this.state = { ...(this.permanentState || {}), ...liveData };
        this.persistMatchBackup();
        this.scheduleRender();
        return;
      }
      // Live match remove ho chuka hai, completed history Firestore se dikhao.
      if(this.permanentState && Object.keys(this.permanentState).length){
        this.state = this.permanentState;
        this.persistMatchBackup();
        this.scheduleRender();
      } else {
        this.showNoLive("No live match created yet");
      }
    }, (error) => {
      console.error("Realtime DB Error:", error);
      if(this.permanentState && Object.keys(this.permanentState).length){
        this.state = this.permanentState;
        this.scheduleRender();
      } else {
        this.showNoLive("Unable to connect to live match");
      }
    });

    trackViewer(MATCH_ID);
  },
  loadMatchBackup(){
    try{
      const raw=localStorage.getItem(USER_MATCH_BACKUP_KEY);
      if(!raw) return;
      const saved=JSON.parse(raw);
      if(!saved || !saved.state || typeof saved.state!=="object") return;
      this.state=saved.state;
      this.scheduleRender();
    }catch(e){ console.warn("User match backup load failed",e); }
  },
  persistMatchBackup(){
    try{
      localStorage.setItem(USER_MATCH_BACKUP_KEY,JSON.stringify({state:this.state||{},timestamp:Date.now()}));
    }catch(e){ console.warn("User match backup failed",e); }
  },
  scheduleRender() {
    if(this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  },

  overText(balls) {
    balls = Number(balls || 0);
    return Math.floor(balls / 6) + "." + (balls % 6);
  },

  sr(p) {
    return p && p.b ? ((p.r / p.b) * 100).toFixed(2) : "0.00";
  },

  er(bowler) {
    if (!bowler || !bowler.balls) return "0.00";
    return (bowler.r / (bowler.balls / 6)).toFixed(2);
  },

  safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[ch]));
  },

  shortName(name) {
    if (!name) return "-";
    return name.split(" ").map(x => x[0]).join("").slice(0, 3).toUpperCase();
  },

  teamMeta(matchData, team) {
    const info = matchData && matchData.teamInfo && typeof matchData.teamInfo === "object" ? matchData.teamInfo : {};
    return info[team] || {};
  },

  teamShort(matchData, team) {
    const meta = this.teamMeta(matchData, team);
    return meta.shortName || this.shortName(team);
  },

  playerMeta(matchData, team, player) {
    const meta = this.teamMeta(matchData, team);
    return meta.players && meta.players[player] ? meta.players[player] : {};
  },

  logoHtml(matchData, team) {
    const meta = this.teamMeta(matchData, team);
    const label = this.safe(this.teamShort(matchData, team));
    return meta.logo ? `<img src="${this.safe(meta.logo)}" alt="${label}">` : label;
  },

  avatarHtml(matchData, team, player) {
    const meta = this.playerMeta(matchData, team, player);
    const label = this.safe(this.shortName(player).slice(0, 2));
    return `<div class="avatar">${meta.image ? `<img src="${this.safe(meta.image)}" alt="${this.safe(player)}">` : label}</div>`;
  },

  inningsScoreText(matchData, team, fallback) {
    const detail = matchData && matchData.inningsDetails ? matchData.inningsDetails[team] : null;
    if(detail) return `${Number(detail.runs || 0)}/${Number(detail.wkts || 0)} (${detail.overs || this.overText(detail.balls || 0)})`;
    return fallback || "-";
  },

  manOfMatch(matchData) {
    const stored = matchData?.mvp || matchData?.manOfMatch || matchData?.playerOfMatch;
    if(stored) return { name: String(stored), note: "official pick", score: 0 };
    const latestLog = Array.isArray(this.state?.mvpLog)
      ? this.state.mvpLog.find(x => (x?.match === matchData?.title) || (x?.match === matchData?.matchTitle))
      : null;
    if(latestLog?.mvp) return { name: String(latestLog.mvp), note: "official pick", score: 0 };

    const players = {};
    const ensure = (name) => {
      if(!name || name === "-") return null;
      if(!players[name]) players[name] = { name, runs:0, balls:0, fours:0, sixes:0, wkts:0, bowlingBalls:0, bowlingRuns:0, score:0 };
      return players[name];
    };
    const addBat = (row) => {
      const p = ensure(row?.name);
      if(!p) return;
      const runs = Number(row.r || 0);
      const balls = Number(row.b || 0);
      const fours = Number(row.f || 0);
      const sixes = Number(row.s || 0);
      p.runs += runs;
      p.balls += balls;
      p.fours += fours;
      p.sixes += sixes;
      p.score += runs + (fours * 2) + (sixes * 3);
      if(runs >= 50) p.score += 10;
      else if(runs >= 30) p.score += 5;
      if(balls > 0 && runs >= 20 && (runs / balls) >= 1.5) p.score += 6;
    };
    const addBowl = (stats) => Object.entries(stats || {}).forEach(([name, s]) => {
      const p = ensure(name);
      if(!p) return;
      const wkts = Number(s?.wkts || 0);
      const balls = Number(s?.balls || 0);
      const runs = Number(s?.runs || 0);
      p.wkts += wkts;
      p.bowlingBalls += balls;
      p.bowlingRuns += runs;
      p.score += (wkts * 25);
      if(wkts >= 3) p.score += 12;
      if(balls >= 6 && runs <= balls) p.score += 5;
    });

    const details = matchData?.inningsDetails && typeof matchData.inningsDetails === "object" ? Object.values(matchData.inningsDetails) : [];
    if(details.length){
      details.forEach(d => {
        (Array.isArray(d?.battingScorecard) ? d.battingScorecard : []).forEach(addBat);
        addBowl(d?.bowlerStats);
      });
    } else {
      Object.values(matchData?.completedInnings || {}).forEach(rows => (Array.isArray(rows) ? rows : []).forEach(addBat));
      if(Array.isArray(matchData?.battingScorecard)) matchData.battingScorecard.forEach(addBat);
      Object.values(matchData?.completedBowling || {}).forEach(addBowl);
      addBowl(matchData?.bowlerStats);
    }

    const best = Object.values(players).sort((a,b) => b.score - a.score || b.runs - a.runs || b.wkts - a.wkts)[0];
    if(!best) return null;
    const parts = [];
    if(best.runs) parts.push(`${best.runs} runs`);
    if(best.wkts) parts.push(`${best.wkts} wkts`);
    return { name: best.name, note: parts.join(", ") || "best impact", score: best.score };
  },

  isWicketBall(value) {
    return /(^|\s)W(\d+)?(\s|\(|$)/.test(String(value || ""));
  },

  openTab(id, btn) {
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
    this.render();
  },

  switchScorecard(team, btn) {
    document.querySelectorAll('.team-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    this.scorecardView = team;
    this.render();
  },
  switchMatchesFilter(filter) {
    this.matchesFilter = ["all", "live", "complete", "pending"].includes(filter) ? filter : "all";
    this.renderMatchesList();
  },
  showMatchResult(index) {
    this.selectedMatchIndex = index;
    this.scorecardView = "teamA";
    this.render();
  },
  closeMatchModal(event) {
    if(event && event.currentTarget && event.target !== event.currentTarget) return;
    const modal = document.getElementById("matchDetailModal");
    if(modal){
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("modal-open");
  },
  backToLive() {
    this.selectedMatchIndex = undefined;
    this.scorecardView = "teamA";
    this.render();
  },

  renderMatchesList() {
    const history = Array.isArray(this.state.completedMatches) ? this.state.completedMatches : [];
    const schedule = Array.isArray(this.state.league?.schedule) ? this.state.league.schedule : [];
    const pendingMatches = schedule.filter(m => m.status !== "done");
    const listEl = document.getElementById("matchesList");
    if(!listEl) return;
    document.querySelectorAll(".matches-tab").forEach(tile => tile.classList.remove("active"));
    const filterIds = { all: "matchesFilterAll", live: "matchesFilterLive", complete: "matchesFilterComplete", pending: "matchesFilterPending" };
    document.getElementById(filterIds[this.matchesFilter] || filterIds.all)?.classList.add("active");
    const liveMatch = (this.state.liveStarted && !this.state.matchFinished) ? `<div class="match-group-title">Live</div><div class="match-result-card"><div class="match-result-title">${this.safe(this.state.matchTitle || "Live Match")}</div><div class="match-result-meta">${this.safe(this.state.battingTeam || "-")} batting · ${Number(this.state.runs||0)}/${Number(this.state.wkts||0)} (${this.overText(this.state.balls||0)})</div></div>` : "";
    const upcoming = pendingMatches.slice(0, 10).map(m => `<div class="match-result-card"><div class="match-result-title">${this.safe(m.teamA)} vs ${this.safe(m.teamB)}</div><div class="match-result-meta">${this.safe(m.stage || "League")} · ${this.safe(m.round || "")}${m.date?`<br>${this.safe(m.date)} ${this.safe(m.time||"")}`:""}${m.venue?` · ${this.safe(m.venue)}`:""}</div></div>`).join("");
    const completed = history.map((x, i) => `<div class="match-result-card ${i===this.selectedMatchIndex?'active':''}" onclick="app.showMatchResult(${i})"><div class="match-result-title">${this.safe(x.title || "Match")}</div><div class="match-result-meta">${this.safe(x.leagueStage || ("Match " + (history.length - i)))} · ${this.safe(x.winnerText || "-")}<br>${this.safe(x.firstInnings || "-")} ${x.secondInnings ? " / " + this.safe(x.secondInnings) : ""}</div></div>`).join("");
    const blocks = {
      all: `${liveMatch}${upcoming?`<div class="match-group-title">Pending</div>${upcoming}`:""}${completed?`<div class="match-group-title">Completed</div>${completed}`:""}`,
      live: liveMatch,
      complete: completed ? `<div class="match-group-title">Completed</div>${completed}` : "",
      pending: upcoming ? `<div class="match-group-title">Pending</div>${upcoming}` : ""
    };
    const html = blocks[this.matchesFilter] || blocks.all;
    listEl.innerHTML = html || '<span style="color:#999;font-size:13px;">No matches yet</span>';
  },
  nrr(points){
    const forRate=points?.BF?((Number(points.RF||0))/(Number(points.BF||0)/6)):0;
    const againstRate=points?.BA?((Number(points.RA||0))/(Number(points.BA||0)/6)):0;
    return (forRate-againstRate).toFixed(3);
  },
  renderLeaguePanel(){
    const league=this.state.league || {};
    const schedule=Array.isArray(league.schedule)?league.schedule:[];
    const teams=Array.isArray(league.teams)?league.teams:[];
    const done=schedule.filter(m=>m.status==="done").length;
    const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.innerText=String(val); };
    set("leagueTitle",league.name || "League");
    set("leagueTeamsCount",teams.length);
    set("leagueScheduleCount",schedule.length);
    set("leagueCompletedCount",done);
    set("leagueUpcomingCount",Math.max(schedule.length-done,0));
    const points=this.state.pointsTable||{};
    const body=document.getElementById("leaguePointsBody");
    if(body) body.innerHTML=(teams.length?teams:Object.keys(points)).map(team=>{
      const s=points[team]||{};
      return `<tr><td><b>${this.safe(team)}</b></td><td>${Number(s.P||0)}</td><td>${Number(s.W||0)}</td><td>${Number(s.L||0)}</td><td>${Number(s.T||0)}</td><td>${Number(s.Pts||0)}</td><td>${this.nrr(s)}</td></tr>`;
    }).join("") || '<tr><td colspan="7">No points data</td></tr>';
    const upcoming=document.getElementById("leagueUpcomingList");
    if(upcoming) upcoming.innerHTML=schedule.filter(m=>m.status!=="done").slice(0,12).map(m=>`<div class="match-result-card"><div class="match-result-title">${this.safe(m.teamA)} vs ${this.safe(m.teamB)}</div><div class="match-result-meta">${this.safe(m.stage||"League")} · ${this.safe(m.round||"")}${m.date?`<br>${this.safe(m.date)} ${this.safe(m.time||"")}`:""}${m.venue?` · ${this.safe(m.venue)}`:""}</div></div>`).join("") || '<span style="color:#999;font-size:13px;">No upcoming matches</span>';
  },
  showPlayerProfile(team, player){
    const modal = document.getElementById("matchDetailModal");
    const body = document.getElementById("matchModalBody");
    if(!modal || !body) return;
    const meta = this.playerMeta(this.state, team, player);
    const stats = this.playerTotalStats(player);
    const battingText = `${Number(stats.runs || 0)} runs · ${Number(stats.balls || 0)} balls`;
    const boundaryText = `${Number(stats.fours || 0)} fours · ${Number(stats.sixes || 0)} sixes`;
    const bowlingText = `${Number(stats.wkts || 0)} wickets · ${this.overText(stats.bowlingBalls || 0)} overs · ${Number(stats.dots || 0)} dots`;
    body.innerHTML = `
      <div class="player-modal-head">
        ${this.avatarHtml(this.state, team, player)}
        <div>
          <div class="match-modal-kicker">${this.safe(team)}</div>
          <h2 class="match-modal-title" id="matchModalTitle">${this.safe(player)}</h2>
          <div class="match-modal-result">${this.safe(meta.role || "Player")}</div>
        </div>
      </div>
      <div class="match-modal-grid">
        <div><span>Total Matches</span><b>${Number(stats.matches || 0)}</b></div>
        <div><span>Batting Total</span><b>${this.safe(battingText)}</b></div>
        <div><span>Boundaries</span><b>${this.safe(boundaryText)}</b></div>
        <div><span>Bowling Total</span><b>${this.safe(bowlingText)}</b></div>
        <div><span>Team</span><b>${this.safe(team)}</b></div>
      </div>
    `;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  },
  playerTotalStats(player){
    const totals = { runs:0, balls:0, fours:0, sixes:0, wkts:0, bowlingBalls:0, bowlingRuns:0, dots:0, matches:0 };
    const addBat = (row, seen) => {
      if(!row || row.name !== player) return seen;
      totals.runs += Number(row.r || 0);
      totals.balls += Number(row.b || 0);
      totals.fours += Number(row.f || 0);
      totals.sixes += Number(row.s || 0);
      return true;
    };
    const addBowling = (stats, seen) => {
      const s = stats && stats[player];
      if(!s) return seen;
      totals.wkts += Number(s.wkts || 0);
      totals.bowlingBalls += Number(s.balls || 0);
      totals.bowlingRuns += Number(s.runs || 0);
      totals.dots += Number(s.dots || s.dotBalls || s.dot || 0);
      return true;
    };
    const history = Array.isArray(this.state.completedMatches) ? this.state.completedMatches : [];
    history.forEach(match => {
      let seen = false;
      const details = match?.inningsDetails && typeof match.inningsDetails === "object" ? Object.values(match.inningsDetails) : [];
      if(details.length){
        details.forEach(d => {
          (Array.isArray(d?.battingScorecard) ? d.battingScorecard : []).forEach(row => { seen = addBat(row, seen); });
          seen = addBowling(d?.bowlerStats, seen);
        });
      } else {
        Object.values(match?.completedInnings || {}).forEach(rows => (Array.isArray(rows) ? rows : []).forEach(row => { seen = addBat(row, seen); }));
        if(Array.isArray(match?.battingScorecard)) match.battingScorecard.forEach(row => { seen = addBat(row, seen); });
        Object.values(match?.completedBowling || {}).forEach(stats => { seen = addBowling(stats, seen); });
        seen = addBowling(match?.bowlerStats, seen);
      }
      if(seen) totals.matches += 1;
    });

    [this.state.bat1, this.state.bat2].forEach(row => { addBat(row, false); });
    if(this.state.bat1?.name === player || this.state.bat2?.name === player || this.state.bowler?.name === player) totals.matches += 1;
    addBowling(this.state.bowlerStats, false);

    const stored = this.state.tournamentStats?.players?.[player] || {};
    if(!history.length && !totals.matches){
      totals.runs = Number(stored.runs || 0);
      totals.balls = Number(stored.balls || 0);
      totals.wkts = Number(stored.wkts || 0);
      totals.matches = Number(stored.matches || 0);
    }
    return totals;
  },
  renderPlayerProfile(){
    const box=document.getElementById("playerProfile");
    if(!box) return;
    const sel=this.selectedPlayer;
    if(!sel){ box.innerHTML=""; return; }
    const meta=this.playerMeta(this.state, sel.team, sel.player);
    const stats=this.playerTotalStats(sel.player);
    box.innerHTML=`<div class="profile-card">${this.avatarHtml(this.state, sel.team, sel.player)}<div><h3 style="margin:0;">${this.safe(sel.player)}</h3><div class="role">${this.safe(sel.team)}</div></div></div>
      <div class="profile-stats">
        <div class="profile-stat"><span>Runs</span><b>${Number(stats.runs||0)}</b></div>
        <div class="profile-stat"><span>Balls</span><b>${Number(stats.balls||0)}</b></div>
        <div class="profile-stat"><span>Wickets</span><b>${Number(stats.wkts||0)}</b></div>
        <div class="profile-stat"><span>Matches</span><b>${Number(stats.matches||0)}</b></div>
      </div>`;
  },

  followToggle(btn) {
    const target = (this.state.followLink || "").trim();
    if(target){
      window.open(target, "_blank");
      return;
    }
    const key = "cricket_followed_matches";
    const link = location.href;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || "[]"); } catch(e) { list = []; }
    if(!list.some(x => x.url === link)){
      list.unshift({ title: this.state.matchTitle || document.getElementById("matchTitle")?.innerText || "Live Match", matchId: MATCH_ID, url: link, followedAt: Date.now() });
      localStorage.setItem(key, JSON.stringify(list.slice(0, 20)));
    }
    btn.innerText = "Following";
    btn.style.background = "#52B788";
    if(navigator.share){
      navigator.share({ title: "Live Cricket Score", url: link }).catch(()=>{});
    } else if(navigator.clipboard) {
      navigator.clipboard.writeText(link).catch(()=>{});
    }
  },

  render() {
    try{
    const m = this.state;
    if (!m || Object.keys(m).length === 0) return this.showNoLive("Waiting for admin data");
    let isViewingCompleted = this.selectedMatchIndex !== undefined;
    if(isViewingCompleted && !(Array.isArray(m.completedMatches) && m.completedMatches[this.selectedMatchIndex])){
      this.selectedMatchIndex = undefined;
      isViewingCompleted = false;
    }
    const matchData = isViewingCompleted ? m.completedMatches[this.selectedMatchIndex] : m;
    if (!matchData) return this.showNoLive("Invalid match data");
    if (!isViewingCompleted && !matchData.liveStarted && (!matchData.matchTitle || !matchData.battingTeam || !matchData.bowlingTeam)){
      const latest = Array.isArray(m.completedMatches) ? m.completedMatches[0] : null;
      if(latest) return this.showLatestCompletedNoLive(latest);
      return this.showNoLive("Admin has not started a match yet");
    }

    const runs = Number(matchData.runs || 0);
    const wickets = Number(matchData.wkts || 0);
    const overs = this.overText(matchData.balls || 0);
    const crr = Number(matchData.balls || 0) > 0 ? (runs / (Number(matchData.balls) / 6)).toFixed(2) : "0.00";
    const battingTeam = matchData.battingTeam || "-";
    const bowlingTeam = matchData.bowlingTeam || "-";
    const batTeamShort = this.teamShort(matchData, battingTeam);
    const bowlTeamShort = this.teamShort(matchData, bowlingTeam);

    const maxBalls = Number(matchData.totalOvers || 20) * 6;
    const remBalls = Math.max(maxBalls - Number(matchData.balls || 0), 0);
    const target = matchData.target ? Number(matchData.target) : null;
    const need = target ? Math.max(target - runs, 0) : null;
    const rrr = target ? (remBalls > 0 ? ((need * 6) / remBalls).toFixed(2) : (need > 0 ? "INF" : "0.00")) : "-";

    const teamA = (matchData.inningNumber || 1) === 1 ? battingTeam : bowlingTeam;
    const teamB = (matchData.inningNumber || 1) === 1 ? bowlingTeam : battingTeam;
    const teamAShort = this.teamShort(matchData, teamA);
    const teamBShort = this.teamShort(matchData, teamB);
    const leftTeam = isViewingCompleted ? teamA : battingTeam;
    const rightTeam = isViewingCompleted ? teamB : bowlingTeam;
    const leftShort = this.teamShort(matchData, leftTeam);
    const rightShort = this.teamShort(matchData, rightTeam);

    if (isViewingCompleted) {
      document.getElementById("matchTitle").innerHTML = `<button onclick="app.backToLive()" style="background:none;border:none;color:#0b63d8;cursor:pointer;font-size:16px;">← Back to Live</button> | ${this.safe(matchData.title || "Completed Match")}`;
    } else {
      document.getElementById("matchTitle").innerText = `${matchData.matchTitle || "Live Match"} > ${MATCH_ID}`;
    }
    document.getElementById("teamA").innerText = leftShort;
    document.getElementById("teamB").innerText = rightShort;
    document.getElementById("logo1").innerHTML = this.logoHtml(matchData, leftTeam);
    document.getElementById("logo2").innerHTML = this.logoHtml(matchData, rightTeam);
    document.getElementById("teamTabA").innerText = teamA;
    document.getElementById("teamTabB").innerText = teamB;
    document.getElementById("batScoreHeading").innerText = `${this.scorecardView === 'teamA' ? teamA : teamB} Batting Scoreboard`;

    const firstHeaderScore = this.inningsScoreText(matchData, teamA, matchData.firstInnings);
    const secondHeaderScore = this.inningsScoreText(matchData, teamB, matchData.secondInnings);
    document.getElementById("mainScore").innerHTML = isViewingCompleted
      ? `${this.safe(firstHeaderScore)}<br><small>1st innings</small>`
      : `${runs}/${wickets}<br><small>(${overs})</small>`;
    const firstInningsScore = (matchData.firstInningsScore !== null && matchData.firstInningsScore !== undefined)
      ? `${Number(matchData.firstInningsScore)}/${Number(matchData.firstInningsWkts || 0)}`
      : null;
    document.getElementById("teamBScore").innerHTML = isViewingCompleted && matchData.secondInnings
      ? `${this.safe(secondHeaderScore)}<br><small>2nd innings</small>`
      : (firstInningsScore || "Yet to bat");
    const strikerObj = (matchData.striker === 1 ? (matchData.bat1 || {}) : (matchData.bat2 || {}));
    const nonStrikerObj = (matchData.striker === 1 ? (matchData.bat2 || {}) : (matchData.bat1 || {}));
    const strikerName = strikerObj.name || "-";
    const nonStrikerName = nonStrikerObj.name || "-";
    const strikerRuns = Number(strikerObj.r || 0);
    const strikerBalls = Number(strikerObj.b || 0);
    const nonStrikerRuns = Number(nonStrikerObj.r || 0);
    const nonStrikerBalls = Number(nonStrikerObj.b || 0);
    const bowlerObj = matchData.bowler || {};
    const bowlerName = bowlerObj.name || "-";
    const bowlerMatchStats = (matchData.bowlerStats && bowlerName && matchData.bowlerStats[bowlerName]) ? matchData.bowlerStats[bowlerName] : null;
    const bowlerBalls = Number(bowlerMatchStats ? (bowlerMatchStats.balls || 0) : (bowlerObj.balls || 0));
    const bowlerOvers = this.overText(bowlerBalls);
    const thisOverBalls = matchData.over || [];
    const thisOverLine = thisOverBalls.length ? thisOverBalls.map((ball) => {
      const txt = String(ball);
      const isWicket = this.isWicketBall(txt);
      const isBoundary = txt === "4" || txt === "6";
      const cls = isWicket ? "wicket" : (isBoundary ? "boundary" : "");
      const display = isWicket ? "W" : (txt.length > 2 ? txt.slice(0,2) : txt);
      return `<span class="ball-dot ${cls}">${display}</span>`;
    }).join("") : `<span class="ball-dot">-</span>`;
    document.getElementById("battingInfo").innerHTML = `<span class="batter-line striker-line">${this.safe(strikerName)} (${strikerRuns}/${strikerBalls}) <span class="strike-mark">🏏</span></span><span class="batter-line">${this.safe(nonStrikerName)} (${nonStrikerRuns}/${nonStrikerBalls})</span>`;
    document.getElementById("bowlingInfo").innerHTML = `${this.safe(bowlerName)} (${bowlerOvers})<br>Last: ${this.safe(matchData.lastOverBowler || "-")}<br>This Over:<div class="mini-over">${thisOverLine}</div>`;
    const overRows = [];
    if(thisOverBalls.length){
      const currentNo = Math.floor(Number(matchData.balls || 0) / 6) + 1;
      overRows.push(`<div class="over-row"><div class="bowler-line">Over ${currentNo} - ${this.safe(bowlerName)}</div><div class="mini-over">${thisOverLine}</div></div>`);
    }
    (matchData.overSummary || []).forEach((ov) => {
      const timeline = Array.isArray(ov.timeline) ? ov.timeline : [];
      const ballsHtml = timeline.map((ball) => {
        const txt = String(ball);
        const isWicket = this.isWicketBall(txt);
        const isBoundary = txt === "4" || txt === "6";
        const cls = isWicket ? "wicket" : (isBoundary ? "boundary" : "");
        const display = isWicket ? "W" : (txt.length > 2 ? txt.slice(0,2) : txt);
        return `<span class="ball-dot ${cls}">${display}</span>`;
      }).join("") || `<span class="ball-dot">-</span>`;
      overRows.push(`<div class="over-row"><div class="bowler-line">Over ${this.safe(ov.overNo || "-")}</div><div class="mini-over">${ballsHtml}</div></div>`);
    });
    document.getElementById("allOverStrip").innerHTML = overRows.length ? overRows.join("") : '<div class="over-row"><div class="bowler-line">Over: -</div><div class="mini-over"><span class="ball-dot">-</span></div></div>';
    const liveState = (matchData.liveControl && matchData.liveControl.mode) || "live";
    const tossEl = document.getElementById("tossText");
    const centerState = isViewingCompleted || matchData.matchFinished
      ? "result"
      : (m.scoringLocked ? "locked" : (liveState === "paused" ? "break" : (liveState === "delay" ? "delay" : "live")));
    tossEl.innerText = isViewingCompleted || matchData.matchFinished
      ? "Result"
      : (m.scoringLocked ? "Locked" : (liveState === "paused" ? "Break" : (liveState === "delay" ? "Delayed" : "Live")));
    tossEl.classList.remove("live", "delay", "break", "locked", "result", "pending", "ready");
    tossEl.classList.add(centerState);
    document.querySelector(".header")?.classList.toggle("compact-complete", !!(isViewingCompleted || matchData.matchFinished));
    const liveBadge = document.getElementById("liveBadgeText");
    const liveSub = liveBadge.closest(".sub");
    const statusPill = document.getElementById("statusPill");
    const isCompleteState = !!(isViewingCompleted || matchData.matchFinished);
    liveBadge.innerText = isCompleteState
      ? "Match Complete"
      : (m.scoringLocked ? "Scoring Locked" : (liveState === "paused" ? "Break" : (liveState === "delay" ? "Delayed" : "Live")));
    liveSub.classList.remove("live", "delay", "break");
    liveSub.classList.add(isCompleteState ? "break" : (liveState === "paused" ? "break" : (liveState === "delay" ? "delay" : "live")));
    statusPill.classList.toggle("locked", !!matchData.scoringLocked);

    const tossPending = !(matchData.tossText && matchData.tossText.trim() && matchData.tossText.toLowerCase() !== "toss pending");
    const matchMvp = this.manOfMatch(matchData);
    document.getElementById("liveInfo").innerText = matchData.matchFinished && matchData.winnerText
      ? `${matchData.winnerText}${matchMvp ? ` · Man of the Match: ${matchMvp.name}` : ""}`
      : `${tossPending ? `${batTeamShort} batting` : matchData.tossText} · CRR: ${crr}${target ? ` · Need ${need} from ${remBalls}` : ""}`;

    document.getElementById("overviewScore").innerText = `${runs}/${wickets} (${overs})`;
    document.getElementById("overviewToss").innerText = matchData.tossText || "-";
    document.getElementById("overviewCRR").innerText = crr;
    document.getElementById("overviewExtras").innerText = Number(matchData.extras || 0);
    document.getElementById("overviewLastWicket").innerText = matchData.lastWicket || "-";
    document.getElementById("quickTarget").innerText = target || "-";
    document.getElementById("quickNeed").innerText = (need == null ? "-" : need);
    document.getElementById("quickRRR").innerText = rrr;
    document.getElementById("quickPartnership").innerText = `${Number(matchData.partnershipRuns || 0)} (${Number(matchData.partnershipBalls || 0)})`;

    const mvpHtml = (matchData.matchFinished && matchMvp)
      ? `<div class="mvp-card"><span>Man of the Match</span><b>${this.safe(matchMvp.name)}</b><small>${this.safe(matchMvp.note || "best impact")}</small></div>`
      : "";
    const highlightsHtml = (matchData.highlights || []).length > 0
      ? matchData.highlights.slice(0, 8).map(h => `<div class="comment"><span class="ball">${this.safe(h.time || "")}</span> - ${this.safe(h.text || "")}</div>`).join("")
      : '<span style="color:#999;font-size:13px;">No highlights yet</span>';
    document.getElementById("highlightsList").innerHTML = mvpHtml + highlightsHtml;
    const activeTab = document.querySelector(".content.active")?.id || "overview";
    if(activeTab === "overview"){
      this.renderMatchesList();
      return;
    }

    const bat1 = matchData.bat1 || { name: "-", r: 0, b: 0, f: 0, s: 0 };
    const bat2 = matchData.bat2 || { name: "-", r: 0, b: 0, f: 0, s: 0 };
    const bowler = matchData.bowler || { name: "-", balls: 0, r: 0, w: 0 };
    const battingPlayers = (matchData && matchData.teams && typeof matchData.teams === 'object' && matchData.teams[battingTeam]) ? matchData.teams[battingTeam] : [];
    const bowlingPlayers = (matchData && matchData.teams && typeof matchData.teams === 'object' && matchData.teams[bowlingTeam]) ? matchData.teams[bowlingTeam] : [];

    const selectedTeam = this.scorecardView === "teamA" ? teamA : teamB;
    const isCurrentBatting = (this.scorecardView === "teamA" && (matchData.inningNumber || 1) === 1) || (this.scorecardView === "teamB" && (matchData.inningNumber || 1) === 2);
    const scorecard = (matchData && matchData.completedInnings && typeof matchData.completedInnings === 'object' && matchData.completedInnings[selectedTeam]) ? matchData.completedInnings[selectedTeam] : [];

    document.getElementById("batScoreHeading").innerText = `${selectedTeam} Batting Scoreboard`;
    document.getElementById("bowlScoreHeading").innerText = `${selectedTeam === battingTeam ? bowlingTeam : battingTeam} Bowling Scoreboard`;

    let battingRows = "";
    if (isCurrentBatting) {
      // Show all batsmen who batted: from battingScorecard + current batsmen
      const allBatsmen = Array.isArray(matchData.battingScorecard) ? [...matchData.battingScorecard] : [];
      if (bat1 && bat1.name && bat1.name !== "-") {
        const existing = allBatsmen.find(b => b.name === bat1.name);
        if (!existing) allBatsmen.push({...bat1, out: false});
      }
      if (bat2 && bat2.name && bat2.name !== "-") {
        const existing = allBatsmen.find(b => b.name === bat2.name);
        if (!existing) allBatsmen.push({...bat2, out: false});
      }
      battingRows = allBatsmen.length > 0
        ? allBatsmen.map(b => {
          const status = b.retired ? "<span style='color:#a16207;font-weight:700'>Retired</span>" : (b.out ? "" : "<span style='color:#1b5e20;font-weight:700'>*</span>");
          return `
            <tr>
              <td><b>${this.safe(b.name || "-")}</b> ${status}</td>
              <td>${Number(b.r || 0)}</td>
              <td>${Number(b.b || 0)}</td>
              <td>${Number(b.f || 0)}</td>
              <td>${Number(b.s || 0)}</td>
              <td>${this.sr(b)}</td>
            </tr>
          `;
        }).join("")
        : `<tr><td><b>No batsmen</b></td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>`;
    } else {
      // Show completed scorecard
      battingRows = scorecard.length > 0
        ? scorecard.map(b => {
          const status = b.retired ? "<span style='color:#a16207;font-weight:700'>Retired</span>" : (b.out ? "" : "<span style='color:#1b5e20;font-weight:700'>*</span>");
          return `
            <tr>
              <td><b>${this.safe(b.name || "-")}</b> ${status}</td>
              <td>${Number(b.r || 0)}</td>
              <td>${Number(b.b || 0)}</td>
              <td>${Number(b.f || 0)}</td>
              <td>${Number(b.s || 0)}</td>
              <td>${this.sr(b)}</td>
            </tr>
          `;
        }).join("")
        : `<tr><td><b>No batsmen</b></td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>`;
    }

    document.getElementById("battingTable").innerHTML = battingRows;

    // Show bowler stats for the selected team's bowling (opponent's bowling)
    const bowlerStats = isCurrentBatting ? (matchData.bowlerStats || {}) : (matchData.completedBowling && typeof matchData.completedBowling === 'object' && matchData.completedBowling[selectedTeam] ? matchData.completedBowling[selectedTeam] : {});
    const bowlerRows = bowlerStats && Object.keys(bowlerStats).length > 0
      ? Object.entries(bowlerStats).map(([name, s]) => `<tr><td><b>${this.safe(String(name))}</b></td><td>${this.overText(s.balls || 0)}</td><td>${Number(s.runs || 0)}</td><td>${Number(s.wkts || 0)}</td><td>${s.balls ? (Number(s.runs || 0)/(Number(s.balls || 0)/6)).toFixed(2) : "0.00"}</td></tr>`).join("")
      : `<tr><td><b>No bowling data</b></td><td>-</td><td>-</td><td>-</td><td>-</td></tr>`;
    document.getElementById("bowlingTable").innerHTML = bowlerRows;

    document.getElementById("commentaryList").innerHTML = (matchData.commentary || []).length > 0
      ? matchData.commentary.map(c => `<div class="comment"><span class="ball">${this.safe(c.ball)}</span> - ${this.safe(c.text)}</div>`).join("")
      : '<span style="color:#999;font-size:13px;">No commentary yet</span>';

    const maxMatchBalls = Math.max(1, Number(matchData.totalOvers || 20) * 6);
    const ballsLeft = Math.max(maxMatchBalls - Number(matchData.balls || 0), 0);
    const projected = Number(matchData.balls || 0) > 0 ? Math.round((runs / Number(matchData.balls || 1)) * maxMatchBalls) : runs;
    const inningsDetails = matchData && matchData.inningsDetails && typeof matchData.inningsDetails === "object" ? matchData.inningsDetails : null;
    const statBatsmen = inningsDetails
      ? Object.values(inningsDetails).flatMap(d => Array.isArray(d?.battingScorecard) ? d.battingScorecard : [])
      : (Array.isArray(matchData.battingScorecard) ? [...matchData.battingScorecard] : []);
    if(!inningsDetails){
      [bat1, bat2].forEach(b => {
        if(b && b.name && b.name !== "-" && !statBatsmen.some(x => x.name === b.name)) statBatsmen.push({...b, out:false});
      });
    }
    const totalFours = statBatsmen.reduce((sum, p) => sum + Number(p.f || 0), 0);
    const totalSixes = statBatsmen.reduce((sum, p) => sum + Number(p.s || 0), 0);
    const topBatter = statBatsmen.length ? [...statBatsmen].sort((a,b) => Number(b.r||0)-Number(a.r||0) || Number(b.s||0)-Number(a.s||0))[0] : null;
    const mergedBowling = {};
    if(inningsDetails){
      Object.values(inningsDetails).forEach(d => Object.entries(d?.bowlerStats || {}).forEach(([name,s]) => {
        if(!mergedBowling[name]) mergedBowling[name]={balls:0,runs:0,wkts:0};
        mergedBowling[name].balls += Number(s?.balls||0);
        mergedBowling[name].runs += Number(s?.runs||0);
        mergedBowling[name].wkts += Number(s?.wkts||0);
      }));
    } else {
      Object.assign(mergedBowling, matchData.bowlerStats || {});
    }
    const bestBowlerEntry = Object.entries(mergedBowling).sort((a,b) => Number(b[1]?.wkts||0)-Number(a[1]?.wkts||0) || Number(a[1]?.runs||0)-Number(b[1]?.runs||0))[0];
    const bestBowlerText = bestBowlerEntry ? `${bestBowlerEntry[0]} ${Number(bestBowlerEntry[1]?.wkts||0)}/${Number(bestBowlerEntry[1]?.runs||0)}` : "-";
    const impactRows = statBatsmen.length ? [...statBatsmen]
      .sort((a,b) => Number(b.r||0)-Number(a.r||0) || Number(b.b||0)-Number(a.b||0))
      .slice(0,5)
      .map(p => `<div class="comment"><b>${this.safe(p.name || "-")}</b><div class="muted">${Number(p.r||0)} runs, ${Number(p.b||0)} balls, ${Number(p.f||0)} fours, ${Number(p.s||0)} sixes, SR ${this.sr(p)}</div></div>`)
      .join("") : '<span style="color:#999;font-size:13px;">No batting data yet</span>';

    document.getElementById("statScoreFull").innerText = `${runs}/${wickets} (${overs})`;
    document.getElementById("statCRR2").innerText = crr;
    document.getElementById("statProjected").innerText = projected;
    document.getElementById("statBallsLeft").innerText = ballsLeft;
    document.getElementById("statTarget2").innerText = target || "-";
    document.getElementById("statNeed2").innerText = (need == null ? "-" : need);
    document.getElementById("statRRR2").innerText = rrr;
    document.getElementById("statExtras2").innerText = Number(matchData.extras || 0);
    document.getElementById("statFours").innerText = totalFours;
    document.getElementById("statSixes").innerText = totalSixes;
    document.getElementById("statTopBatter").innerText = topBatter ? `${topBatter.name} ${Number(topBatter.r||0)} (${Number(topBatter.b||0)})` : "-";
    document.getElementById("statBestBowler").innerText = bestBowlerText;
    document.getElementById("battingImpactList").innerHTML = impactRows;

    document.getElementById("statRuns").innerText = runs;
    document.getElementById("statWickets").innerText = wickets;
    document.getElementById("statOvers").innerText = overs;
    document.getElementById("statCRR").innerText = crr;
    document.getElementById("statExtras").innerText = Number(matchData.extras || 0);
    document.getElementById("statTarget").innerText = target || "-";
    document.getElementById("statNeed").innerText = (need == null ? "-" : need);
    document.getElementById("statExtras").innerText = Number(matchData.extras || 0);
    document.getElementById("statPartnership").innerText = `${Number(matchData.partnershipRuns || 0)} (${Number(matchData.partnershipBalls || 0)})`;
    document.getElementById("statLastWicket").innerText = matchData.lastWicket || "-";
    const fow = Array.isArray(matchData.fallOfWickets) ? matchData.fallOfWickets : [];
    document.getElementById("fowList").innerHTML = fow.length
      ? fow.map((x, i) => `<div class="comment"><span class="ball">${i + 1}</span> - ${this.safe(x)}</div>`).join("")
      : '<span style="color:#999;font-size:13px;">No wickets yet</span>';

    const teamAPlayers = (matchData.teams && matchData.teams[battingTeam]) ? matchData.teams[battingTeam] : [];
    const teamBPlayers = (matchData.teams && matchData.teams[bowlingTeam]) ? matchData.teams[bowlingTeam] : [];
    const teamAHtml = teamAPlayers.length
      ? `<div class="players-grid">${teamAPlayers.map(p => `<div class="player player-tile" onclick="app.showPlayerProfile(decodeURIComponent('${encodeURIComponent(battingTeam)}'),decodeURIComponent('${encodeURIComponent(p)}'))">${this.avatarHtml(matchData, battingTeam, p)}<div><b>${this.safe(p)}</b><div class="role">${batTeamShort}</div></div></div>`).join("")}</div>`
      : `<div class="players-grid"><div class="player player-tile empty"><div class="avatar">-</div><div><b>No players</b><div class="role">${batTeamShort}</div></div></div></div>`;
    const teamBHtml = teamBPlayers.length
      ? `<div class="players-grid">${teamBPlayers.map(p => `<div class="player player-tile" onclick="app.showPlayerProfile(decodeURIComponent('${encodeURIComponent(bowlingTeam)}'),decodeURIComponent('${encodeURIComponent(p)}'))">${this.avatarHtml(matchData, bowlingTeam, p)}<div><b>${this.safe(p)}</b><div class="role">${bowlTeamShort}</div></div></div>`).join("")}</div>`
      : `<div class="players-grid"><div class="player player-tile empty"><div class="avatar">-</div><div><b>No players</b><div class="role">${bowlTeamShort}</div></div></div></div>`;
    document.getElementById("playersList").innerHTML = `
      <h4 style="margin:4px 0 8px;">${batTeamShort} Players</h4>
      ${teamAHtml}
      <h4 style="margin:14px 0 8px;">${bowlTeamShort} Players</h4>
      ${teamBHtml}
    `;

    this.renderMatchesList();
    this.renderLeaguePanel();
    this.renderPlayerProfile();
    }catch(e){
      console.error(e);
      this.showNoLive("Live data format error. Please start match again from admin.");
    }
  }
};

window.app.init();



