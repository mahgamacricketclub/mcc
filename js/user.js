import { listenLiveMatch, trackViewer } from "./firebase-live.js";
import { listenMatch, listenCompletedMatches, getLatestPublicMatch, getPlayerCareerStats } from "./firebase-store.js";
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
      this.noMatch("Searching for the latest match...");
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
    this.unsubs.push(trackViewer(MATCH_ID, this.viewerId, count => { this.state.onlineViewers = count; $("viewerCount").textContent = count; }));
  },

  publish() {
    this.state = mergeMatch(this.live, this.store, this.state);
    if (!this.hasData(this.state)) return this.noMatch("Waiting for match data...");
    this.saveBackup();
    this.hideState();
    this.updateShareMeta(this.state);
    this.render();
  },

  hasData(m) { return !!(m?.matchId || m?.matchTitle || m?.liveStarted || m?.matchFinished || Number(m?.runs || 0) || Number(m?.balls || 0)); },
  noMatch(msg) {
    if (!this.offlineBackupLoaded) $("matchTitle").textContent = "Live Cricket";
    $("liveInfo").textContent = this.offlineBackupLoaded ? `${msg} Showing the last saved score.` : msg;
    if (!this.offlineBackupLoaded) this.showState("Match Unavailable", msg);
  },
  showState(title, text) { $("pageStateTitle").textContent = title; $("pageStateText").textContent = text; $("pageState").classList.remove("hidden"); },
  hideState() { $("pageState").classList.add("hidden"); },
  retry() { this.showState("Retrying", "Refreshing match data..."); this.connect(); if (this.store || this.live) this.publish(); },
  saveBackup() { try { if (this.hasData(this.state)) localStorage.setItem(USER_MATCH_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), state: this.state })); } catch (_) {} },
  loadBackup() { try { const saved = JSON.parse(localStorage.getItem(USER_MATCH_BACKUP_KEY) || "{}"); if (saved?.state && this.hasData(saved.state)) { this.offlineBackupLoaded = true; this.state = normalizeState(saved.state); this.render(); this.hideState(); $("liveInfo").textContent = "Showing the last saved score. Live updates will resume automatically."; } } catch (_) {} },
  openTab(id, btn) { document.querySelectorAll(".content").forEach(c => c.classList.remove("active")); document.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); $(id).classList.add("active"); btn.classList.add("active"); this.render(); },
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
    document.body.classList.toggle("live-glow", !!(m.liveStarted && !m.matchFinished && !m.scoringLocked));
    const order = this.inningsOrder(m);
    const first = order.first;
    const second = order.second;
    $("matchTitle").textContent = m.matchTitle || "Live Match";
    $("teamA").textContent = this.teamShort(first);
    $("teamB").textContent = this.teamShort(second);
    $("logoA").innerHTML = this.logo(first);
    $("logoB").innerHTML = this.logo(second);
    const firstScore = this.inningsScore(m, first?.name);
    const secondScore = this.inningsScore(m, second?.name);
    const firstLive = m.inningNumber === 1 && !m.matchFinished;
    const secondLive = m.inningNumber === 2 && !m.matchFinished;
    const firstText = firstLive ? `${m.runs}/${m.wkts}` : this.safe(firstScore || m.firstInnings || "-");
    const firstMeta = firstLive ? `(${overText(m.balls)}) · Batting` : "1st innings";
    const secondText = secondLive ? `${m.runs}/${m.wkts}` : this.safe(secondScore || m.secondInnings || "Yet to bat");
    const secondMeta = secondLive ? `(${overText(m.balls)}) · Batting` : (m.matchFinished || secondScore || m.secondInnings ? "2nd innings" : "");
    $("scoreA").innerHTML = `<span class="score-main">${firstText}</span>${firstMeta ? `<small>${firstMeta}</small>` : ""}`;
    $("scoreB").innerHTML = `<span class="score-main">${secondText}</span>${secondMeta ? `<small>${secondMeta}</small>` : ""}`;
    const teamCards = document.querySelectorAll(".match-card .team");
    teamCards[0]?.classList.toggle("batting-now", firstLive);
    teamCards[1]?.classList.toggle("batting-now", secondLive);
    const mode = m.matchFinished ? "result" : (m.scoringLocked ? "locked" : (m.liveControl?.mode === "time" ? "time" : (m.liveControl?.mode === "delay" ? "delay" : (m.liveControl?.mode === "paused" ? "break" : "live"))));
    $("centerStatus").className = `center ${mode}`;
    $("centerStatus").textContent = m.matchFinished ? "Result" : (m.scoringLocked ? "Locked" : (m.liveControl?.mode === "time" ? this.formatTime(m.liveControl.displayTime) : (m.liveControl?.mode === "paused" ? "Break" : (m.liveControl?.mode === "delay" ? "Delay" : "Live"))));
    const crr = m.balls ? (m.runs / (m.balls / 6)).toFixed(2) : "0.00";
    const remBalls = Math.max(Number(m.totalOvers || 20) * 6 - m.balls, 0);
    const need = m.target ? Math.max(m.target - m.runs, 0) : null;
    const rrr = need == null ? "-" : (remBalls ? ((need * 6) / remBalls).toFixed(2) : "0.00");
    $("liveInfo").textContent = m.matchFinished ? `${m.winnerText || "Match Complete"}${m.playerOfMatch ? " · Player of Match: " + m.playerOfMatch : ""}` : (m.liveControl?.mode === "time" ? `Scheduled time: ${this.formatTime(m.liveControl.displayTime)}` : `${m.tossText || "Live"} · CRR ${crr}${need != null ? ` · Need ${need} from ${remBalls}` : ""}`);
    const striker = m.striker === 1 ? m.bat1 : m.bat2;
    const non = m.striker === 1 ? m.bat2 : m.bat1;
    $("battingInfo").innerHTML = `<b>${this.safe(striker.name)}</b> ${striker.r}/${striker.b} 🏏<br>${this.safe(non.name)} ${non.r}/${non.b}`;
    const liveBowler = m.bowlerStats?.[m.bowler.name] ? { ...m.bowler, ...m.bowlerStats[m.bowler.name], r: m.bowlerStats[m.bowler.name].runs ?? m.bowler.r, w: m.bowlerStats[m.bowler.name].wkts ?? m.bowler.w } : m.bowler;
    $("bowlingInfo").innerHTML = `<b>${this.safe(liveBowler.name)}</b> ${overText(liveBowler.balls)}-${liveBowler.r ?? liveBowler.runs}-${liveBowler.w ?? liveBowler.wkts}<br>Last: ${this.safe(m.lastOverBowler || "-")}`;
    this.renderOvers(m);
    $("overviewScore").textContent = `${m.runs}/${m.wkts} (${overText(m.balls)})`;
    $("overviewToss").textContent = m.tossText || "-"; $("overviewCRR").textContent = crr; $("overviewExtras").textContent = m.extras; $("overviewLastWicket").textContent = m.lastWicket || "-";
    $("target").textContent = m.target || "-"; $("need").textContent = need ?? "-"; $("rrr").textContent = rrr; $("partnership").textContent = `${m.partnershipRuns} (${m.partnershipBalls})`;
    $("highlights").innerHTML = (m.highlights || []).length ? m.highlights.map(h => `<div class="comment"><b>${this.safe(h.time || "")}</b> ${this.safe(h.text)}</div>`).join("") : "<span class='muted'>No highlights yet</span>";
    this.renderScorecard(m); this.renderCommentary(m); this.renderStats(m); this.renderPlayers(m); this.renderMatches(); this.renderLeague(m); this.renderPoints(m);
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
  renderCommentary(m) {
    let rows = [...(m.commentary || [])];
    if (m.matchFinished || rows.length === 0) {
      rows = [];
      Object.values(m.inningsDetails || {}).forEach(inn => rows.push(...(inn.commentary || [])));
    }
    $("commentaryList").innerHTML = rows.length ? rows.map(c => `<div class="comment"><b>${this.safe(c.ball)}</b> ${this.safe(c.text)}</div>`).join("") : "<span class='muted'>No commentary</span>";
  },
  renderStats(m) {
    const rows = this.allBatters(m);
    const fours = rows.reduce((a,b)=>a+Number(b.f||0),0), sixes=rows.reduce((a,b)=>a+Number(b.s||0),0);
    const top=[...rows].sort((a,b)=>Number(b.r||0)-Number(a.r||0))[0];
    const bowl={};
    Object.values(m.inningsDetails||{}).forEach(i=>Object.entries(i.bowlerStats||{}).forEach(([n,s])=>{bowl[n]=bowl[n]||{runs:0,balls:0,wkts:0}; bowl[n].runs+=Number(s.runs||0); bowl[n].balls+=Number(s.balls||0); bowl[n].wkts+=Number(s.wkts||0);}));
    if(!Object.keys(bowl).length) Object.assign(bowl,m.bowlerStats||{});
    const best=Object.entries(bowl).sort((a,b)=>Number(b[1].wkts||0)-Number(a[1].wkts||0))[0];
    const innings = Object.values(m.inningsDetails || {});
    const showFull = m.matchFinished && innings.length;
    const totalRuns = showFull ? innings.reduce((a,i)=>a+Number(i.runs||0),0) : m.runs;
    const totalWkts = showFull ? innings.reduce((a,i)=>a+Number(i.wkts||0),0) : m.wkts;
    const totalBalls = showFull ? innings.reduce((a,i)=>a+Number(i.balls||0),0) : m.balls;
    const fow = showFull ? innings.flatMap(i=>i.fallOfWickets||[]) : (m.fallOfWickets||[]);
    const projected = showFull ? "-" : (m.balls ? Math.round(m.runs/(m.balls/(m.totalOvers*6))) : 0);
    $("statRuns").textContent=totalRuns;$("statWkts").textContent=totalWkts;$("statOvers").textContent=overText(totalBalls);$("statProjected").textContent=projected;$("statFours").textContent=fours;$("statSixes").textContent=sixes;$("statTopBatter").textContent=top?`${top.name} ${top.r}`:"-";$("statBestBowler").textContent=best?`${best[0]} ${best[1].wkts}/${best[1].runs}`:"-";$("fowList").innerHTML=fow.length?fow.map((x,i)=>`<div class="comment">${i+1}. ${this.safe(x)}</div>`).join(""):"<span class='muted'>No wickets</span>";
    this.renderRunGraph(m);
  },
  allBatters(m) { const out=[]; Object.values(m.inningsDetails||{}).forEach(i=>out.push(...(i.battingScorecard||[]))); if(!out.length) out.push(...this.currentBattingRows(m)); return out; },
  renderRunGraph(m) {
    const series = this.graphSeries(m);
    $("graphSummary").textContent = series.length > 1 ? "Innings comparison" : "Live progression";
    $("runGraph").innerHTML = this.runWormSvg(series);
  },
  graphSeries(m) {
    const innings = Object.values(m.inningsDetails || {});
    const source = innings.length ? innings : [{ team: m.battingTeam?.name || "Current", overSummary: m.overSummary || [], runs: m.runs, wkts: m.wkts, balls: m.balls }];
    return source.map((inn, idx) => {
      const points = [{ over: 0, runs: 0, wkts: 0 }];
      let runs = 0, wkts = 0;
      (inn.overSummary || []).forEach((over, i) => {
        (over.timeline || []).forEach(ball => {
          runs += this.ballRuns(ball);
          if (/^W(?!d)|wicket/i.test(String(ball))) wkts += 1;
        });
        points.push({ over: Number(over.overNo || i + 1), runs, wkts });
      });
      if (points.length === 1 && Number(inn.runs || 0)) points.push({ over: Math.max(1, Math.ceil(Number(inn.balls || 0) / 6)), runs: Number(inn.runs || 0), wkts: Number(inn.wkts || 0) });
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
  runWormSvg(series = []) {
    const width = 720, height = 292, pad = 42;
    const all = series.flatMap(s => s.points);
    const maxRuns = Math.max(20, ...all.map(p => p.runs));
    const maxOver = Math.max(1, ...all.map(p => p.over));
    const colors = ["#0f766e", "#2563eb", "#dc2626", "#7c3aed"];
    const x = over => pad + (Number(over || 0) / maxOver) * (width - pad * 2);
    const y = runs => height - pad - (Number(runs || 0) / maxRuns) * (height - pad * 2);
    const grid = [0,.2,.4,.6,.8,1].map(v => {
      const gy = y(maxRuns * v);
      return `<line x1="${pad}" y1="${gy}" x2="${width-pad}" y2="${gy}" class="graph-grid"/><text x="10" y="${gy+4}" class="graph-label">${Math.round(maxRuns*v)}</text>`;
    }).join("");
    const overTicks = Array.from({ length: Math.min(maxOver, 10) + 1 }, (_, i) => Math.round((maxOver / Math.min(maxOver, 10)) * i)).filter((v, i, arr) => i === 0 || v !== arr[i - 1]).map(over => `<line x1="${x(over)}" y1="${height-pad}" x2="${x(over)}" y2="${height-pad+5}" class="graph-axis"/><text x="${x(over)-4}" y="${height-18}" class="graph-label">${over}</text>`).join("");
    const lines = series.map((s, i) => {
      const d = s.points.map((p, idx) => `${idx ? "L" : "M"}${x(p.over).toFixed(1)},${y(p.runs).toFixed(1)}`).join(" ");
      const points = s.points.map(p => {
        const label = `${this.safe(s.name)} | Over ${p.over} | ${p.runs}/${p.wkts || 0}`;
        return `<circle class="graph-hit" cx="${x(p.over)}" cy="${y(p.runs)}" r="11" data-team="${this.safe(s.name)}" data-over="${p.over}" data-runs="${p.runs}" data-wkts="${p.wkts || 0}"></circle><circle cx="${x(p.over)}" cy="${y(p.runs)}" r="${p.wkts ? 5 : 3.2}" fill="${colors[i%colors.length]}" stroke="#fff" stroke-width="2"><title>${label}</title></circle>`;
      }).join("");
      return `<path d="${d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><text x="${pad + i*154}" y="22" class="graph-key" fill="${colors[i%colors.length]}">${this.safe(s.name)}</text>${points}`;
    }).join("");
    setTimeout(() => this.bindGraphTooltip(), 0);
    return `<div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Run progression graph"><rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>${grid}${overTicks}<line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" class="graph-axis"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}" class="graph-axis"/>${lines}<text x="${width/2-28}" y="${height-4}" class="graph-label">Overs</text></svg><div id="graphTooltip" class="graph-tooltip hidden"></div></div>`;
  },
  bindGraphTooltip() {
    const box = $("runGraph");
    const tip = $("graphTooltip");
    if (!box || !tip || box.dataset.tooltipBound === "1") return;
    box.dataset.tooltipBound = "1";
    const show = (target, ev) => {
      const rect = box.getBoundingClientRect();
      tip.innerHTML = `<b>${target.dataset.team}</b><span>Over ${target.dataset.over}</span><strong>${target.dataset.runs}/${target.dataset.wkts}</strong>`;
      tip.classList.remove("hidden");
      tip.style.left = `${Math.min(rect.width - 130, Math.max(8, ev.clientX - rect.left + 12))}px`;
      tip.style.top = `${Math.max(8, ev.clientY - rect.top - 58)}px`;
    };
    box.addEventListener("pointermove", e => {
      const target = e.target.closest?.(".graph-hit");
      if (!target) return tip.classList.add("hidden");
      show(target, e);
    });
    box.addEventListener("pointerleave", () => tip.classList.add("hidden"));
    box.addEventListener("click", e => {
      const target = e.target.closest?.(".graph-hit");
      if (target) show(target, e);
    });
  },
  renderPlayers(m) { const blocks=[]; Object.entries(m.teams||{}).forEach(([team,players]) => (players||[]).forEach(p => { const meta=m.teamInfo?.[team]?.players?.[p]||{}; const st=this.playerStats(p,team); blocks.push(`<div class="player" onclick="app.playerModal('${encodeURIComponent(team)}','${encodeURIComponent(p)}')"><div class="avatar">${meta.image?`<img src="${this.safe(meta.image)}">`:this.short(p).slice(0,2)}</div><b>${this.safe(p)}</b><br><small>${this.safe(team)}</small><div class="mini-line">${st.runs} runs · ${st.wkts} wkts</div></div>`); })); $("playersList").innerHTML = blocks.join("") || "<span class='muted'>No players</span>"; },
  renderMatches() { const current = this.state?.matchId ? `<div class="match-card-mini"><b>${this.safe(this.state.matchTitle)}</b><br><small>Current · ${this.state.runs}/${this.state.wkts} (${overText(this.state.balls)})</small></div>` : ""; const history = this.completed.map(m => `<div class="match-card-mini" onclick="location.href='user.html?match=${m.matchId}'"><b>${this.safe(m.matchTitle||m.title||'Match')}</b><br><small>${this.safe(m.winnerText||'')}<br>${this.safe(m.firstInnings||'')} ${m.secondInnings?' | '+this.safe(m.secondInnings):''}</small></div>`).join(""); $("matchesList").innerHTML = current + history || "<span class='muted'>No matches</span>"; },
  renderLeague(m) { const l=m.league||{}; const schedule=Array.isArray(l.schedule)?l.schedule:[]; const teams=Array.isArray(l.teams)?l.teams:[]; $("leagueTitle").textContent=l.name||"League";$("leagueTeams").textContent=teams.length;$("leagueMatches").textContent=schedule.length;$("leagueDone").textContent=schedule.filter(x=>x.status==='completed'||x.status==='done').length;$("leaguePending").textContent=schedule.filter(x=>!(x.status==='completed'||x.status==='done')).length; const filtered=this.filterSchedule(schedule); $("leagueSchedule").innerHTML=filtered.map(x=>{ const result=x.result||x.winnerText||""; const score=[x.firstInnings,x.secondInnings].filter(Boolean).join(" | "); const when=[x.matchDate,x.matchTime].filter(Boolean).join(" "); const meta=[x.stage||'League',x.round,x.status||'pending'].filter(Boolean).join(" · "); return `<div class="match-card-mini fixture-card"><div class="fixture-top">${when?`<span>${this.safe(when)}</span>`:`<span>Time TBA</span>`}<b>${this.safe(x.status||'pending')}</b></div><strong>${this.safe(x.teamA?.name||x.teamA)} vs ${this.safe(x.teamB?.name||x.teamB)}</strong><small>${this.safe(meta)}</small>${x.venue?`<small>${this.safe(x.venue)}</small>`:""}${result?`<b class="fixture-result">${this.safe(result)}</b>`:""}${score?`<small>${this.safe(score)}</small>`:""}</div>`; }).join("")||"<span class='muted'>No schedule</span>"; },
  filterSchedule(schedule) {
    const done = x => ["completed", "done", "no-result", "cancelled"].includes(String(x.status || "").toLowerCase());
    if (this.scheduleFilter === "upcoming") return schedule.filter(x => !done(x));
    if (this.scheduleFilter === "completed") return schedule.filter(done);
    if (this.scheduleFilter === "playoffs") return schedule.filter(x => /qualifier|eliminator|final|semi/i.test(`${x.stage || ""} ${x.round || ""}`));
    return schedule;
  },
  renderPoints(m) { const l=m.league||{}; const pts=m.pointsTable||l.pointsTable||{}; $("pointsTitle").textContent = `${l.name || "League"} Points Table`; const rows=Object.entries(pts).sort((a,b)=>Number(b[1].Pts||0)-Number(a[1].Pts||0)||this.nrrValue(b[1])-this.nrrValue(a[1])||Number(b[1].W||0)-Number(a[1].W||0)||String(a[0]).localeCompare(String(b[0]))); $("pointsTable").innerHTML=rows.map(([t,p],i)=>`<tr><td><b>${i+1}. ${this.safe(t)}</b></td><td>${p.P||0}</td><td>${p.W||0}</td><td>${p.L||0}</td><td>${p.T||0}</td><td>${p.NR||0}</td><td><b>${p.Pts||0}</b></td><td class="${this.nrrValue(p)>=0?'positive':'negative'}">${this.nrr(p)}</td></tr>`).join("")||`<tr><td colspan="8">No points</td></tr>`; },
  async playerModal(teamEnc, playerEnc) {
    const team = decodeURIComponent(teamEnc);
    const player = decodeURIComponent(playerEnc);
    let stats = this.playerStats(player, team);
    const playerId = this.state.teamInfo?.[team]?.players?.[player]?.playerId || "";
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
        <div class="avatar xl">${this.playerImageHtml(player, team)}</div>
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
      <div class="profile-list">${row.players.map(p => `<button onclick="app.playerModal('${encodeURIComponent(row.name)}','${encodeURIComponent(p)}')">${this.safe(p)}</button>`).join("") || "<span class='muted'>No players</span>"}</div>
      <h3 style="margin:16px 0 8px">Recent Matches</h3>
      ${recent.length ? recent.map(x => `<div class="comment"><b>${this.safe(x.matchTitle || x.title || "Match")}</b><br><small>${this.safe(x.winnerText || "Result pending")}</small></div>`).join("") : "<span class='muted'>No recent matches</span>"}
    `;
    $("modal").classList.add("show");
  },
  playerImageHtml(player, team) {
    const meta = this.state.teamInfo?.[team]?.players?.[player] || {};
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
  playerStats(player, teamName = "") {
    const meta = teamName ? (this.state.teamInfo?.[teamName]?.players?.[player] || {}) : {};
    const targetPlayerId = meta.playerId || "";
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
        Object.entries(inn.bowlerStats || {}).forEach(([name, stat]) => { if (addBowler(name, stat, bowlingTeam)) seen = true; });
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
        Object.entries(scorecard.bowlerStats || {}).forEach(([name, stat]) => { if (addBowler(name, stat, legacyBowlingTeam)) seen = true; });
        Object.entries(match.bowlerStats || {}).forEach(([name, stat]) => { if (addBowler(name, stat, legacyBowlingTeam)) seen = true; });
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
