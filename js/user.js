import { listenLiveMatch, trackViewer } from "./firebase-live.js";
import { listenMatch, listenCompletedMatches, getLatestPublicMatch } from "./firebase-store.js";
import { mergeMatch, overText, calcSR, calcER, normalizeState } from "./live-sync.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let MATCH_ID = (params.get("match") || "").trim();
let USER_MATCH_BACKUP_KEY = `cricket_user_match_backup_${MATCH_ID || "latest"}`;

window.app = {
  live: null,
  store: null,
  state: normalizeState({}),
  completed: [],
  scoreTeam: "teamA",
  viewerId: crypto?.randomUUID?.() || `viewer_${Date.now()}`,

  init() {
    document.querySelectorAll(".tab").forEach(b => b.onclick = () => this.openTab(b.dataset.tab, b));
    $("scoreTab1").onclick = () => { this.scoreTeam = "teamA"; this.render(); };
    $("scoreTab2").onclick = () => { this.scoreTeam = "teamB"; this.render(); };
    $("followBtn").onclick = () => this.follow();
    $("modalClose").onclick = () => this.closeModal();
    this.bootstrap();
  },

  async bootstrap() {
    if (!MATCH_ID) {
      this.noMatch("Loading...");
      try {
        const latest = await getLatestPublicMatch();
        if (!latest?.matchId) return this.noMatch("Match Data Not Found.");
        MATCH_ID = latest.matchId;
        USER_MATCH_BACKUP_KEY = `cricket_user_match_backup_${MATCH_ID}`;
        this.store = latest;
        history.replaceState(null, "", `user.html?match=${encodeURIComponent(MATCH_ID)}`);
      } catch (error) {
        console.error(error);
        return this.noMatch("Match Not Found" + error.message);
      }
    }
    this.connect();
    if (this.store) this.publish();
  },

  connect() {
    listenLiveMatch(MATCH_ID, live => { this.live = live; this.publish(); }, e => this.noMatch("Realtime error: " + e.message));
    listenMatch(MATCH_ID, store => { this.store = store; this.publish(); }, e => this.noMatch("Firestore error: " + e.message));
    listenCompletedMatches(rows => { this.completed = rows; this.renderMatches(); }, () => {});
    trackViewer(MATCH_ID, this.viewerId, count => { this.state.onlineViewers = count; $("viewerCount").textContent = count; });
  },

  publish() {
    this.state = mergeMatch(this.live, this.store, this.state);
    if (!this.hasData(this.state)) return this.noMatch("Waiting for admin data...");
    this.render();
  },

  hasData(m) { return !!(m?.matchId || m?.matchTitle || m?.liveStarted || m?.matchFinished || Number(m?.runs || 0) || Number(m?.balls || 0)); },
  noMatch(msg) { $("matchTitle").textContent = "Live Cricket"; $("liveInfo").textContent = msg; },
  openTab(id, btn) { document.querySelectorAll(".content").forEach(c => c.classList.remove("active")); document.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); $(id).classList.add("active"); btn.classList.add("active"); this.render(); },
  follow() { const link = this.state.followLink || location.href; if (this.state.followLink) window.open(link, "_blank"); else navigator.clipboard?.writeText(link); $("followBtn").textContent = "Following"; },

  render() {
    const m = normalizeState(this.state);
    const first = m.inningNumber === 1 ? m.battingTeam : (m.teamA || m.bowlingTeam);
    const second = m.inningNumber === 1 ? m.bowlingTeam : m.battingTeam;
    $("matchTitle").textContent = m.matchTitle || "Live Match";
    $("teamA").textContent = this.teamShort(first);
    $("teamB").textContent = this.teamShort(second);
    $("logoA").innerHTML = this.logo(first);
    $("logoB").innerHTML = this.logo(second);
    const firstScore = this.inningsScore(m, first?.name);
    const secondScore = this.inningsScore(m, second?.name);
    $("scoreA").innerHTML = m.inningNumber === 1 && !m.matchFinished ? `${m.runs}/${m.wkts}<small>(${overText(m.balls)})</small>` : `${this.safe(firstScore || m.firstInnings || "-")}<small>1st innings</small>`;
    $("scoreB").innerHTML = m.inningNumber === 2 || m.matchFinished ? `${this.safe(secondScore || m.secondInnings || `${m.runs}/${m.wkts} (${overText(m.balls)})`)}<small>2nd innings</small>` : "Yet to bat";
    const mode = m.matchFinished ? "result" : (m.scoringLocked ? "locked" : (m.liveControl?.mode === "delay" ? "delay" : (m.liveControl?.mode === "paused" ? "break" : "live")));
    $("centerStatus").className = `center ${mode}`;
    $("centerStatus").textContent = m.matchFinished ? "Result" : (m.scoringLocked ? "Locked" : (m.liveControl?.mode === "paused" ? "Break" : (m.liveControl?.mode === "delay" ? "Delay" : "Live")));
    const crr = m.balls ? (m.runs / (m.balls / 6)).toFixed(2) : "0.00";
    const remBalls = Math.max(Number(m.totalOvers || 20) * 6 - m.balls, 0);
    const need = m.target ? Math.max(m.target - m.runs, 0) : null;
    const rrr = need == null ? "-" : (remBalls ? ((need * 6) / remBalls).toFixed(2) : "0.00");
    $("liveInfo").textContent = m.matchFinished ? `${m.winnerText || "Match Complete"}${m.playerOfMatch ? " · Player of Match: " + m.playerOfMatch : ""}` : `${m.tossText || "Live"} · CRR ${crr}${need != null ? ` · Need ${need} from ${remBalls}` : ""}`;
    const striker = m.striker === 1 ? m.bat1 : m.bat2;
    const non = m.striker === 1 ? m.bat2 : m.bat1;
    $("battingInfo").innerHTML = `<b>${this.safe(striker.name)}</b> ${striker.r}/${striker.b} 🏏<br>${this.safe(non.name)} ${non.r}/${non.b}`;
    $("bowlingInfo").innerHTML = `<b>${this.safe(m.bowler.name)}</b> ${overText(m.bowler.balls)}-${m.bowler.r}-${m.bowler.w}<br>Last: ${this.safe(m.lastOverBowler || "-")}`;
    this.renderOvers(m);
    $("overviewScore").textContent = `${m.runs}/${m.wkts} (${overText(m.balls)})`;
    $("overviewToss").textContent = m.tossText || "-"; $("overviewCRR").textContent = crr; $("overviewExtras").textContent = m.extras; $("overviewLastWicket").textContent = m.lastWicket || "-";
    $("target").textContent = m.target || "-"; $("need").textContent = need ?? "-"; $("rrr").textContent = rrr; $("partnership").textContent = `${m.partnershipRuns} (${m.partnershipBalls})`;
    $("highlights").innerHTML = (m.highlights || []).length ? m.highlights.map(h => `<div class="comment"><b>${this.safe(h.time || "")}</b> ${this.safe(h.text)}</div>`).join("") : "<span class='muted'>No highlights yet</span>";
    this.renderScorecard(m); this.renderCommentary(m); this.renderStats(m); this.renderPlayers(m); this.renderMatches(); this.renderLeague(m);
  },

  renderOvers(m) {
    const current = m.over?.length ? `<div class="over-row">Current ${m.over.map(x => `<span class="ball ${this.ballClass(x)}">${this.safe(String(x).slice(0,3))}</span>`).join("")}</div>` : "";
    const done = (m.overSummary || []).map(o => `<div class="over-row">Over ${o.overNo} ${o.timeline.map(x => `<span class="ball ${this.ballClass(x)}">${this.safe(String(x).slice(0,3))}</span>`).join("")}</div>`).join("");
    $("overStrip").innerHTML = current + done || `<div class="over-row">Over - <span class="ball">-</span></div>`;
  },

  renderScorecard(m) {
    const teams = [m.teamA?.name || m.battingTeam?.name || "Team A", m.teamB?.name || m.bowlingTeam?.name || "Team B"];
    $("scoreTab1").textContent = teams[0]; $("scoreTab2").textContent = teams[1];
    $("scoreTab1").classList.toggle("active", this.scoreTeam === "teamA"); $("scoreTab2").classList.toggle("active", this.scoreTeam === "teamB");
    const team = this.scoreTeam === "teamA" ? teams[0] : teams[1];
    const detail = m.inningsDetails?.[team];
    let batting = detail?.battingScorecard || [];
    if (!detail && m.battingTeam?.name === team) batting = this.currentBattingRows(m);
    const bowling = detail?.bowlerStats || (m.battingTeam?.name === team ? m.bowlerStats : {});
    $("scorecardBody").innerHTML = `<div class="card"><h3>${this.safe(team)} Batting</h3><table><thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${batting.length ? batting.map(b => `<tr><td><b>${this.safe(b.name)}</b> ${b.out ? "" : "*"}<br><small>${this.safe(b.dismissal || "")}</small></td><td>${b.r||0}</td><td>${b.b||0}</td><td>${b.f||0}</td><td>${b.s||0}</td><td>${calcSR(b.r,b.b)}</td></tr>`).join("") : `<tr><td colspan="6">No batting data</td></tr>`}</tbody></table></div><div class="card"><h3>Bowling</h3><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>ER</th></tr></thead><tbody>${Object.keys(bowling).length ? Object.entries(bowling).map(([name,s]) => `<tr><td><b>${this.safe(name)}</b></td><td>${overText(s.balls||0)}</td><td>${s.runs||0}</td><td>${s.wkts||0}</td><td>${calcER(s.runs,s.balls)}</td></tr>`).join("") : `<tr><td colspan="5">No bowling data</td></tr>`}</tbody></table></div>`;
  },

  currentBattingRows(m) { const rows = [...(m.battingScorecard || [])]; [m.bat1, m.bat2].forEach(b => { if (b?.name && b.name !== "-" && !rows.some(x => x.name === b.name)) rows.push(b); }); return rows; },
  renderCommentary(m) { $("commentaryList").innerHTML = (m.commentary || []).length ? m.commentary.map(c => `<div class="comment"><b>${this.safe(c.ball)}</b> ${this.safe(c.text)}</div>`).join("") : "<span class='muted'>No commentary</span>"; },
  renderStats(m) { const rows = this.allBatters(m); const fours = rows.reduce((a,b)=>a+Number(b.f||0),0), sixes=rows.reduce((a,b)=>a+Number(b.s||0),0); const top=[...rows].sort((a,b)=>Number(b.r||0)-Number(a.r||0))[0]; const bowl={}; Object.values(m.inningsDetails||{}).forEach(i=>Object.entries(i.bowlerStats||{}).forEach(([n,s])=>{bowl[n]=bowl[n]||{runs:0,balls:0,wkts:0}; bowl[n].runs+=Number(s.runs||0); bowl[n].balls+=Number(s.balls||0); bowl[n].wkts+=Number(s.wkts||0);})); if(!Object.keys(bowl).length) Object.assign(bowl,m.bowlerStats||{}); const best=Object.entries(bowl).sort((a,b)=>Number(b[1].wkts||0)-Number(a[1].wkts||0))[0]; $("statRuns").textContent=m.runs;$("statWkts").textContent=m.wkts;$("statOvers").textContent=overText(m.balls);$("statProjected").textContent=m.balls?Math.round(m.runs/(m.balls/(m.totalOvers*6))):0;$("statFours").textContent=fours;$("statSixes").textContent=sixes;$("statTopBatter").textContent=top?`${top.name} ${top.r}`:"-";$("statBestBowler").textContent=best?`${best[0]} ${best[1].wkts}/${best[1].runs}`:"-";$("fowList").innerHTML=(m.fallOfWickets||[]).length?m.fallOfWickets.map((x,i)=>`<div class="comment">${i+1}. ${this.safe(x)}</div>`).join(""):"<span class='muted'>No wickets</span>"; },
  allBatters(m) { const out=[]; Object.values(m.inningsDetails||{}).forEach(i=>out.push(...(i.battingScorecard||[]))); if(!out.length) out.push(...this.currentBattingRows(m)); return out; },
  renderPlayers(m) { const blocks=[]; Object.entries(m.teams||{}).forEach(([team,players]) => (players||[]).forEach(p => { const meta=m.teamInfo?.[team]?.players?.[p]||{}; blocks.push(`<div class="player" onclick="app.playerModal('${encodeURIComponent(team)}','${encodeURIComponent(p)}')"><div class="avatar">${meta.image?`<img src="${this.safe(meta.image)}">`:this.short(p).slice(0,2)}</div><b>${this.safe(p)}</b><br><small>${this.safe(team)}</small></div>`); })); $("playersList").innerHTML = blocks.join("") || "<span class='muted'>No players</span>"; },
  renderMatches() { const current = this.state?.matchId ? `<div class="match-card-mini"><b>${this.safe(this.state.matchTitle)}</b><br><small>Current · ${this.state.runs}/${this.state.wkts} (${overText(this.state.balls)})</small></div>` : ""; const history = this.completed.map(m => `<div class="match-card-mini" onclick="location.href='user.html?match=${m.matchId}'"><b>${this.safe(m.matchTitle||m.title||'Match')}</b><br><small>${this.safe(m.winnerText||'')}<br>${this.safe(m.firstInnings||'')} ${m.secondInnings?' | '+this.safe(m.secondInnings):''}</small></div>`).join(""); $("matchesList").innerHTML = current + history || "<span class='muted'>No matches</span>"; },
  renderLeague(m) { const l=m.league||{}; const schedule=Array.isArray(l.schedule)?l.schedule:[]; const teams=Array.isArray(l.teams)?l.teams:[]; $("leagueTitle").textContent=l.name||"League";$("leagueTeams").textContent=teams.length;$("leagueMatches").textContent=schedule.length;$("leagueDone").textContent=schedule.filter(x=>x.status==='completed'||x.status==='done').length;$("leaguePending").textContent=schedule.filter(x=>!(x.status==='completed'||x.status==='done')).length; const pts=m.pointsTable||l.pointsTable||{}; $("pointsTable").innerHTML=Object.entries(pts).map(([t,p])=>`<tr><td>${this.safe(t)}</td><td>${p.P||0}</td><td>${p.W||0}</td><td>${p.L||0}</td><td>${p.T||0}</td><td>${p.Pts||0}</td><td>${this.nrr(p)}</td></tr>`).join("")||`<tr><td colspan="7">No points</td></tr>`; $("leagueSchedule").innerHTML=schedule.map(x=>`<div class="match-card-mini"><b>${this.safe(x.teamA?.name||x.teamA)} vs ${this.safe(x.teamB?.name||x.teamB)}</b><br><small>${this.safe(x.stage||'League')} · ${this.safe(x.status||'pending')}</small></div>`).join("")||"<span class='muted'>No schedule</span>"; },
  playerModal(teamEnc, playerEnc) {
    const team = decodeURIComponent(teamEnc);
    const player = decodeURIComponent(playerEnc);
    const stats = this.playerStats(player);
    $("modalBody").innerHTML = `
      <h2>${this.safe(player)}</h2>
      <p>${this.safe(team)}</p>
      <div class="quick-grid">
        <div><span>Matches</span><b>${stats.matches}</b></div>
        <div><span>Runs</span><b>${stats.runs}</b></div>
        <div><span>Balls</span><b>${stats.balls}</b></div>
        <div><span>Dots</span><b>${stats.dots}</b></div>
        <div><span>4s</span><b>${stats.fours}</b></div>
        <div><span>6s</span><b>${stats.sixes}</b></div>
        <div><span>Wickets</span><b>${stats.wkts}</b></div>
      </div>
    `;
    $("modal").classList.add("show");
  },
  closeModal() { $("modal").classList.remove("show"); },
  playerStats(player) {
    const s = { runs: 0, balls: 0, dots: 0, fours: 0, sixes: 0, wkts: 0, matches: 0, innings: 0 };
    const counted = new Set();
    const addMatch = (matchId) => {
      if (matchId && !counted.has(matchId)) {
        counted.add(matchId);
        s.matches += 1;
      }
    };
    const addBatter = (bat) => {
      if (!bat || bat.name !== player) return;
      s.innings += 1;
      s.runs += Number(bat.r || 0);
      s.balls += Number(bat.b || 0);
      s.dots += Number(bat.dots || bat.d || 0);
      s.fours += Number(bat.f || 0);
      s.sixes += Number(bat.s || 0);
    };
    const addBowler = (name, stat) => {
      if (!name || name !== player || !stat) return;
      s.wkts += Number(stat.wkts || stat.w || 0);
    };
    const collectMatch = (match) => {
      const matchId = match.matchId || match.id || `live-${Math.random()}`;
      let seen = false;
      const addInnings = (inn) => {
        if (!inn) return;
        (inn.battingScorecard || []).forEach(bat => {
          if (bat?.name === player) {
            addBatter(bat);
            seen = true;
          }
        });
        if (inn.bowlerStats) {
          Object.entries(inn.bowlerStats).forEach(([name, stat]) => {
            if (name === player) {
              addBowler(name, stat);
              seen = true;
            }
          });
        }
      };
      const scorecard = match.fullScorecardData || match.scorecard || {};
      Object.values(match.inningsDetails || {}).forEach(addInnings);
      Object.values(scorecard.inningsDetails || {}).forEach(addInnings);
      const completed = scorecard.completedInnings || match.completedInnings || {};
      if (Array.isArray(completed)) completed.forEach(addInnings);
      else Object.values(completed || {}).forEach(addInnings);
      if (scorecard.battingScorecard) addInnings({ battingScorecard: scorecard.battingScorecard });
      if (match.battingScorecard) addInnings({ battingScorecard: match.battingScorecard });
      if (scorecard.bowlerStats) Object.entries(scorecard.bowlerStats).forEach(addBowler);
      if (match.bowlerStats) Object.entries(match.bowlerStats).forEach(addBowler);
      if (match.bowler?.name === player) {
        addBowler(match.bowler.name, match.bowler);
        seen = true;
      }
      if (seen) addMatch(matchId);
    };
    collectMatch(this.state);
    (this.completed || []).forEach(collectMatch);
    return s;
  },
  inningsScore(m, team) { const d = m.inningsDetails?.[team]; return d ? `${d.runs}/${d.wkts} (${d.overs || overText(d.balls)})` : ""; },
  logo(team){ return team?.logo ? `<img src="${this.safe(team.logo)}">` : this.safe(team?.shortName || this.short(team?.name)); },
  teamShort(t){ return t?.shortName || this.short(t?.name || t || "-"); },
  short(x){ return String(x||'-').split(/\s+/).map(v=>v[0]).join('').slice(0,3).toUpperCase(); },
  safe(v){return String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));},
  ballClass(x){const t=String(x);return /^W(?!d)/i.test(t)?'wicket':(t==='4'?'four':(t==='6'?'six':''));},
  nrr(p){const rf=p?.BF?p.RF/(p.BF/6):0,ra=p?.BA?p.RA/(p.BA/6):0;return (rf-ra).toFixed(3);}
};

window.app.init();
