import { listenLiveMatch, trackViewer } from "./firebase-live.js";
import { listenMatch, listenCompletedMatches, getLatestPublicMatch, getPlayerCareerStats, listenPublicSettings } from "./firebase-store.js";
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
  publicSettings: {},
  scoreTeam: "teamA",
  scheduleFilter: "all",
  unsubs: [],
  viewerId: crypto?.randomUUID?.() || `viewer_${Date.now()}`,

  init() {
    document.querySelectorAll(".tab").forEach(b => b.onclick = () => this.openTab(b.dataset.tab, b));
    $("scoreTab1").onclick = () => { this.scoreTeam = "teamA"; this.render(); };
    $("scoreTab2").onclick = () => { this.scoreTeam = "teamB"; this.render(); };
    $("followBtn").onclick = () => this.follow();
    $("modalClose").onclick = () => this.closeModal();
    $("retryBtn").onclick = () => this.retry();
    document.querySelectorAll("[data-schedule-filter]").forEach(b => b.onclick = () => this.setScheduleFilter(b.dataset.scheduleFilter));
    this.bootstrap();
  },

  async bootstrap() {
    this.showState("Loading Match", "Fetching the latest match data...");
    this.loadBackup();
    if (!MATCH_ID) {
      this.waiting("Searching for the latest match...");
      try {
        const latest = await getLatestPublicMatch();
        if (!latest?.matchId) return this.noMatch("No Records Found");
        MATCH_ID = latest.matchId;
        USER_MATCH_BACKUP_KEY = `cricket_user_match_backup_${MATCH_ID}`;
        this.store = latest;
        history.replaceState(null, "", `user.html?match=${encodeURIComponent(MATCH_ID)}`);
      } catch (error) {
        console.error(error);
        return this.noMatch("Network Error. Please try again.");
      }
    }
    this.connect();
    if (this.store) this.publish();
  },

  connect() {
    this.unsubs.forEach(fn => { try { fn?.(); } catch (_) {} });
    this.unsubs = [];
    this.unsubs.push(listenLiveMatch(MATCH_ID, live => { this.live = live; this.publish(); }, e => this.noMatch("Unable to load live data. Please try again.")));
    this.unsubs.push(listenMatch(MATCH_ID, store => { this.store = store; this.publish(); }, e => this.noMatch("Unable to load match data. Please try again.")));
    this.unsubs.push(listenCompletedMatches(rows => { this.completed = rows; this.renderMatches(); }, () => {}));
    this.unsubs.push(listenPublicSettings(settings => { this.publicSettings = settings || {}; this.render(); }, () => {}));
    this.unsubs.push(trackViewer(MATCH_ID, this.viewerId, count => { this.state.onlineViewers = count; $("viewerCount").textContent = count; }));
  },

  publish() {
    this.state = mergeMatch(this.live, this.store, this.state);
    if (!this.hasData(this.state)) return this.waiting("Waiting for admin data...");
    this.saveBackup();
    this.hideState();
    this.updateShareMeta(this.state);
    this.render();
  },

  hasData(m) { return !!(m?.matchId || m?.matchTitle || m?.liveStarted || m?.matchFinished || Number(m?.runs || 0) || Number(m?.balls || 0)); },
  waiting(msg) {
    $("liveInfo").textContent = msg;
    if (!this.offlineBackupLoaded) this.showState("Loading Match", msg, "loading");
  },
  noMatch(msg) {
    if (!this.offlineBackupLoaded) $("matchTitle").textContent = "Live Cricket";
    $("liveInfo").textContent = this.offlineBackupLoaded ? `${msg} Showing the last saved score.` : msg;
    if (!this.offlineBackupLoaded) this.showState("Match Unavailable", msg, "error");
  },
  showState(title, text, type = "loading") {
    $("pageStateTitle").textContent = title;
    $("pageStateText").textContent = text;
    $("pageState").className = `page-state ${type}`;
  },
  hideState() { $("pageState").classList.add("hidden"); },
  retry() { this.showState("Retrying", "Refreshing match data..."); this.connect(); if (this.store || this.live) this.publish(); },
  saveBackup() { try { if (this.hasData(this.state)) localStorage.setItem(USER_MATCH_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), state: this.state })); } catch (_) {} },
  loadBackup() { try { const saved = JSON.parse(localStorage.getItem(USER_MATCH_BACKUP_KEY) || "{}"); if (saved?.state && this.hasData(saved.state)) { this.offlineBackupLoaded = true; this.state = normalizeState(saved.state); this.render(); this.hideState(); $("liveInfo").textContent = "Showing the last saved score. Live updates will resume automatically."; } } catch (_) {} },
  openTab(id, btn) {
    if (btn?.classList.contains("hidden")) { id = "overview"; btn = document.querySelector('[data-tab="overview"]'); }
    document.querySelectorAll(".content").forEach(c => c.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    $(id).classList.add("active");
    btn.classList.add("active");
    this.render();
  },
  updateLeagueVisibility(m) {
    const displaySetting = m.showPublicLeague ?? m.league?.showPublicLeague ?? this.publicSettings?.showPublicLeague;
    const show = displaySetting !== false;
    ["league", "points"].forEach(id => {
      document.querySelector(`[data-tab="${id}"]`)?.classList.toggle("hidden", !show);
      $(id)?.classList.toggle("hidden", !show);
    });
    const active = document.querySelector(".content.active");
    if (!show && (active?.id === "league" || active?.id === "points")) {
      active.classList.remove("active");
      $("overview")?.classList.add("active");
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelector('[data-tab="overview"]')?.classList.add("active");
    }
  },
  follow() {
    const link = this.state.followLink || location.href;
    if (this.state.followLink) {
      window.open(link, "_blank");
      $("followBtn").textContent = "Opened";
      return;
    }
    navigator.clipboard?.writeText(link).then(() => {
      $("followBtn").textContent = "Link Copied";
      $("liveInfo").textContent = "Match link copied to clipboard.";
    }).catch(() => prompt("Copy match link", link));
  },
  setScheduleFilter(filter) { this.scheduleFilter = filter || "all"; document.querySelectorAll("[data-schedule-filter]").forEach(b => b.classList.toggle("active", b.dataset.scheduleFilter === this.scheduleFilter)); this.renderLeague(this.state); },
  updateShareMeta(m) {
    const title = `${m.matchTitle || "Live Cricket Score"}${m.matchFinished ? " - Result" : m.liveStarted ? " - Live" : ""}`;
    const score = `${m.battingTeam?.name || ""} ${m.runs ?? 0}/${m.wkts ?? 0} (${overText(m.balls || 0)})`;
    const desc = m.matchFinished ? (m.winnerText || score) : score;
    document.title = title;
    this.setMeta("description", desc);
    this.setMeta("og:title", title, "property");
    this.setMeta("og:description", desc, "property");
  },
  setMeta(name, content, attr = "name") {
    let tag = document.querySelector(`meta[${attr}="${name}"]`);
    if (!tag) { tag = document.createElement("meta"); tag.setAttribute(attr, name); document.head.appendChild(tag); }
    tag.setAttribute("content", content || "");
  },

  render() {
    const m = normalizeState(this.state);
    this.updateLeagueVisibility(m);
    document.body.classList.toggle("live-glow", !!(m.liveStarted && !m.matchFinished && !m.scoringLocked));
    const order = this.battingFirstOrder(m);
    const first = order.first;
    const second = order.second;
    $("matchTitle").textContent = m.matchTitle || "Live Match";
    $("teamA").textContent = this.teamShort(first);
    $("teamB").textContent = this.teamShort(second);
    $("logoA").innerHTML = this.logo(first);
    $("logoB").innerHTML = this.logo(second);
    const firstScore = this.inningsScore(m, first?.name);
    const secondScore = this.inningsScore(m, second?.name);
    const firstLive = first?.name && first.name === m.battingTeam?.name && !m.matchFinished;
    const secondLive = second?.name && second.name === m.battingTeam?.name && !m.matchFinished;
    const firstSaved = this.splitScoreOver(firstScore || this.savedInningsText(m, first?.name));
    const secondSaved = this.splitScoreOver(secondScore || this.savedInningsText(m, second?.name));
    const firstText = firstLive ? `${m.runs}/${m.wkts}` : this.safe(firstSaved.score || "-");
    const firstMeta = firstLive ? `(${overText(m.balls)})` : "";
    const secondText = secondLive ? `${m.runs}/${m.wkts}` : this.safe(secondSaved.score || "Yet to bat");
    const secondMeta = secondLive ? `(${overText(m.balls)})` : "";
    $("scoreA").innerHTML = `<span class="score-main">${firstText}</span>${firstMeta || firstSaved.over ? `<small>${this.safe(firstMeta || firstSaved.over)}</small>` : ""}`;
    $("scoreB").innerHTML = `<span class="score-main">${secondText}</span>${secondMeta || secondSaved.over ? `<small>${this.safe(secondMeta || secondSaved.over)}</small>` : ""}`;
    const teamCards = document.querySelectorAll(".match-card .team");
    teamCards[0]?.classList.toggle("batting-now", firstLive);
    teamCards[1]?.classList.toggle("batting-now", secondLive);
    const publicMode = m.liveControl?.mode || "";
    const mode = m.matchFinished ? "result" : (publicMode === "time" ? "time" : (publicMode === "delay" ? "delay" : (publicMode === "paused" ? "break" : (m.scoringLocked ? "break" : "live"))));
    $("centerStatus").className = `center ${mode}`;
    $("centerStatus").textContent = m.matchFinished ? "Result" : (publicMode === "time" ? this.formatTime(m.liveControl.displayTime) : (publicMode === "delay" ? "Delay" : (publicMode === "paused" || m.scoringLocked ? "Break" : "Live")));
    const crr = m.balls ? (m.runs / (m.balls / 6)).toFixed(2) : "0.00";
    const remBalls = Math.max(Number(m.totalOvers || 20) * 6 - m.balls, 0);
    const need = m.target ? Math.max(m.target - m.runs, 0) : null;
    const rrr = need == null ? "-" : (remBalls ? ((need * 6) / remBalls).toFixed(2) : "0.00");
    $("liveInfo").textContent = m.matchFinished ? `${m.winnerText || "Match Complete"}${m.playerOfMatch ? " · Player of Match: " + m.playerOfMatch : ""}` : (m.liveControl?.mode === "time" ? `Scheduled time: ${this.formatTime(m.liveControl.displayTime)}` : `${m.tossText || "Live"} · CRR ${crr}${need != null ? ` · Need ${need} from ${remBalls}` : ""}`);
    document.querySelector(".details")?.classList.toggle("hidden", !!m.matchFinished);
    const isScheduled = String(m.status || "").toLowerCase() === "scheduled" && !m.liveStarted;
    if (m.matchFinished) {
      $("battingInfo").innerHTML = "";
      $("bowlingInfo").innerHTML = "";
    } else if (isScheduled) {
      $("battingInfo").innerHTML = `<b>${this.safe(m.venue || "Venue TBA")}</b><br>${this.safe(m.matchDate || "Date TBA")}`;
      $("bowlingInfo").innerHTML = `<b>${this.formatTime(m.liveControl?.displayTime || m.matchTime)}</b><br>Match scheduled`;
    } else {
      const striker = m.striker === 1 ? m.bat1 : m.bat2;
      const non = m.striker === 1 ? m.bat2 : m.bat1;
      $("battingInfo").innerHTML = `<b>${this.safe(striker.name)}</b> ${striker.r}/${striker.b} 🏏<br>${this.safe(non.name)} ${non.r}/${non.b}`;
      const liveBowlerStat = this.bowlerStat(m, m.bowler);
      const liveBowler = liveBowlerStat ? { ...m.bowler, ...liveBowlerStat, name: m.bowler.name, r: liveBowlerStat.runs ?? m.bowler.r, w: liveBowlerStat.wkts ?? m.bowler.w } : m.bowler;
      const currentOver = (!m.matchFinished && m.liveStarted && (m.over || []).length)
        ? `<div class="mini-over"><span>Current over</span>${this.ballsNewestFirst(m.over).map(x => `<i class="ball ${this.ballClass(x)}">${this.safe(String(x).slice(0,3))}</i>`).join("")}</div>`
        : "";
      $("bowlingInfo").innerHTML = `<b>${this.safe(liveBowler.name)}</b> ${overText(liveBowler.balls)}-${liveBowler.r ?? liveBowler.runs}-${liveBowler.w ?? liveBowler.wkts}<br>Last: ${this.safe(m.lastOverBowler || "-")}${currentOver}`;
    }
    this.renderOvers(m);
    $("overviewScore").textContent = `${m.runs}/${m.wkts} (${overText(m.balls)})`;
    $("overviewToss").textContent = m.tossText || "-"; $("overviewCRR").textContent = crr; $("overviewExtras").textContent = m.extras; $("overviewLastWicket").textContent = m.lastWicket || "-";
    $("target").textContent = m.target || "-"; $("need").textContent = need ?? "-"; $("rrr").textContent = rrr; $("partnership").textContent = `${m.partnershipRuns} (${m.partnershipBalls})`;
    $("highlights").innerHTML = (m.highlights || []).length ? m.highlights.map(h => `<div class="comment"><b>${this.safe(h.time || "")}</b> ${this.safe(h.text)}</div>`).join("") : "<span class='muted'>No highlights yet</span>";
    this.renderScorecard(m); this.renderCommentary(m); this.renderStats(m); this.renderPlayers(m); this.renderMatches(); this.renderLeague(m); this.renderPoints(m);
  },

  renderOvers(m) {
    const seenCurrentTeam = m.battingTeam?.name || "";
    const savedInnings = this.orderedInningsDetails(m);
    if (m.matchFinished && savedInnings.length) {
      const first = savedInnings[0]?.overSummary?.length ? this.oversNewestFirst(savedInnings[0].overSummary).map(o => this.overRowHtml(o, savedInnings[0].team || savedInnings[0].battingTeam || "")).join("") : "";
      const second = savedInnings[1]?.overSummary?.length ? this.oversNewestFirst(savedInnings[1].overSummary).map(o => this.overRowHtml(o, savedInnings[1].team || savedInnings[1].battingTeam || "")).join("") : "";
      const separator = first && second ? `<div class="over-row innings-separator">2nd Innings</div>` : "";
      $("overStrip").innerHTML = second ? (second + separator + first) : (first || `<div class="over-row">Over - <span class="ball">-</span></div>`);
      return;
    }
    const saved = savedInnings.flatMap(inn => {
      if (!inn?.overSummary?.length) return [];
      const team = inn.team || inn.battingTeam || "";
      return this.oversNewestFirst(inn.overSummary).map(o => this.overRowHtml(o, team));
    }).join("");
    const secondStarted = Number(m.inningNumber || 1) > 1;
    const currentOverNo = Math.floor(Number(m.balls || 0) / 6) + 1;
    const current = (secondStarted || !saved) && m.over?.length ? `<div class="over-row"><span class="over-label">Over ${currentOverNo}</span><span class="over-balls">${this.ballsNewestFirst(m.over).map(x => `<span class="ball ${this.ballClass(x)}">${this.safe(String(x).slice(0,3))}</span>`).join("")}</span></div>` : "";
    const done = (!saved || secondStarted) ? this.oversNewestFirst(m.overSummary || []).map(o => this.overRowHtml(o, seenCurrentTeam)).join("") : "";
    if (saved && secondStarted) {
      const separator = current || done ? `<div class="over-row innings-separator">2nd Innings</div>` : "";
      $("overStrip").innerHTML = current + done + separator + saved || `<div class="over-row">Over - <span class="ball">-</span></div>`;
      return;
    }
    $("overStrip").innerHTML = current + done + saved || `<div class="over-row">Over - <span class="ball">-</span></div>`;
  },
  oversNewestFirst(rows = []) {
    return [...rows].sort((a, b) => Number(b?.overNo || 0) - Number(a?.overNo || 0));
  },
  ballsNewestFirst(rows = []) {
    return [...rows].reverse();
  },
  overRowHtml(o, team = "") {
    return `<div class="over-row"><span class="over-label">Over ${o.overNo}</span><span class="over-balls">${this.ballsNewestFirst(o.timeline || []).map(x => `<span class="ball ${this.ballClass(x)}">${this.safe(String(x).slice(0,3))}</span>`).join("")}</span></div>`;
  },
  orderedInningsDetails(m) {
    const details = m.inningsDetails || {};
    const orderedNames = [m.firstBattingTeam?.name, m.secondBattingTeam?.name].filter(Boolean);
    const rows = orderedNames.map(name => details[name]).filter(Boolean);
    Object.entries(details).forEach(([name, inn]) => {
      if (!orderedNames.includes(name)) rows.push(inn);
    });
    return rows;
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
    $("scorecardBody").innerHTML = `<div class="card"><h3>${this.safe(team)} Batting</h3><table><thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${batting.length ? batting.map(b => `<tr><td><b>${this.safe(b.name)}</b> ${(!b.out && !b.retired) ? "*" : ""}<br><small>${this.safe(b.dismissal || "")}</small></td><td>${b.r||0}</td><td>${b.b||0}</td><td>${b.f||0}</td><td>${b.s||0}</td><td>${calcSR(b.r,b.b)}</td></tr>`).join("") : `<tr><td colspan="6">No batting data</td></tr>`}</tbody></table></div><div class="card"><h3>Bowling</h3><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>ER</th></tr></thead><tbody>${Object.keys(bowling).length ? Object.entries(bowling).map(([name,s]) => `<tr><td><b>${this.safe(s.playerName || s.name || name)}</b></td><td>${overText(s.balls||0)}</td><td>${s.runs||0}</td><td>${s.wkts||0}</td><td>${calcER(s.runs,s.balls)}</td></tr>`).join("") : `<tr><td colspan="5">No bowling data</td></tr>`}</tbody></table></div>`;
  },

  currentBattingRows(m) { const rows = [...(m.battingScorecard || [])]; [m.bat1, m.bat2].forEach(b => { if (b?.name && b.name !== "-" && !rows.some(x => (b.playerId && x.playerId === b.playerId) || (!b.playerId && x.name === b.name))) rows.push(b); }); return rows; },
  renderCommentary(m) {
    let rows = [...(m.commentary || [])];
    if (m.matchFinished || rows.length === 0) {
      rows = [];
      Object.values(m.inningsDetails || {}).forEach(inn => rows.push(...(inn.commentary || [])));
    }
    $("commentaryList").innerHTML = rows.length ? rows.map(c => {
      const tag = this.commentaryTag(c);
      return `<div class="comment commentary-item">${tag}<div><b>${this.safe(c.ball)}</b> ${this.safe(c.text)}</div></div>`;
    }).join("") : "<span class='muted'>No commentary</span>";
  },
  commentaryTag(c = {}) {
    const text = String(c.text || "");
    const label = c.type === "over" || /^Over/i.test(String(c.ball || "")) ? "OVER" : (/WICKET!/i.test(text) ? "WICKET" : (/SIX!/i.test(text) ? "SIX" : (/FOUR!/i.test(text) ? "FOUR" : "")));
    return label ? `<span class="commentary-tag ${label.toLowerCase()}">${label}</span>` : "";
  },
  renderStats(m) {
    const rows = this.allBatters(m);
    const fours = rows.reduce((a,b)=>a+Number(b.f||0),0), sixes=rows.reduce((a,b)=>a+Number(b.s||0),0);
    const top=[...rows].sort((a,b)=>Number(b.r||0)-Number(a.r||0))[0];
    const bowl={};
    Object.values(m.inningsDetails||{}).forEach(i=>Object.entries(i.bowlerStats||{}).forEach(([n,s])=>{const k=s.playerId||n; bowl[k]=bowl[k]||{playerName:s.playerName||s.name||n,runs:0,balls:0,wkts:0}; bowl[k].runs+=Number(s.runs||0); bowl[k].balls+=Number(s.balls||0); bowl[k].wkts+=Number(s.wkts||0);}));
    if(!Object.keys(bowl).length) Object.assign(bowl,m.bowlerStats||{});
    const best=Object.entries(bowl).sort((a,b)=>Number(b[1].wkts||0)-Number(a[1].wkts||0))[0];
    const innings = Object.values(m.inningsDetails || {});
    const showFull = m.matchFinished && innings.length;
    const totalRuns = showFull ? innings.reduce((a,i)=>a+Number(i.runs||0),0) : m.runs;
    const totalWkts = showFull ? innings.reduce((a,i)=>a+Number(i.wkts||0),0) : m.wkts;
    const totalBalls = showFull ? innings.reduce((a,i)=>a+Number(i.balls||0),0) : m.balls;
    const fow = showFull ? innings.flatMap(i=>i.fallOfWickets||[]) : (m.fallOfWickets||[]);
    const projected = showFull ? "-" : (m.balls ? Math.round(m.runs/(m.balls/(m.totalOvers*6))) : 0);
    $("statRuns").textContent=totalRuns;$("statWkts").textContent=totalWkts;$("statOvers").textContent=overText(totalBalls);$("statProjected").textContent=projected;$("statFours").textContent=fours;$("statSixes").textContent=sixes;$("statTopBatter").textContent=top?`${top.name} ${top.r}`:"-";$("statBestBowler").textContent=best?`${best[1].playerName||best[0]} ${best[1].wkts}/${best[1].runs}`:"-";$("fowList").innerHTML=fow.length?fow.map((x,i)=>`<div class="comment">${i+1}. ${this.safe(x)}</div>`).join(""):"<span class='muted'>No wickets</span>";
    this.renderRunGraph(m);
  },
  allBatters(m) { const out=[]; Object.values(m.inningsDetails||{}).forEach(i=>out.push(...(i.battingScorecard||[]))); if(!out.length) out.push(...this.currentBattingRows(m)); return out; },
  renderRunGraph(m) {
    const series = this.graphSeries(m);
    $("graphSummary").textContent = series.length > 1 ? "Innings comparison" : "Live progression";
    $("runGraph").innerHTML = this.runWormSvg(series, m.totalOvers);
  },
  graphSeries(m) {
    const innings = Object.values(m.inningsDetails || {});
    const current = { team: m.battingTeam?.name || "Current", overSummary: m.overSummary || [], over: m.over || [], runs: m.runs, wkts: m.wkts, balls: m.balls };
    const source = innings.length ? [...innings] : [current];
    const currentTeam = current.team;
    const hasCurrentScore = Number(m.runs || 0) || Number(m.balls || 0) || current.over.length || current.overSummary.length;
    const currentIndex = source.findIndex(inn => (inn.team || inn.battingTeam?.name || inn.battingTeam) === currentTeam);
    if (innings.length && hasCurrentScore && !m.matchFinished) {
      if (currentIndex >= 0) source[currentIndex] = { ...source[currentIndex], ...current };
      else source.push(current);
    }
    return source.map((inn, idx) => {
      const points = [{ over: 0, runs: 0, wkts: 0 }];
      let runs = 0, wkts = 0;
      let legalBalls = 0;
      const pushBall = (ball) => {
        const text = String(ball || "");
        runs += this.ballRuns(text);
        const wicketBall = /^W(?!d)|wicket/i.test(text);
        if (wicketBall) wkts += 1;
        if (!/(Wd|wide|Nb|no ball|no-ball)/i.test(text)) legalBalls += 1;
        const over = Number((legalBalls / 6).toFixed(2));
        const last = points[points.length - 1];
        if (last && last.over === over && last.runs === runs && last.wkts === wkts) return;
        points.push({ over, runs, wkts, wicket: wicketBall });
      };
      const completedOvers = [...(inn.overSummary || [])].reverse();
      completedOvers.forEach((over, i) => {
        const before = legalBalls;
        (over.timeline || []).forEach(pushBall);
        const targetBalls = Math.max(legalBalls, Number(over.overNo || i + 1) * 6);
        if (legalBalls === before && (Number(over.runs || 0) || Number(over.wkts || 0))) {
          runs += Number(over.runs || 0);
          const overWkts = Number(over.wkts || 0);
          wkts += overWkts;
          legalBalls = targetBalls;
          points.push({ over: Number((legalBalls / 6).toFixed(2)), runs, wkts, wicket: overWkts > 0 });
        }
      });
      if (Array.isArray(inn.over) && inn.over.length) inn.over.forEach(pushBall);
      if (Number(inn.runs || 0) > runs || Number(inn.wkts || 0) > wkts) {
        const balls = Math.max(legalBalls, Number(inn.balls || 0));
        points.push({ over: Number(((balls || 6) / 6).toFixed(2)), runs: Number(inn.runs || 0), wkts: Number(inn.wkts || 0) });
      }
      return { name: inn.team || inn.battingTeam || `Innings ${idx + 1}`, points };
    });
  },
  ballRuns(ball) {
    const text = String(ball || "");
    const n = Number((text.match(/\d+/) || [0])[0]);
    if (/Wd|wide/i.test(text)) return n || 1;
    if (/Nb|no/i.test(text)) return n || 1;
    return Number.isFinite(n) ? n : 0;
  },
  runWormSvg(series = [], totalOvers = 0) {
    const width = 720, height = 330, pad = 52;
    const all = series.flatMap(s => s.points);
    const maxRunsRaw = Math.max(20, ...all.map(p => Number(p.runs || 0)));
    const maxRuns = Math.ceil(maxRunsRaw / 50) * 50;
    const maxOverRaw = Math.max(1, ...all.map(p => Number(p.over || 0)));
    const maxOver = Math.max(1, Math.ceil(maxOverRaw), Number(totalOvers || 0));
    const colors = ["#e53935", "#1a73e8", "#0f766e", "#7c3aed"];
    const x = over => pad + (Number(over || 0) / maxOver) * (width - pad * 2);
    const y = runs => height - pad - (Number(runs || 0) / maxRuns) * (height - pad * 2);
    const grid = [0,.2,.4,.6,.8,1].map(v => {
      const gy = y(maxRuns * v);
      return `<line x1="${pad}" y1="${gy}" x2="${width-pad}" y2="${gy}" class="graph-grid"/><text x="${pad-38}" y="${gy+4}" class="graph-label">${Math.round(maxRuns*v)}</text>`;
    }).join("");
    const tickCount = Math.min(maxOver, 10);
    const overTicks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxOver / tickCount) * i)).filter((v, i, arr) => i === 0 || v !== arr[i - 1]).map(over => `<line x1="${x(over)}" y1="${height-pad}" x2="${x(over)}" y2="${height-pad+5}" class="graph-axis"/><text x="${x(over)-4}" y="${height-18}" class="graph-label">${over}</text>`).join("");
    const legend = series.map((s, i) => {
      const lx = pad + i * 148;
      const marker = i === 1 ? `<rect x="${lx}" y="20" width="14" height="14" rx="1" fill="${colors[i%colors.length]}"/>` : `<circle cx="${lx+7}" cy="27" r="7" fill="${colors[i%colors.length]}"/>`;
      return `${marker}<text x="${lx+24}" y="31" class="graph-key" fill="#4b5563">${this.safe(s.name)}</text>`;
    }).join("");
    const lines = series.map((s, i) => {
      const d = s.points.map((p, idx) => `${idx ? "L" : "M"}${x(p.over).toFixed(1)},${y(p.runs).toFixed(1)}`).join(" ");
      const points = s.points.map(p => {
        const label = `${this.safe(s.name)} | Over ${p.over} | ${p.runs}/${p.wkts || 0}`;
        return p.wicket ? `<circle cx="${x(p.over)}" cy="${y(p.runs)}" r="5" fill="${colors[i%colors.length]}" stroke="#fff" stroke-width="2"><title>${label}</title></circle>` : "";
      }).join("");
      return `<path d="${d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>${points}`;
    }).join("");
    this.graphState = { series, width, height, pad, maxOver, maxRuns, colors };
    setTimeout(() => this.bindGraphTooltip(), 0);
    return `<div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Scoring comparison graph"><rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>${legend}${grid}${overTicks}<line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" class="graph-axis"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}" class="graph-axis"/>${lines}<line id="graphGuide" class="graph-guide hidden" x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}"/><g id="graphHoverDots"></g><rect class="graph-capture" x="${pad}" y="${pad}" width="${width-pad*2}" height="${height-pad*2}"/><text x="${pad-4}" y="${height-7}" class="graph-label">overs</text></svg><div id="graphTooltip" class="graph-tooltip hidden"></div></div>`;
  },
  bindGraphTooltip() {
    const box = $("runGraph");
    if (!box || box.dataset.tooltipBound === "1") return;
    box.dataset.tooltipBound = "1";
    const overTextFromValue = (over) => {
      const balls = Math.max(0, Math.round(Number(over || 0) * 6));
      return `${Math.floor(balls / 6)}.${balls % 6}`;
    };
    const pointAtOver = (points, over) => {
      return points.reduce((best, point) => point.over <= over && point.over >= best.over ? point : best, points[0] || { over: 0, runs: 0, wkts: 0 });
    };
    const show = (ev) => {
      const state = this.graphState;
      const tip = $("graphTooltip");
      const guide = $("graphGuide");
      const dots = $("graphHoverDots");
      if (!tip) return;
      if (!state?.series?.length) return;
      const rect = box.getBoundingClientRect();
      const svg = box.querySelector("svg");
      const svgRect = svg.getBoundingClientRect();
      const localX = (ev.clientX - svgRect.left) * (state.width / svgRect.width);
      const clampedX = Math.min(state.width - state.pad, Math.max(state.pad, localX));
      const over = ((clampedX - state.pad) / (state.width - state.pad * 2)) * state.maxOver;
      const rows = state.series.map((s, i) => ({ ...pointAtOver(s.points, over), name: s.name, color: state.colors[i % state.colors.length], shape: i === 1 ? "square" : "dot" }));
      const tooltipOver = rows.reduce((best, point) => Math.abs(point.over - over) < Math.abs(best.over - over) ? point : best, rows[0]);
      guide?.classList.remove("hidden");
      if (guide) {
        guide.setAttribute("x1", clampedX.toFixed(1));
        guide.setAttribute("x2", clampedX.toFixed(1));
      }
      if (dots) {
        dots.innerHTML = rows.map(row => {
          const cy = state.height - state.pad - (Number(row.runs || 0) / state.maxRuns) * (state.height - state.pad * 2);
          return `<circle class="graph-hover-dot" cx="${clampedX.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${row.color}"/>`;
        }).join("");
      }
      tip.innerHTML = `<b>${overTextFromValue(tooltipOver.over)} overs</b>${rows.map(row => `<div class="graph-tip-row"><span><i class="${row.shape}" style="background:${row.color}"></i>${this.safe(row.name)}</span><strong>${row.runs}/${row.wkts || 0}</strong></div>`).join("")}`;
      tip.classList.remove("hidden");
      const tipWidth = tip.offsetWidth || 190;
      const tipHeight = tip.offsetHeight || 112;
      const pointerX = ev.clientX - rect.left;
      const pointerY = ev.clientY - rect.top;
      let left = pointerX + 14;
      if (left + tipWidth > rect.width - 8) left = pointerX - tipWidth - 14;
      let top = pointerY - tipHeight - 12;
      if (top < 8) top = pointerY + 14;
      tip.style.left = `${Math.min(rect.width - tipWidth - 8, Math.max(8, left))}px`;
      tip.style.top = `${Math.min(rect.height - tipHeight - 8, Math.max(8, top))}px`;
    };
    const hide = () => {
      const tip = $("graphTooltip");
      const guide = $("graphGuide");
      const dots = $("graphHoverDots");
      if (!tip) return;
      tip.classList.add("hidden");
      guide?.classList.add("hidden");
      if (dots) dots.innerHTML = "";
    };
    box.addEventListener("pointermove", e => {
      if (!e.target.closest?.(".graph-capture") && !e.target.closest?.("svg")) return hide();
      show(e);
    });
    box.addEventListener("pointerdown", show);
    box.addEventListener("pointerleave", hide);
  },
  renderPlayers(m) { const blocks=[]; Object.entries(m.teams||{}).forEach(([team,players]) => (players||[]).forEach(p => { const meta=m.teamInfo?.[team]?.players?.[p]||{}; blocks.push(`<div class="player" onclick="app.playerModal('${encodeURIComponent(team)}','${encodeURIComponent(p)}','${encodeURIComponent(meta.playerId || "")}')"><div class="avatar">${meta.image?`<img src="${this.safe(meta.image)}">`:this.short(p).slice(0,2)}</div><b>${this.safe(p)}</b><br><small>${this.safe(team)}</small></div>`); })); $("playersList").innerHTML = blocks.join("") || "<span class='muted'>No players</span>"; },
  renderMatches() {
    const s = this.state || {};
    const isScheduled = String(s.status || "").toLowerCase() === "scheduled" && !s.liveStarted;
    const currentMeta = isScheduled
      ? `Scheduled - ${this.safe([s.matchDate, this.formatTime(s.liveControl?.displayTime || s.matchTime)].filter(Boolean).join(" "))}`
      : `Current - ${s.runs}/${s.wkts} (${overText(s.balls)})`;
    const current = s.matchId ? `<div class="match-card-mini"><b>${this.safe(s.matchTitle)}</b><br><small>${currentMeta}</small></div>` : "";
    const history = this.completed.map(m => `<div class="match-card-mini" onclick="location.href='user.html?match=${m.matchId}'"><b>${this.safe(m.matchTitle||m.title||'Match')}</b><br><small>${this.safe(m.winnerText||'')}<br>${this.safe(m.firstInnings||'')} ${m.secondInnings?' | '+this.safe(m.secondInnings):''}</small></div>`).join("");
    $("matchesList").innerHTML = current + history || "<span class='muted'>No matches</span>";
  },
  renderLeague(m) { const l=m.league||{}; const schedule=Array.isArray(l.schedule)?l.schedule:[]; const teams=Array.isArray(l.teams)?l.teams:[]; $("leagueTitle").textContent=l.name||"League";$("leagueTeams").textContent=teams.length;$("leagueMatches").textContent=schedule.length;$("leagueDone").textContent=schedule.filter(x=>x.status==='completed'||x.status==='done').length;$("leaguePending").textContent=schedule.filter(x=>!(x.status==='completed'||x.status==='done')).length; const filtered=this.filterSchedule(schedule); $("leagueSchedule").innerHTML=filtered.map(x=>{ const result=x.result||x.winnerText||""; const score=[x.firstInnings,x.secondInnings].filter(Boolean).join(" | "); const when=[x.matchDate,x.matchTime].filter(Boolean).join(" "); const meta=[x.stage||'League',x.round,x.status||'pending'].filter(Boolean).join(" · "); return `<div class="match-card-mini fixture-card"><div class="fixture-top">${when?`<span>${this.safe(when)}</span>`:`<span>Time TBA</span>`}<b>${this.safe(x.status||'pending')}</b></div><strong>${this.safe(x.teamA?.name||x.teamA)} vs ${this.safe(x.teamB?.name||x.teamB)}</strong><small>${this.safe(meta)}</small>${x.venue?`<small>${this.safe(x.venue)}</small>`:""}${result?`<b class="fixture-result">${this.safe(result)}</b>`:""}${score?`<small>${this.safe(score)}</small>`:""}</div>`; }).join("")||"<span class='muted'>No schedule</span>"; },
  filterSchedule(schedule) {
    const done = x => ["completed", "done", "no-result", "cancelled"].includes(String(x.status || "").toLowerCase());
    if (this.scheduleFilter === "upcoming") return schedule.filter(x => !done(x));
    if (this.scheduleFilter === "completed") return schedule.filter(done);
    if (this.scheduleFilter === "playoffs") return schedule.filter(x => /qualifier|eliminator|final|semi/i.test(`${x.stage || ""} ${x.round || ""}`));
    return schedule;
  },
  renderPoints(m) { const l=m.league||{}; const pts=m.pointsTable||l.pointsTable||{}; $("pointsTitle").textContent = `${l.name || "League"} Points Table`; const rows=Object.entries(pts).sort((a,b)=>Number(b[1].Pts||0)-Number(a[1].Pts||0)||this.nrrValue(b[1])-this.nrrValue(a[1])||Number(b[1].W||0)-Number(a[1].W||0)||String(a[0]).localeCompare(String(b[0]))); $("pointsTable").innerHTML=rows.map(([t,p],i)=>`<tr><td><b>${i+1}. ${this.safe(t)}</b></td><td>${p.P||0}</td><td>${p.W||0}</td><td>${p.L||0}</td><td>${p.T||0}</td><td>${p.NR||0}</td><td><b>${p.Pts||0}</b></td><td class="${this.nrrValue(p)>=0?'positive':'negative'}">${this.nrr(p)}</td></tr>`).join("")||`<tr><td colspan="8">No points</td></tr>`; },
  async playerModal(teamEnc, playerEnc, playerIdEnc = "") {
    const team = decodeURIComponent(teamEnc);
    const player = decodeURIComponent(playerEnc);
    const requestedPlayerId = playerIdEnc ? decodeURIComponent(playerIdEnc) : "";
    const playerId = requestedPlayerId || this.state.teamInfo?.[team]?.players?.[player]?.playerId || "";
    let stats = this.playerStats(player, team, playerId);
    try {
      const careerRows = await getPlayerCareerStats({ playerId, playerName: player });
      if (careerRows.length) stats = this.statsFromCareerRows(careerRows);
    } catch (e) {
      console.warn("Career stats load failed", e);
    }
    const batSR = calcSR(stats.runs, stats.balls);
    const bowlEco = calcER(stats.bowlingRuns, stats.bowlingBalls);
    $("modalBody").innerHTML = `
      <div class="profile-hero">
        <div class="avatar xl">${this.playerImageHtml(player, team, playerId)}</div>
        <div><h2>${this.safe(player)}</h2><p>${this.safe(team)} · ${stats.matches} matches</p></div>
      </div>
      <p>${this.safe(team)} · Matches: <b>${stats.matches}</b></p>

      <h3 style="margin:16px 0 8px">Batting</h3>
      <div class="quick-grid">
        <div><span>Innings</span><b>${stats.innings}</b></div>
        <div><span>Runs</span><b>${stats.runs}</b></div>
        <div><span>Balls Faced</span><b>${stats.balls}</b></div>
        <div><span>Batting Dots</span><b>${stats.dots}</b></div>
        <div><span>4s</span><b>${stats.fours}</b></div>
        <div><span>6s</span><b>${stats.sixes}</b></div>
        <div><span>SR</span><b>${batSR}</b></div>
      </div>

      <h3 style="margin:18px 0 8px">Bowling</h3>
      <div class="quick-grid">
        <div><span>Overs</span><b>${overText(stats.bowlingBalls)}</b></div>
        <div><span>Balls Bowled</span><b>${stats.bowlingBalls}</b></div>
        <div><span>Runs Given</span><b>${stats.bowlingRuns}</b></div>
        <div><span>Bowling Dots</span><b>${stats.bowlingDots}</b></div>
        <div><span>Wickets</span><b>${stats.wkts}</b></div>
        <div><span>Economy</span><b>${bowlEco}</b></div>
        <div><span>Wides</span><b>${stats.wides}</b></div>
        <div><span>No Balls</span><b>${stats.noBalls}</b></div>
      </div>
    `;
    $("modal").classList.add("show");
  },
  teamModal(teamEnc) {
    const teamName = decodeURIComponent(teamEnc);
    const m = normalizeState(this.state);
    const row = this.teamProfileRows(m).find(t => t.name === teamName);
    if (!row) return;
    const points = row.points || {};
    const recent = (this.completed || []).filter(match => [match.teamA?.name, match.teamB?.name, match.battingTeam?.name, match.bowlingTeam?.name, match.matchTitle].some(v => String(v || "").includes(teamName))).slice(0, 5);
    $("modalBody").innerHTML = `
      <div class="profile-hero">
        <div class="logo xl">${this.logo(row)}</div>
        <div><h2>${this.safe(row.name)}</h2><p>${row.players.length} players · ${points.Pts || 0} points · NRR ${this.nrr(points)}</p></div>
      </div>
      <div class="quick-grid">
        <div><span>Played</span><b>${points.P || 0}</b></div>
        <div><span>Won</span><b>${points.W || 0}</b></div>
        <div><span>Lost</span><b>${points.L || 0}</b></div>
        <div><span>NR</span><b>${points.NR || 0}</b></div>
      </div>
      <h3 style="margin:16px 0 8px">Squad</h3>
      <div class="profile-list">${row.players.map(p => { const meta = this.state.teamInfo?.[row.name]?.players?.[p] || {}; return `<button onclick="app.playerModal('${encodeURIComponent(row.name)}','${encodeURIComponent(p)}','${encodeURIComponent(meta.playerId || "")}')">${this.safe(p)}</button>`; }).join("") || "<span class='muted'>No players</span>"}</div>
      <h3 style="margin:16px 0 8px">Recent Matches</h3>
      ${recent.length ? recent.map(x => `<div class="comment"><b>${this.safe(x.matchTitle || x.title || "Match")}</b><br><small>${this.safe(x.winnerText || "Result pending")}</small></div>`).join("") : "<span class='muted'>No recent matches</span>"}
    `;
    $("modal").classList.add("show");
  },
  playerImageHtml(player, team, playerId = "") {
    const meta = (playerId && this.state.teamInfo?.[team]?.playersById?.[playerId]) || this.state.teamInfo?.[team]?.players?.[player] || {};
    return meta.image ? `<img src="${this.safe(meta.image)}">` : this.short(player).slice(0,2);
  },
  statsFromCareerRows(rows = []) {
    const s = { runs: 0, balls: 0, dots: 0, fours: 0, sixes: 0, wkts: 0, bowlingBalls: 0, bowlingRuns: 0, bowlingDots: 0, wides: 0, noBalls: 0, matches: 0, innings: 0 };
    const matches = new Set();
    rows.forEach(r => {
      if (r.matchId) matches.add(r.matchId);
      if (Number(r.balls || 0) || Number(r.runs || 0)) s.innings += 1;
      s.runs += Number(r.runs || 0);
      s.balls += Number(r.balls || 0);
      s.dots += Number(r.battingDots ?? r.dots ?? 0);
      s.fours += Number(r.fours || 0);
      s.sixes += Number(r.sixes || 0);
      s.wkts += Number(r.wickets || 0);
      s.bowlingBalls += Number(r.bowlingBalls || 0);
      s.bowlingRuns += Number(r.bowlingRuns || 0);
      s.bowlingDots += Number(r.bowlingDots || 0);
      s.wides += Number(r.wides || 0);
      s.noBalls += Number(r.noBalls || 0);
    });
    s.matches = matches.size || rows.length;
    return s;
  },
  closeModal() { $("modal").classList.remove("show"); },
  playerKey(player = {}) { return player.playerId || String(player.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_") || "player"; },
  bowlerStat(m, bowler = {}) {
    const key = this.playerKey(bowler);
    return m.bowlerStats?.[key] || m.bowlerStats?.[bowler.name] || null;
  },
  playerStats(player, teamName = "", playerId = "") {
    const meta = teamName ? (this.state.teamInfo?.[teamName]?.players?.[player] || {}) : {};
    const targetPlayerId = playerId || meta.playerId || "";
    const s = { runs: 0, balls: 0, dots: 0, fours: 0, sixes: 0, wkts: 0, bowlingBalls: 0, bowlingRuns: 0, bowlingDots: 0, wides: 0, noBalls: 0, matches: 0, innings: 0 };
    const countedMatches = new Set();
    const processedMatches = new Set();

    const sameBatter = (bat, innTeam = "") => {
      if (!bat || bat.name !== player) return false;
      if (targetPlayerId && bat.playerId && bat.playerId !== targetPlayerId) return false;
      if (!targetPlayerId && teamName && innTeam && innTeam !== teamName) return false;
      return true;
    };

    const sameBowler = (name, stat = {}, bowlingTeam = "") => {
      if (!name || name !== player) return false;
      if (targetPlayerId && stat.playerId && stat.playerId !== targetPlayerId) return false;
      if (!targetPlayerId && teamName && bowlingTeam && bowlingTeam !== teamName) return false;
      return true;
    };

    const addMatch = (matchId) => {
      if (!matchId || countedMatches.has(matchId)) return;
      countedMatches.add(matchId);
      s.matches += 1;
    };

    const addBatter = (bat, innTeam = "") => {
      if (!sameBatter(bat, innTeam)) return false;
      s.innings += 1;
      s.runs += Number(bat.r || bat.runs || 0);
      s.balls += Number(bat.b || bat.balls || 0);
      s.dots += Number(bat.dots || bat.d || 0);
      s.fours += Number(bat.f || bat.fours || 0);
      s.sixes += Number(bat.s || bat.sixes || 0);
      return true;
    };

    const addBowler = (name, stat, bowlingTeam = "") => {
      if (!sameBowler(name, stat, bowlingTeam)) return false;
      s.wkts += Number(stat.wkts || stat.w || 0);
      s.bowlingBalls += Number(stat.balls || stat.b || 0);
      s.bowlingRuns += Number(stat.runs ?? stat.r ?? 0);
      s.bowlingDots += Number(stat.dots || stat.d || 0);
      s.wides += Number(stat.wides || stat.wd || 0);
      s.noBalls += Number(stat.noBalls || stat.nb || 0);
      return true;
    };

    const collectMatch = (match) => {
      if (!match) return;
      const matchId = match.matchId || match.id || match.title || match.matchTitle || "current";
      if (processedMatches.has(matchId)) return;
      processedMatches.add(matchId);

      let seen = false;
      const innings = Object.values(match.inningsDetails || {});
      const matchTeams = [match.teamA?.name, match.teamB?.name].filter(Boolean);
      const oppositeTeam = (batTeam) => matchTeams.find(n => n && n !== batTeam) || "";
      const scorecard = match.fullScorecardData || match.scorecard || {};
      const scorecardInnings = Object.values(scorecard.inningsDetails || {});
      const hasSavedInnings = innings.length || scorecardInnings.length;
      const inningSeen = new Set();

      const addInnings = (inn) => {
        if (!inn) return;
        const battingRows = Array.isArray(inn.battingScorecard) ? inn.battingScorecard : [];
        const innTeam = inn.team || inn.battingTeam?.name || inn.battingTeam || "";
        const bowlingTeam = inn.bowlingTeam?.name || inn.bowlingTeam || inn.fieldingTeam?.name || inn.fieldingTeam || oppositeTeam(innTeam);
        const key = `${innTeam}|${inn.runs ?? ""}|${inn.wkts ?? ""}|${inn.balls ?? ""}|${battingRows.map(b => (b.playerId || b.name) + ":" + (b.r || b.runs || 0) + ":" + (b.b || b.balls || 0)).join(",")}`;
        if (inningSeen.has(key)) return;
        inningSeen.add(key);
        battingRows.forEach(bat => { if (addBatter(bat, innTeam)) seen = true; });
      Object.entries(inn.bowlerStats || {}).forEach(([name, stat]) => { if (addBowler(stat.playerName || stat.name || name, stat, bowlingTeam)) seen = true; });
      };

      innings.forEach(addInnings);
      scorecardInnings.forEach(addInnings);

      const isLiveCurrent = match.matchFinished !== true && match.status !== "completed";
      if (isLiveCurrent) {
        addInnings({
          team: match.battingTeam?.name || "",
          runs: match.runs,
          wkts: match.wkts,
          balls: match.balls,
          battingScorecard: this.currentBattingRows(match),
          bowlingTeam: match.bowlingTeam?.name || match.bowlingTeam || oppositeTeam(match.battingTeam?.name || ""),
          bowlerStats: match.bowlerStats || {}
        });
      }

      // Only use flat/legacy scorecard when saved inningsDetails are not available.
      // This prevents completed matches from being counted twice.
      if (!hasSavedInnings && !isLiveCurrent) {
        if (Array.isArray(scorecard.completedInnings)) scorecard.completedInnings.forEach(addInnings);
        else Object.values(scorecard.completedInnings || match.completedInnings || {}).forEach(rows => addInnings({ battingScorecard: rows }));
        if (scorecard.battingScorecard) addInnings({ team: match.battingTeam?.name || "", battingScorecard: scorecard.battingScorecard });
        if (match.battingScorecard) addInnings({ team: match.battingTeam?.name || "", battingScorecard: match.battingScorecard });
        const legacyBowlingTeam = match.bowlingTeam?.name || match.bowlingTeam || "";
        Object.entries(scorecard.bowlerStats || {}).forEach(([name, stat]) => { if (addBowler(stat.playerName || stat.name || name, stat, legacyBowlingTeam)) seen = true; });
        Object.entries(match.bowlerStats || {}).forEach(([name, stat]) => { if (addBowler(stat.playerName || stat.name || name, stat, legacyBowlingTeam)) seen = true; });
        if (match.bowler?.name === player && addBowler(match.bowler.name, match.bowler, legacyBowlingTeam)) seen = true;
      }

      if (seen) addMatch(matchId);
    };

    collectMatch(this.state);
    (this.completed || []).forEach(collectMatch);
    return s;
  },
  teamByName(m, name) {
    if (!name) return null;
    return [m.teamA, m.teamB, m.battingTeam, m.bowlingTeam, m.firstBattingTeam, m.secondBattingTeam].find(t => t?.name === name) || { name };
  },
  inningsOrder(m) {
    const keys = Object.keys(m.inningsDetails || {});
    const firstName = m.firstBattingTeam?.name || (m.inningNumber === 1 ? m.battingTeam?.name : keys[0]) || m.teamA?.name || m.battingTeam?.name;
    const secondName = m.secondBattingTeam?.name || (m.inningNumber === 1 ? m.bowlingTeam?.name : m.battingTeam?.name) || keys.find(k => k !== firstName) || (m.teamA?.name === firstName ? m.teamB?.name : m.teamA?.name);
    return { first: this.teamByName(m, firstName), second: this.teamByName(m, secondName) };
  },
  battingFirstOrder(m) {
    if (!m.matchFinished && m.battingTeam?.name) {
      const firstName = m.battingTeam.name;
      const secondName = [m.teamA?.name, m.teamB?.name, m.bowlingTeam?.name].find(name => name && name !== firstName);
      return { first: this.teamByName(m, firstName), second: this.teamByName(m, secondName) };
    }
    return this.inningsOrder(m);
  },
  savedInningsText(m, teamName) {
    if (!teamName) return "";
    if (teamName === m.firstBattingTeam?.name) return m.firstInnings || "";
    if (teamName === m.secondBattingTeam?.name) return m.secondInnings || "";
    return "";
  },
  inningsMeta(m, teamName, score = "") {
    if (!teamName && !score) return "";
    if (teamName === m.firstBattingTeam?.name) return "1st innings";
    if (teamName === m.secondBattingTeam?.name) return "2nd innings";
    return score ? "Innings" : "";
  },
  splitScoreOver(value = "") {
    const text = String(value || "");
    const match = text.match(/^(.+?)\s*(\([^()]+\))$/);
    return match ? { score: match[1].trim(), over: match[2].trim() } : { score: text, over: "" };
  },
  inningsScore(m, team) { const d = m.inningsDetails?.[team]; return d ? `${d.runs}/${d.wkts} (${d.overs || overText(d.balls)})` : ""; },
  logo(team){ return team?.logo ? `<img src="${this.safe(team.logo)}">` : this.safe(team?.shortName || this.short(team?.name)); },
  teamShort(t){ return t?.shortName || this.short(t?.name || t || "-"); },
  short(x){ return String(x||'-').split(/\s+/).map(v=>v[0]).join('').slice(0,3).toUpperCase(); },
  formatTime(value) {
    if (!value) return "Time";
    const [h, m] = String(value).split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return String(value);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  },
  safe(v){return String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));},
  ballClass(x){const t=String(x);return /^W(?!d)/i.test(t)?'wicket':(t==='4'?'four':(t==='6'?'six':''));},
  nrrValue(p){const rf=p?.BF?Number(p.RF||0)/(Number(p.BF||0)/6):0,ra=p?.BA?Number(p.RA||0)/(Number(p.BA||0)/6):0;return rf-ra;},
  nrr(p){const v=this.nrrValue(p);return `${v>=0?"+":""}${v.toFixed(3)}`;}
};

window.app.init();
