import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const app_firebase = initializeApp(firebaseConfig);
const db = getFirestore(app_firebase);
const params = new URLSearchParams(location.search);
const MATCH_ID = (params.get("match") || "liveMatch1").trim();

window.app = {
  state: {},
  scorecardView: "teamA",
  selectedMatchIndex: undefined,
  selectedPlayer: null,

  init() {
    this.showNoLive("Connecting to live match...");
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
    setHtml("battingInfo", '<span class="strike-mark">*</span> -<br>-');
    setHtml("bowlingInfo", '-<br>Last: -<br>This Over: <span class="mini-over"><span class="ball-dot">-</span></span>');
    setHtml("allOverStrip", '<div class="over-row"><div class="bowler-line">Over: -</div><div class="mini-over"><span class="ball-dot">-</span></div></div>');
    this.renderMatchesList();
    this.renderLeaguePanel();
  },

  setupFirebase() {
    onSnapshot(doc(db, "matches", MATCH_ID), (snap) => {
      if (snap.exists()) {
        this.state = snap.data() || {};
        this.render();
      } else {
        this.showNoLive("No live match created yet");
      }
    }, (error) => {
      console.error("Firebase Error:", error);
      this.showNoLive("Unable to connect to live match");
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

  isWicketBall(value) {
    return /(^|\s)W(\d+)?(\s|\(|$)/.test(String(value || ""));
  },

  openTab(id, btn) {
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
  },

  switchScorecard(team, btn) {
    document.querySelectorAll('.team-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    this.scorecardView = team;
    this.render();
  },
  showMatchResult(index) {
    this.selectedMatchIndex = index;
    this.scorecardView = "teamA";
    this.render();
  },
  backToLive() {
    this.selectedMatchIndex = undefined;
    this.scorecardView = "teamA";
    this.render();
  },

  renderMatchesList() {
    const history = Array.isArray(this.state.completedMatches) ? this.state.completedMatches : [];
    const schedule = Array.isArray(this.state.league?.schedule) ? this.state.league.schedule : [];
    const countEl = document.getElementById("totalMatchesCount");
    const listEl = document.getElementById("matchesList");
    if(countEl) countEl.innerText = history.length;
    if(!listEl) return;
    const liveMatch = (this.state.liveStarted && !this.state.matchFinished) ? `<div class="match-group-title">Live</div><div class="match-result-card"><div class="match-result-title">${this.safe(this.state.matchTitle || "Live Match")}</div><div class="match-result-meta">${this.safe(this.state.battingTeam || "-")} batting · ${Number(this.state.runs||0)}/${Number(this.state.wkts||0)} (${this.overText(this.state.balls||0)})</div></div>` : "";
    const upcoming = schedule.filter(m => m.status !== "done").slice(0, 10).map(m => `<div class="match-result-card"><div class="match-result-title">${this.safe(m.teamA)} vs ${this.safe(m.teamB)}</div><div class="match-result-meta">${this.safe(m.stage || "League")} · ${this.safe(m.round || "")}${m.date?`<br>${this.safe(m.date)} ${this.safe(m.time||"")}`:""}${m.venue?` · ${this.safe(m.venue)}`:""}</div></div>`).join("");
    const completed = history.map((x, i) => `<div class="match-result-card ${i===this.selectedMatchIndex?'active':''}" onclick="app.showMatchResult(${i})"><div class="match-result-title">${this.safe(x.title || "Match")}</div><div class="match-result-meta">${this.safe(x.leagueStage || ("Match " + (history.length - i)))} · ${this.safe(x.winnerText || "-")}<br>${this.safe(x.firstInnings || "-")} ${x.secondInnings ? " / " + this.safe(x.secondInnings) : ""}</div></div>`).join("");
    listEl.innerHTML = `${liveMatch}${upcoming?`<div class="match-group-title">Upcoming</div>${upcoming}`:""}${completed?`<div class="match-group-title">Completed</div>${completed}`:""}${(!liveMatch&&!upcoming&&!completed)?'<span style="color:#999;font-size:13px;">No matches yet</span>':""}`;
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
    this.selectedPlayer={team,player};
    this.renderPlayerProfile();
  },
  renderPlayerProfile(){
    const box=document.getElementById("playerProfile");
    if(!box) return;
    const sel=this.selectedPlayer;
    if(!sel){ box.innerHTML=""; return; }
    const meta=this.playerMeta(this.state, sel.team, sel.player);
    const stats=this.state.tournamentStats?.players?.[sel.player] || {};
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
    document.getElementById("tossText").innerText = (matchData.matchFinished && matchData.winnerText) ? matchData.winnerText : (matchData.tossText || "-");
    const strikerObj = (matchData.striker === 1 ? (matchData.bat1 || {}) : (matchData.bat2 || {}));
    const nonStrikerObj = (matchData.striker === 1 ? (matchData.bat2 || {}) : (matchData.bat1 || {}));
    const strikerName = strikerObj.name || "-";
    const nonStrikerName = nonStrikerObj.name || "-";
    const strikerRuns = Number(strikerObj.r || 0);
    const strikerBalls = Number(strikerObj.b || 0);
    const nonStrikerRuns = Number(nonStrikerObj.r || 0);
    const nonStrikerBalls = Number(nonStrikerObj.b || 0);
    const bowlerObj = matchData.bowler || {};
    const bowlerBalls = Number(bowlerObj.balls || 0);
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
    document.getElementById("battingInfo").innerHTML = `<span class="strike-mark">*</span> ${this.safe(strikerName)} (${strikerRuns}/${strikerBalls})<br>${this.safe(nonStrikerName)} (${nonStrikerRuns}/${nonStrikerBalls})`;
    document.getElementById("bowlingInfo").innerHTML = `${this.safe(bowlerObj.name || "-")} (${bowlerOvers})<br>Last: ${this.safe(matchData.lastOverBowler || "-")}<br>This Over:<div class="mini-over">${thisOverLine}</div>`;
    const overRows = [];
    if(thisOverBalls.length){
      const currentNo = Math.floor(Number(matchData.balls || 0) / 6) + 1;
      overRows.push(`<div class="over-row"><div class="bowler-line">Over ${currentNo} - ${this.safe(bowlerObj.name || "-")}</div><div class="mini-over">${thisOverLine}</div></div>`);
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
    document.querySelector(".header")?.classList.toggle("compact-complete", !!(isViewingCompleted || matchData.matchFinished));
    const liveBadge = document.getElementById("liveBadgeText");
    const liveSub = liveBadge.closest(".sub");
    const statusPill = document.getElementById("statusPill");
    const isCompleteState = !!(isViewingCompleted || matchData.matchFinished);
    liveBadge.innerText = isCompleteState
      ? "Match Complete"
      : (m.scoringLocked ? "Scoring Locked" : (liveState === "paused" ? "Match Break" : (liveState === "delay" ? "Match Delayed" : "Live Match")));
    liveSub.classList.remove("live", "delay", "break");
    liveSub.classList.add(isCompleteState ? "break" : (liveState === "paused" ? "break" : (liveState === "delay" ? "delay" : "live")));
    statusPill.classList.toggle("locked", !!matchData.scoringLocked);

    const tossEl = document.getElementById("tossText");
    const tossPending = !(matchData.tossText && matchData.tossText.trim() && matchData.tossText.toLowerCase() !== "toss pending");
    tossEl.classList.remove("pending", "ready");
    tossEl.classList.add(tossPending ? "pending" : "ready");
    document.getElementById("liveInfo").innerText = matchData.matchFinished && matchData.winnerText
      ? matchData.winnerText
      : `${batTeamShort} batting · CRR: ${crr}${target ? ` · Need ${need} from ${remBalls}` : ""}`;

    document.getElementById("overviewScore").innerText = `${runs}/${wickets} (${overs})`;
    document.getElementById("overviewToss").innerText = matchData.tossText || "-";
    document.getElementById("overviewCRR").innerText = crr;
    document.getElementById("overviewExtras").innerText = Number(matchData.extras || 0);
    document.getElementById("overviewLastWicket").innerText = matchData.lastWicket || "-";
    document.getElementById("quickTarget").innerText = target || "-";
    document.getElementById("quickNeed").innerText = (need == null ? "-" : need);
    document.getElementById("quickRRR").innerText = rrr;
    document.getElementById("quickPartnership").innerText = `${Number(matchData.partnershipRuns || 0)} (${Number(matchData.partnershipBalls || 0)})`;

    document.getElementById("highlightsList").innerHTML = (matchData.highlights || []).length > 0
      ? matchData.highlights.slice(0, 8).map(h => `<div class="comment"><span class="ball">${this.safe(h.time || "")}</span> - ${this.safe(h.text || "")}</div>`).join("")
      : '<span style="color:#999;font-size:13px;">No highlights yet</span>';

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
      ? teamAPlayers.map(p => `<div class="player" onclick="app.showPlayerProfile(decodeURIComponent('${encodeURIComponent(battingTeam)}'),decodeURIComponent('${encodeURIComponent(p)}'))">${this.avatarHtml(matchData, battingTeam, p)}<div><b>${this.safe(p)}</b><div class="role">${batTeamShort}</div></div></div>`).join("")
      : `<div class="player"><div class="avatar">-</div><div><b>No players</b><div class="role">${batTeamShort}</div></div></div>`;
    const teamBHtml = teamBPlayers.length
      ? teamBPlayers.map(p => `<div class="player" onclick="app.showPlayerProfile(decodeURIComponent('${encodeURIComponent(bowlingTeam)}'),decodeURIComponent('${encodeURIComponent(p)}'))">${this.avatarHtml(matchData, bowlingTeam, p)}<div><b>${this.safe(p)}</b><div class="role">${bowlTeamShort}</div></div></div>`).join("")
      : `<div class="player"><div class="avatar">-</div><div><b>No players</b><div class="role">${bowlTeamShort}</div></div></div>`;
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


