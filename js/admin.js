import { cloudinaryConfig } from "../firebase/firebase-config.js";
import {
  loginAdmin, logoutAdmin, watchAuth, isAdmin,
  saveTeam, deleteTeam, listenTeams, savePlayer, deletePlayer, listenPlayers,
  getTeamsWithPlayers, saveLeague, deleteLeague, listenLeagues,
  saveMatch, saveCompletedMatch, listenCompletedMatches, updateCompletedMatchMvp, deleteCompletedMatch, getStoredScorecard, savePlayerMatchStats, saveSavedLink, makeId, safeId
} from "./firebase-store.js";
import { writeLiveMatch } from "./firebase-live.js";
import { livePayload, storePayload, normalizeState, normalizeBatter, overText, calcSR, calcER, clone } from "./live-sync.js";

const $ = (id) => document.getElementById(id);
const todayKey = () => new Date().toISOString().slice(0, 10).replaceAll("-", "");
const ACTIVE_MATCH_KEY = "cricket_admin_active_match_backup";
const MANUAL_SCORE_KEY = (matchId) => `cricket_admin_manual_score_checkpoint_${matchId || "none"}`;

const blankState = () => normalizeState({
  matchId: "",
  matchTitle: "No Match",
  leagueId: "",
  leagueName: "",
  venue: "",
  matchDate: "",
  matchTime: "",
  matchType: "T20",
  liveStarted: false,
  matchFinished: false,
  status: "idle",
  scoringLocked: false,
  liveControl: { mode: "live", note: "Live" },
  teamA: null,
  teamB: null,
  battingTeam: null,
  bowlingTeam: null,
  tossWinner: "",
  tossDecision: "bat",
  tossText: "Toss pending",
  inningNumber: 1,
  totalOvers: 20,
  runs: 0,
  wkts: 0,
  balls: 0,
  extras: 0,
  target: null,
  firstInnings: "",
  secondInnings: "",
  firstInningsScore: null,
  firstInningsWkts: null,
  bat1: normalizeBatter({ name: "-" }),
  bat2: normalizeBatter({ name: "-" }),
  striker: 1,
  bowler: { name: "-", playerId: "", balls: 0, r: 0, w: 0, runs: 0, wkts: 0, dots: 0, wides: 0, noBalls: 0 },
  bowlerStats: {},
  battingScorecard: [],
  completedInnings: {},
  completedBowling: {},
  inningsDetails: {},
  commentary: [],
  over: [],
  overSummary: [],
  recentBalls: [],
  fallOfWickets: [],
  partnershipRuns: 0,
  partnershipBalls: 0,
  lastWicket: "-",
  highlights: [],
  teamInfo: {},
  teams: {},
  pointsTable: {},
  league: null,
  winnerText: "",
  mvp: "",
  playerOfMatch: "",
  followLink: "",
  dismissed: [],
  retired: [],
  undoStack: [],
  lastOverBowler: ""
});

window.app = {
  uid: "",
  adminOk: false,
  teams: [],
  leagues: [],
  completed: [],
  selectedTeamId: "",
  selectedPlayerId: "",
  activeUnsubPlayers: null,
  currentMatchId: "",
  state: blankState(),
  pendingWicket: null,
  matchCounter: Number(localStorage.getItem("matchCounter") || "0"),

  init() {
    this.bindBaseEvents();
    watchAuth(async (user) => {
      if (!user) return this.showLogin();
      this.uid = user.uid;
      try {
        this.adminOk = await isAdmin(user.uid);
      } catch (e) {
        this.toast("Admin check failed: " + e.message, true);
        return this.showLogin();
      }
      if (!this.adminOk) {
        this.toast("यह account admin नहीं है. Firestore admins/{uid} check करें.", true);
        await logoutAdmin().catch(() => {});
        return this.showLogin();
      }
      this.showAdmin();
      this.startListeners();
    });
  },

  bindBaseEvents() {
    $("loginBtn").onclick = () => this.login();
    $("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") this.login(); });
    $("logoutBtn").onclick = () => logoutAdmin();
    document.querySelectorAll(".tab").forEach(btn => btn.onclick = () => this.openPage(btn.dataset.page));
    ["teamASelect", "teamBSelect", "tossDecision", "tossWinner", "openingStriker"].forEach(id => $(id).addEventListener("change", () => this.refreshSetupPlayers()));
    $("startMatchBtn").onclick = () => this.startMatch();
    $("copyLinkBtn").onclick = () => this.copyPublicLink();
    $("openUserBtn").onclick = () => window.open(this.publicLink(), "_blank");
    document.querySelectorAll(".run-grid button").forEach(b => b.onclick = () => this.scoreBall(b.dataset.custom ? "custom" : Number(b.textContent)));
    $("wicket").onchange = () => { if ($("wicket").checked) this.openWicketModal(); else this.pendingWicket = null; };
    $("clearTypesBtn").onclick = () => this.clearBallTypes();
    $("undoBtn").onclick = () => this.undo();
    $("swapBtn").onclick = () => { this.swapStrike(); this.render(); this.pushLive(); };
    $("retireBtn").onclick = () => this.retireBatsman();
    $("changeBatsmanBtn").onclick = () => this.changeBatsman();
    $("changeBowlerBtn").onclick = () => this.changeBowler(true);
    $("switchInningsBtn").onclick = () => this.askSwitchInnings();
    $("manualSaveBtn").onclick = () => this.manualSaveScore();
    $("completeBtn").onclick = () => this.completeMatch();
    $("lockBtn").onclick = () => this.setLock(true);
    $("unlockBtn").onclick = () => this.setLock(false);
    document.querySelectorAll(".mode").forEach(b => b.onclick = () => this.setMode(b.dataset.mode));
    $("saveTeamBtn").onclick = () => this.saveTeamForm();
    $("newTeamBtn").onclick = () => this.clearTeamForm();
    $("deleteTeamBtn").onclick = () => this.deleteSelectedTeam();
    $("savePlayerBtn").onclick = () => this.savePlayerForm();
    $("newPlayerBtn").onclick = () => this.clearPlayerForm();
    $("deletePlayerBtn").onclick = () => this.deleteSelectedPlayer();
    $("teamLogoFile").onchange = e => this.uploadImage(e.target.files[0], "teamLogo");
    $("playerImageFile").onchange = e => this.uploadImage(e.target.files[0], "playerImage");
    $("leagueLogoFile").onchange = e => this.uploadImage(e.target.files[0], "leagueLogo");
    $("generateScheduleBtn").onclick = () => this.generateSchedule();
    $("saveLeagueBtn").onclick = () => this.saveLeagueForm();
    $("clearLeagueBtn").onclick = () => this.clearLeagueForm();
    this.bindPicker();
    this.bindWicketModal();
    this.bindInningsModal();
  },

  async login() {
    $("loginMessage").textContent = "";
    try {
      await loginAdmin($("loginEmail").value.trim(), $("loginPassword").value);
    } catch (e) {
      $("loginMessage").textContent = this.authError(e.code || e.message);
    }
  },
  authError(code) {
    if (String(code).includes("invalid")) return "Email/password galat hai.";
    if (String(code).includes("permission")) return "Permission denied.";
    return String(code);
  },
  showLogin() { $("loginScreen").classList.remove("hidden"); $("adminApp").classList.add("hidden"); },
  showAdmin() { $("loginScreen").classList.add("hidden"); $("adminApp").classList.remove("hidden"); },

  startListeners() {
    listenTeams((teams) => { this.teams = teams; this.renderTeams(); this.fillTeamSelectors(); this.renderLeagueTeamChecks(); }, e => this.toast(e.message, true));
    listenLeagues((leagues) => { this.leagues = leagues; this.fillLeagueSelectors(); this.renderLeagueSchedule(); }, e => this.toast(e.message, true));
    listenCompletedMatches((rows) => { this.completed = rows; this.renderHistory(); }, e => this.toast(e.message, true));
    this.restoreActiveMatch();
    this.render();
  },

  getActiveBackup() {
    try {
      const activeRaw = localStorage.getItem(ACTIVE_MATCH_KEY);
      const active = activeRaw ? JSON.parse(activeRaw) : null;
      const activeId = active?.state?.matchId || active?.matchId || "";

      // Manual Save Score checkpoint is trusted more than auto backup.
      // This prevents refresh/continue from returning to an older auto backup.
      if (activeId) {
        const manualRaw = localStorage.getItem(MANUAL_SCORE_KEY(activeId));
        const manual = manualRaw ? JSON.parse(manualRaw) : null;
        if (manual?.state?.matchId && !manual.state.matchFinished) {
          if (!active?.state || Number(manual.savedAt || 0) >= Number(active.savedAt || 0)) return manual;
        }
      }

      if (!active?.state?.matchId || active.state.matchFinished) return null;
      return active;
    } catch (error) {
      console.warn("Active match backup read failed", error);
      return null;
    }
  },

  persistActiveMatch() {
    try {
      if (!this.state?.matchId || this.state.matchFinished) {
        localStorage.removeItem(ACTIVE_MATCH_KEY);
        return;
      }
      const backup = clone(normalizeState(this.state));
      backup.undoStack = (backup.undoStack || []).slice(-8);

      // Do not allow an older/stale auto backup to replace a newer manual checkpoint.
      const manualRaw = localStorage.getItem(MANUAL_SCORE_KEY(backup.matchId));
      const manual = manualRaw ? JSON.parse(manualRaw) : null;
      const manualAt = Number(manual?.savedAt || 0);
      const now = Date.now();
      if (manualAt && manualAt > now + 5000) return;

      localStorage.setItem(ACTIVE_MATCH_KEY, JSON.stringify({ matchId: backup.matchId, savedAt: now, state: backup }));
    } catch (error) {
      console.warn("Active match backup save failed", error);
    }
  },

  clearActiveMatchBackup() {
    try {
      const id = this.state?.matchId || this.currentMatchId || "";
      localStorage.removeItem(ACTIVE_MATCH_KEY);
      if (id) localStorage.removeItem(MANUAL_SCORE_KEY(id));
    } catch (_) {}
  },

  restoreActiveMatch() {
    const saved = this.getActiveBackup();
    if (!saved) return false;
    this.state = normalizeState(saved.state);
    this.currentMatchId = this.state.matchId;
    this.setSync("Recovered local live match backup");
    return true;
  },

  async continueRecoveredMatch() {
    const saved = this.getActiveBackup();
    if (!saved) return this.toast("Continue backup नहीं मिला", true);
    this.state = normalizeState(saved.state);
    this.currentMatchId = this.state.matchId;
    this.openPage("live");
    this.render();
    await this.saveAll(true);
    this.toast("Match वहीं से continue हो गया");
  },

  openPage(page) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    $(page).classList.add("active");
    document.querySelector(`.tab[data-page="${page}"]`).classList.add("active");
    this.render();
  },

  fillTeamSelectors() {
    const opts = this.teams.map(t => `<option value="${t.teamId}">${this.safe(t.name)}</option>`).join("");
    ["teamASelect", "teamBSelect", "tossWinner"].forEach(id => $(id).innerHTML = `<option value="">Select</option>${opts}`);
    if (this.teams[0] && !$("teamASelect").value) $("teamASelect").value = this.teams[0].teamId;
    if (this.teams[1] && !$("teamBSelect").value) $("teamBSelect").value = this.teams[1].teamId;
    $("tossWinner").value = $("teamASelect").value;
    this.refreshSetupPlayers();
  },

  fillLeagueSelectors() {
    $("setupLeague").innerHTML = `<option value="">No League</option>` + this.leagues.map(l => `<option value="${l.leagueId}">${this.safe(l.name)}</option>`).join("");
  },

  async refreshSetupPlayers() {
    const teamA = this.teamById($("teamASelect").value);
    const teamB = this.teamById($("teamBSelect").value);

    // Toss winner must be only Team A or Team B. Earlier it allowed any saved team,
    // which could accidentally create a match with a third team batting/bowling.
    const tossSelect = $("tossWinner");
    const selectedTeams = [teamA, teamB].filter(Boolean);
    const previousToss = tossSelect.value;
    tossSelect.innerHTML = selectedTeams.map(t => `<option value="${t.teamId}">${this.safe(t.name)}</option>`).join("");
    if (selectedTeams.some(t => t.teamId === previousToss)) tossSelect.value = previousToss;
    else if (teamA) tossSelect.value = teamA.teamId;

    const tossWinnerId = tossSelect.value || teamA?.teamId || "";
    const tossTeam = this.teamById(tossWinnerId);
    const otherTeam = tossTeam?.teamId === teamA?.teamId ? teamB : teamA;
    const batting = $("tossDecision").value === "bat" ? tossTeam : otherTeam;
    const bowling = $("tossDecision").value === "bat" ? otherTeam : tossTeam;
    const batPlayers = batting?.players || [];
    const bowlPlayers = bowling?.players || [];

    const fill = (id, list, keepValue = "") => {
      const el = $(id);
      const oldVal = keepValue || el.value;
      el.innerHTML = list.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
      if (list.some(p => p.playerId === oldVal)) el.value = oldVal;
    };

    fill("openingStriker", batPlayers);
    const strikerId = $("openingStriker").value;
    const nonStrikers = batPlayers.filter(p => p.playerId !== strikerId);
    fill("openingNonStriker", nonStrikers);
    fill("openingBowler", bowlPlayers);

    const warning = (!teamA || !teamB || teamA.teamId === teamB.teamId)
      ? "<br><span style='color:#dc2626'>Please select two different teams.</span>"
      : (!batPlayers.length || batPlayers.length < 2 || !bowlPlayers.length)
        ? "<br><span style='color:#dc2626'>Selected teams need at least 2 batting players and 1 bowler/player.</span>"
        : "";
    $("setupPreview").innerHTML = `<b>${this.safe(teamA?.name || "Team A")} vs ${this.safe(teamB?.name || "Team B")}</b><br>Batting first: ${this.safe(batting?.name || "-")}<br>Bowling first: ${this.safe(bowling?.name || "-")}${warning}`;
  },

  teamById(id) { return this.teams.find(t => t.teamId === id) || null; },
  playerById(team, id) { return (team?.players || []).find(p => p.playerId === id) || null; },
  teamObj(team) { return team ? { teamId: team.teamId, name: team.name, shortName: team.shortName || this.short(team.name), logo: team.logo || "" } : null; },

  newMatchId() {
    this.matchCounter += 1;
    localStorage.setItem("matchCounter", String(this.matchCounter));
    return `match_${todayKey()}_${String(this.matchCounter).padStart(3, "0")}_${Date.now()}`;
  },

  async startMatch() {
    const teamA = this.teamById($("teamASelect").value);
    const teamB = this.teamById($("teamBSelect").value);
    if (!teamA || !teamB || teamA.teamId === teamB.teamId) return this.toast("दो अलग-अलग teams select करें", true);
    const tossTeam = this.teamById($("tossWinner").value) || teamA;
    if (![teamA.teamId, teamB.teamId].includes(tossTeam.teamId)) return this.toast("Toss winner sirf Team A ya Team B ho sakta hai", true);
    const otherTeam = tossTeam.teamId === teamA.teamId ? teamB : teamA;
    const batting = $("tossDecision").value === "bat" ? tossTeam : otherTeam;
    const bowling = $("tossDecision").value === "bat" ? otherTeam : tossTeam;
    const totalOvers = Number($("totalOvers").value || 0);
    if (!Number.isFinite(totalOvers) || totalOvers <= 0) return this.toast("Total overs 1 ya usse zyada hona चाहिए", true);
    const striker = this.playerById(batting, $("openingStriker").value);
    const nonStriker = this.playerById(batting, $("openingNonStriker").value);
    const bowler = this.playerById(bowling, $("openingBowler").value);
    if (!striker || !nonStriker || !bowler) return this.toast("Opening striker, non-striker और bowler select करें", true);
    if (striker.playerId === nonStriker.playerId) return this.toast("Striker और non-striker same नहीं हो सकते", true);
    const league = this.leagues.find(l => l.leagueId === $("setupLeague").value) || null;
    const matchId = this.newMatchId();
    this.currentMatchId = matchId;
    this.state = blankState();
    Object.assign(this.state, {
      matchId,
      matchTitle: `${teamA.name} vs ${teamB.name}`,
      leagueId: league?.leagueId || "",
      leagueName: league?.name || "",
      league: league || null,
      venue: $("venue").value.trim(),
      matchDate: $("matchDate").value,
      matchTime: $("matchTime").value,
      matchType: $("matchType").value.trim() || "T20",
      liveStarted: true,
      status: "live",
      teamA: this.teamObj(teamA),
      teamB: this.teamObj(teamB),
      battingTeam: this.teamObj(batting),
      bowlingTeam: this.teamObj(bowling),
      firstBattingTeam: this.teamObj(batting),
      secondBattingTeam: this.teamObj(bowling),
      tossWinner: tossTeam.name,
      tossDecision: $("tossDecision").value,
      tossText: `${tossTeam.name} chose ${$("tossDecision").value === "bat" ? "bat" : "bowl"}`,
      totalOvers,
      bat1: normalizeBatter({ playerId: striker.playerId, name: striker.name, position: 1 }),
      bat2: normalizeBatter({ playerId: nonStriker.playerId, name: nonStriker.name, position: 2 }),
      bowler: { playerId: bowler.playerId, name: bowler.name, balls: 0, r: 0, w: 0, runs: 0, wkts: 0, dots: 0, wides: 0, noBalls: 0 },
      followLink: $("followLink").value.trim(),
      teams: this.teamsToMap(),
      teamInfo: this.teamInfoMap(),
      pointsTable: league?.pointsTable || {}
    });
    this.persistActiveMatch();
    await this.saveAll(true);
    await saveSavedLink({ matchId, name: this.state.matchTitle, url: this.publicLink(), createdAt: Date.now() });
    $("publicLink").textContent = this.publicLink();
    this.openPage("live");
    this.toast("New match live हो गया");
  },

  teamsToMap() { const out = {}; this.teams.forEach(t => out[t.name] = (t.players || []).map(p => p.name)); return out; },
  teamInfoMap() { const out = {}; this.teams.forEach(t => { out[t.name] = { teamId: t.teamId, shortName: t.shortName || this.short(t.name), logo: t.logo || "", players: {} }; (t.players || []).forEach(p => out[t.name].players[p.name] = { ...p }); }); return out; },
  publicLink() { return new URL(`user.html?match=${this.currentMatchId || this.state.matchId || ""}`, location.href).href; },
  qrCodeUrl(link) { return link ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(link)}` : ""; },
  async copyPublicLink() { const link = this.publicLink(); try { await navigator.clipboard.writeText(link); this.toast("Public link copied"); } catch { prompt("Copy link", link); } },

  async scoreBall(run) {
    const s = this.state = normalizeState(this.state);
    if (!s.matchId) return this.toast("पहले match start करें", true);
    if (s.matchFinished) return this.toast("Match completed है", true);
    if (s.scoringLocked) return this.toast("Scoring locked है", true);
    if (run === "custom") { const v = prompt("Runs"); if (v === null || isNaN(v)) return; run = Number(v); }
    const isWide = $("wide").checked, isNo = $("noball").checked, isBye = $("bye").checked, isLb = $("legbye").checked, isWicket = $("wicket").checked;
    if (isWide && isNo) return this.toast("Wide aur No Ball ek साथ select नहीं हो सकते.", true);
    if (isBye && isLb) return this.toast("Bye aur Leg Bye ek साथ select नहीं हो सकते.", true);
    if (isWide && (isBye || isLb)) return this.toast("Wide ke साथ Bye/Leg Bye select न करें. Wide runs को run button से add करें.", true);
    if (isWicket && !this.pendingWicket) return this.openWicketModal();
    if (isNo && isWicket && !["Run Out", "Retired Out"].includes(this.pendingWicket?.type)) {
      $("wicket").checked = false;
      this.pendingWicket = null;
      return this.toast("No-ball par Bowled/LBW/Caught/Stumping/Hit Wicket valid nahi. Sirf Run Out use करें.", true);
    }
    this.pushUndo();

    const runValue = Number(run || 0);
    const legal = !(isWide || isNo);
    const extraBase = isWide || isNo ? 1 : 0;
    const totalRuns = runValue + extraBase;
    const batRuns = (isWide || isBye || isLb) ? 0 : runValue;
    const extraRuns = totalRuns - batRuns;
    const bowlerRuns = (isBye || isLb) ? extraBase : totalRuns;
    const striker = s.striker === 1 ? s.bat1 : s.bat2;
    const bowlerKey = s.bowler.name || "-";
    if (!s.bowlerStats[bowlerKey]) s.bowlerStats[bowlerKey] = { playerId: s.bowler.playerId || "", balls: 0, runs: 0, wkts: 0, dots: 0, wides: 0, noBalls: 0 };
    const bs = s.bowlerStats[bowlerKey];

    s.runs += totalRuns;
    s.extras += extraRuns;
    s.partnershipRuns += totalRuns;
    s.bowler.r += bowlerRuns;
    s.bowler.runs += bowlerRuns;
    bs.runs += bowlerRuns;
    if (isWide) bs.wides += 1;
    if (isNo) bs.noBalls += 1;
    if (legal) {
      s.balls += 1;
      s.bowler.balls += 1;
      bs.balls += 1;
      s.partnershipBalls += 1;
      striker.b += 1;
      if (batRuns === 0 && !isBye && !isLb) { s.bowler.dots += 1; bs.dots += 1; }
    }
    if (batRuns) striker.r += batRuns;
    if (legal && batRuns === 0) { striker.dots = Number(striker.dots || 0) + 1; striker.d = Number(striker.d || 0) + 1; }
    if (batRuns === 4) { striker.f += 1; striker.fours += 1; }
    if (batRuns === 6) { striker.s += 1; striker.sixes += 1; }

    let label = this.ballLabel(run, { isWide, isNo, isBye, isLb, isWicket });
    if (isWicket) label = this.applyWicket(label, legal, bowlerKey, bs);

    s.over.push(label);
    const ballNo = overText(s.balls);
    const text = this.commentaryText(ballNo, striker.name, bowlerKey, label, { run, isWide, isNo, isBye, isLb, isWicket });
    s.commentary.unshift({ ball: ballNo, text, time: new Date().toLocaleTimeString() });
    s.recentBalls.unshift({ ball: ballNo, label, text, score: `${s.runs}/${s.wkts} (${overText(s.balls)})` });
    s.recentBalls = s.recentBalls.slice(0, 20);
    if (batRuns === 4 || batRuns === 6) s.highlights.unshift({ text: `${batRuns === 4 ? "FOUR" : "SIX"} by ${striker.name}`, time: new Date().toLocaleTimeString() });

    const maxBalls = Number(s.totalOvers || 20) * 6;
    const chaseComplete = s.inningNumber > 1 && s.target && s.runs >= s.target;
    const allOut = s.wkts >= Math.max(this.currentBattingPlayers().length - 1, 1);
    const inningsOver = (legal && s.balls >= maxBalls) || allOut;

    if (isWicket && !allOut && !chaseComplete && !inningsOver) await this.promptNextBatsman();
    if (runValue % 2 === 1) this.swapStrike(false);

    if (legal && s.balls % 6 === 0 && !inningsOver && !chaseComplete) {
      this.finishOver();
      this.swapStrike(false);
      this.render();
      await this.saveAll(true);
      await this.changeBowler(false);
      await this.saveAll(true);
    }

    if (s.inningNumber === 1 && inningsOver) {
      this.finishOver(true);
      await this.askSwitchInnings();
    } else if (s.inningNumber > 1 && (chaseComplete || inningsOver)) {
      this.finishOver(true);
      await this.finishMatchByCondition();
    }

    this.clearBallTypes();
    this.render();
    await this.saveAll(true);
  },

  ballLabel(run, flags) {
    const n = Number(run || 0);
    // Run-out can happen on Wide/No-Ball. Keep the wicket marker in the label
    // without hiding the extra type, so the ball strip/commentary does not look
    // like a normal legal-ball wicket.
    if (flags.isWicket && flags.isWide) return n ? `W+${n + 1}Wd` : "W+Wd";
    if (flags.isWicket && flags.isNo) return n ? `W+${n + 1}Nb` : "W+Nb";
    if (flags.isWicket) return n ? `W${n}` : "W";
    if (flags.isWide) return n ? `${n + 1}Wd` : "Wd";
    if (flags.isNo) return n ? `${n + 1}Nb` : "Nb";
    if (flags.isBye) return `${run}B`;
    if (flags.isLb) return `${run}LB`;
    return String(run);
  },

  applyWicket(label, legal, bowlerKey, bs) {
    const w = this.pendingWicket || { type: "Bowled" };
    const s = this.state;
    const outName = w.type === "Run Out" ? w.outBatsman : (s.striker === 1 ? s.bat1.name : s.bat2.name);
    const outSlot = s.bat1.name === outName ? 1 : 2;
    const out = outSlot === 1 ? s.bat1 : s.bat2;
    s.wkts += 1;
    const bowlerWicket = !["Run Out", "Retired Out"].includes(w.type);
    if (bowlerWicket) { s.bowler.w += 1; s.bowler.wkts += 1; bs.wkts += 1; }
    out.out = true;
    out.dismissal = `${w.type}${w.helper ? " by " + w.helper : ""}${w.note ? " - " + w.note : ""}`;
    this.upsertBatter({ ...out, out: true });
    if (!s.dismissed.includes(out.name)) s.dismissed.push(out.name);
    s.lastWicket = `${out.name} ${out.dismissal} ${s.runs}/${s.wkts}`;
    s.fallOfWickets.push(`${s.runs}/${s.wkts} (${overText(s.balls)}) - ${out.name} ${out.dismissal}`);
    s.highlights.unshift({ text: `Wicket: ${out.name}`, time: new Date().toLocaleTimeString() });
    s.partnershipRuns = 0; s.partnershipBalls = 0;
    this.lastOutSlot = outSlot;
    this.pendingWicket = null;
    return `${label}`;
  },

  async promptNextBatsman() {
    const playing = this.currentBattingPlayers();
    const current = [this.state.bat1.name, this.state.bat2.name];
    const list = playing.filter(p => !this.state.dismissed.includes(p.name) && !current.includes(p.name));
    const picked = await this.pick("Select New Batsman", list.map(p => p.name), true);
    if (!picked) return;
    const player = playing.find(p => p.name === picked) || { name: picked, playerId: safeId(picked) };
    const next = normalizeBatter({ playerId: player.playerId, name: player.name });
    if (this.lastOutSlot === 1) this.state.bat1 = next; else this.state.bat2 = next;
    this.lastOutSlot = null;
  },

  finishOver(force = false) {
    if (!this.state.over.length) return;
    const overNo = Math.ceil(this.state.balls / 6);
    this.state.overSummary.unshift({ overNo, bowler: this.state.bowler.name, timeline: [...this.state.over] });
    this.state.lastOverBowler = this.state.bowler.name;
    this.state.over = [];
  },

  async changeBowler(manual = true) {
    const list = this.currentBowlingPlayers().filter(p => p.name !== this.state.lastOverBowler && p.name !== this.state.bowler.name);
    const fallback = this.currentBowlingPlayers().filter(p => p.name !== this.state.lastOverBowler);
    const picked = await this.pick(manual ? "Change Bowler" : "Over complete - Select Next Bowler", (list.length ? list : fallback).map(p => p.name), true);
    if (!picked) return;
    const p = this.currentBowlingPlayers().find(x => x.name === picked) || { name: picked, playerId: safeId(picked) };
    this.state.bowler = this.bowlerFromStats(p);
    this.render();
    await this.pushLive();
  },

  async changeBatsman() {
    const slotText = await this.pick("Which batsman change?", [this.state.bat1.name, this.state.bat2.name], true);
    const slot = this.state.bat1.name === slotText ? 1 : 2;
    const other = slot === 1 ? this.state.bat2.name : this.state.bat1.name;
    const list = this.currentBattingPlayers().filter(p => p.name !== other && !this.state.dismissed.includes(p.name));
    const picked = await this.pick("Select Batsman", list.map(p => p.name), true);
    if (!picked) return;
    const old = slot === 1 ? this.state.bat1 : this.state.bat2;
    this.upsertBatter(old);
    const p = list.find(x => x.name === picked) || { name: picked, playerId: safeId(picked) };
    if (slot === 1) this.state.bat1 = normalizeBatter({ playerId: p.playerId, name: p.name }); else this.state.bat2 = normalizeBatter({ playerId: p.playerId, name: p.name });
    this.render(); await this.saveAll(true);
  },

  async retireBatsman() {
    const slotText = await this.pick("Retire which batsman?", [this.state.bat1.name, this.state.bat2.name], true);
    const slot = this.state.bat1.name === slotText ? 1 : 2;
    const old = slot === 1 ? this.state.bat1 : this.state.bat2;
    this.upsertBatter({ ...old, retired: true, out: false, dismissal: "Retired" });
    if (!this.state.retired.includes(old.name)) this.state.retired.push(old.name);
    const other = slot === 1 ? this.state.bat2.name : this.state.bat1.name;
    const list = this.currentBattingPlayers().filter(p => p.name !== other && !this.state.dismissed.includes(p.name) && !this.state.retired.includes(p.name));
    const picked = await this.pick(`Replacement for ${old.name}`, list.map(p => p.name), true);
    if (!picked) return;
    const p = list.find(x => x.name === picked) || { name: picked, playerId: safeId(picked) };
    if (slot === 1) this.state.bat1 = normalizeBatter({ playerId: p.playerId, name: p.name }); else this.state.bat2 = normalizeBatter({ playerId: p.playerId, name: p.name });
    this.state.highlights.unshift({ text: `${old.name} retired`, time: new Date().toLocaleTimeString() });
    this.render(); await this.pushLive();
  },

  async askSwitchInnings() {
    if (!this.state.matchId || this.state.inningNumber > 1) return this.toast("Second innings already running", true);
    if (!confirm("First innings save करके second innings start करें?")) return;
    this.saveCurrentInnings();
    this.state.firstInningsScore = this.state.runs;
    this.state.firstInningsWkts = this.state.wkts;
    this.state.firstInnings = `${this.state.runs}/${this.state.wkts} (${overText(this.state.balls)})`;
    this.state.target = this.state.runs + 1;
    const oldBat = this.state.battingTeam;
    this.state.battingTeam = this.state.bowlingTeam;
    this.state.bowlingTeam = oldBat;
    this.state.inningNumber = 2;
    Object.assign(this.state, { runs: 0, wkts: 0, balls: 0, extras: 0, striker: 1, over: [], recentBalls: [], overSummary: [], commentary: [], fallOfWickets: [], partnershipRuns: 0, partnershipBalls: 0, lastWicket: "-", dismissed: [], retired: [], battingScorecard: [], bowlerStats: {}, lastOverBowler: "" });
    this.state.bat1 = normalizeBatter({ name: "-" });
    this.state.bat2 = normalizeBatter({ name: "-" });
    this.state.bowler = { name: "-", balls: 0, r: 0, w: 0, runs: 0, wkts: 0, dots: 0, wides: 0, noBalls: 0 };
    this.openInningsModal();
  },

  openInningsModal() {
    const bat = this.currentBattingPlayers();
    const bowl = this.currentBowlingPlayers();
    $("inningsTargetText").textContent = `Target: ${this.state.target}`;
    $("nextStriker").innerHTML = bat.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
    $("nextNonStriker").innerHTML = bat.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
    $("nextBowler").innerHTML = bowl.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
    $("inningsModal").classList.add("show");
  },

  bindInningsModal() {
    $("inningsCancel").onclick = () => $("inningsModal").classList.remove("show");
    $("inningsStart").onclick = async () => {
      const bat = this.currentBattingPlayers(), bowl = this.currentBowlingPlayers();
      const s = bat.find(p => p.playerId === $("nextStriker").value);
      const ns = bat.find(p => p.playerId === $("nextNonStriker").value);
      const bo = bowl.find(p => p.playerId === $("nextBowler").value);
      if (!s || !ns || !bo || s.playerId === ns.playerId) return this.toast("Valid striker, non-striker, bowler select करें", true);
      this.state.bat1 = normalizeBatter({ playerId: s.playerId, name: s.name, position: 1 });
      this.state.bat2 = normalizeBatter({ playerId: ns.playerId, name: ns.name, position: 2 });
      this.state.bowler = this.bowlerFromStats(bo);
      $("inningsModal").classList.remove("show");
      await this.saveAll(true); this.render(); this.toast("Second innings started");
    };
  },

  async finishMatchByCondition() {
    const s = this.state;
    const target = Number(s.target || 0);
    if (s.runs >= target) {
      const teamSize = Math.max(this.currentBattingPlayers().length, 2);
      const wktsLeft = Math.max(teamSize - s.wkts - 1, 0);
      const ballsLeft = Math.max(Number(s.totalOvers || 20) * 6 - s.balls, 0);
      s.winnerText = `${s.battingTeam.name} won by ${wktsLeft} wickets (${ballsLeft} balls left)`;
    } else {
      const margin = target - s.runs - 1;
      s.winnerText = margin === 0 ? "Match Tied" : `${s.bowlingTeam.name} won by ${margin} runs`;
    }
    await this.completeMatch(true);
  },

  async completeMatch(auto = false) {
    if (!this.state.matchId) return this.toast("No match", true);
    if (this.state.matchFinished) return this.toast("Match already completed", true);
    if (!auto && Number(this.state.inningNumber || 1) < 2) return this.toast("पहली innings के बाद Complete Match नहीं, Switch Innings use करें.", true);
    if (!auto && !confirm("Complete match and save permanent history?")) return;
    this.saveCurrentInnings();
    if (!this.state.winnerText) this.state.winnerText = this.deriveWinnerText();
    this.state.matchFinished = true;
    this.state.liveStarted = false;
    this.state.status = "completed";
    this.state.scoringLocked = true;
    this.state.liveControl = { mode: "paused", note: "Match Complete" };
    this.state.secondInnings = `${this.state.runs}/${this.state.wkts} (${overText(this.state.balls)})`;
    this.state.mvp = this.calculateMvp();
    this.state.playerOfMatch = this.state.mvp;
    this.updatePointsTable();
    const final = storePayload(this.state, this.state.matchId, this.uid);
    await saveCompletedMatch(this.state.matchId, final);
    await savePlayerMatchStats(this.state.matchId, this.playerStatsForMatch());
    await this.pushLive();
    this.clearActiveMatchBackup();
    this.render();
    this.toast("Match completed और history में save हो गया");
  },

  deriveWinnerText() {
    if (this.state.inningNumber < 2 || !this.state.target) return "Result pending";
    const margin = this.state.target - this.state.runs - 1;
    if (this.state.runs >= this.state.target) return `${this.state.battingTeam.name} won`;
    return margin === 0 ? "Match Tied" : `${this.state.bowlingTeam.name} won by ${margin} runs`;
  },

  saveCurrentInnings() {
    const team = this.state.battingTeam?.name || "Innings";
    this.upsertBatter(this.state.bat1);
    this.upsertBatter(this.state.bat2);
    const detail = {
      team,
      battingTeam: this.state.battingTeam?.name || team,
      bowlingTeam: this.state.bowlingTeam?.name || "",
      runs: this.state.runs,
      wkts: this.state.wkts,
      balls: this.state.balls,
      overs: overText(this.state.balls),
      extras: this.state.extras,
      battingScorecard: clone(this.state.battingScorecard),
      bowlerStats: clone(this.state.bowlerStats),
      fallOfWickets: clone(this.state.fallOfWickets),
      commentary: clone(this.state.commentary),
      overSummary: clone(this.state.overSummary)
    };
    this.state.inningsDetails[team] = detail;
    this.state.completedInnings[team] = detail.battingScorecard;
    this.state.completedBowling[team] = detail.bowlerStats;
  },

  upsertBatter(row) {
    if (!row || !row.name || row.name === "-") return;
    const clean = normalizeBatter(row);
    const i = this.state.battingScorecard.findIndex(x => x.name === clean.name);
    if (i >= 0) this.state.battingScorecard[i] = { ...this.state.battingScorecard[i], ...clean };
    else this.state.battingScorecard.push(clean);
  },

  bowlerFromStats(player = {}) {
    const name = player.name || "-";
    const saved = this.state.bowlerStats?.[name] || {};
    return {
      playerId: player.playerId || saved.playerId || "",
      name,
      balls: Number(saved.balls || 0),
      r: Number(saved.runs ?? saved.r ?? 0),
      w: Number(saved.wkts ?? saved.w ?? 0),
      runs: Number(saved.runs ?? saved.r ?? 0),
      wkts: Number(saved.wkts ?? saved.w ?? 0),
      dots: Number(saved.dots || 0),
      wides: Number(saved.wides || 0),
      noBalls: Number(saved.noBalls || 0)
    };
  },

  playerStatsForMatch() {
    const out = {};
    const teamNames = [this.state.teamA?.name, this.state.teamB?.name].filter(Boolean);
    const oppositeTeam = (batTeam) => teamNames.find(n => n && n !== batTeam) || "";
    Object.values(this.state.inningsDetails || {}).forEach(inn => {
      const bowlingTeam = inn.bowlingTeam || oppositeTeam(inn.team || inn.battingTeam || "");
      (inn.battingScorecard || []).forEach((b, i) => {
        const key = b.playerId || safeId(b.name);
        out[key] = out[key] || { playerId: key, playerName: b.name, teamName: inn.team, runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, bowlingBalls: 0, bowlingRuns: 0 };
        out[key].runs += Number(b.r || 0); out[key].balls += Number(b.b || 0); out[key].dots = Number(out[key].dots || 0) + Number(b.dots || b.d || 0); out[key].battingDots = Number(out[key].battingDots || 0) + Number(b.dots || b.d || 0); out[key].fours += Number(b.f || 0); out[key].sixes += Number(b.s || 0); out[key].strikeRate = calcSR(out[key].runs, out[key].balls); out[key].battingPosition = i + 1;
      });
      Object.entries(inn.bowlerStats || {}).forEach(([name, s]) => {
        const key = s.playerId || safeId(name);
        out[key] = out[key] || { playerId: key, playerName: name, teamName: bowlingTeam, runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, bowlingBalls: 0, bowlingRuns: 0 };
        out[key].wickets += Number(s.wkts || 0); out[key].bowlingBalls += Number(s.balls || 0); out[key].bowlingRuns += Number(s.runs || 0); out[key].bowlingDots = Number(out[key].bowlingDots || 0) + Number(s.dots || 0); out[key].economy = calcER(out[key].bowlingRuns, out[key].bowlingBalls);
      });
    });
    return out;
  },

  calculateMvp() {
    const stats = Object.values(this.playerStatsForMatch());
    const best = stats.sort((a, b) => ((b.runs || 0) + (b.wickets || 0) * 25) - ((a.runs || 0) + (a.wickets || 0) * 25))[0];
    return best ? best.playerName : "";
  },

  pointsBallsForTeam(teamName, innings = {}) {
    const normalBalls = Number(innings.balls || 0);
    const players = Object.keys(this.state.teamInfo?.[teamName]?.players || {}).length || (this.state.teams?.[teamName] || []).length || 0;
    const allOut = Number(innings.wkts || 0) >= Math.max(players - 1, 1);
    return allOut ? Number(this.state.totalOvers || 20) * 6 : normalBalls;
  },

  updatePointsTable() {
    const league = this.state.league;
    if (!league) return;
    const pts = this.state.pointsTable || {};
    const a = this.state.teamA.name, b = this.state.teamB.name;
    [a, b].forEach(t => pts[t] = pts[t] || { P: 0, W: 0, L: 0, T: 0, NR: 0, Pts: 0, RF: 0, BF: 0, RA: 0, BA: 0 });
    pts[a].P++; pts[b].P++;

    const innA = this.state.inningsDetails?.[a] || {};
    const innB = this.state.inningsDetails?.[b] || {};
    pts[a].RF += Number(innA.runs || 0);
    pts[a].BF += this.pointsBallsForTeam(a, innA);
    pts[a].RA += Number(innB.runs || 0);
    pts[a].BA += this.pointsBallsForTeam(b, innB);
    pts[b].RF += Number(innB.runs || 0);
    pts[b].BF += this.pointsBallsForTeam(b, innB);
    pts[b].RA += Number(innA.runs || 0);
    pts[b].BA += this.pointsBallsForTeam(a, innA);

    if (/tied/i.test(this.state.winnerText)) { pts[a].T++; pts[b].T++; pts[a].Pts++; pts[b].Pts++; }
    else if (this.state.winnerText.startsWith(a)) { pts[a].W++; pts[b].L++; pts[a].Pts += 2; }
    else if (this.state.winnerText.startsWith(b)) { pts[b].W++; pts[a].L++; pts[b].Pts += 2; }
    this.state.pointsTable = pts;
    league.pointsTable = pts;
    saveLeague(league).catch(console.warn);
  },

  currentBattingPlayers() { const team = this.teams.find(t => t.teamId === this.state.battingTeam?.teamId); return team?.players || []; },
  currentBowlingPlayers() { const team = this.teams.find(t => t.teamId === this.state.bowlingTeam?.teamId); return team?.players || []; },
  swapStrike(render = true) { this.state.striker = this.state.striker === 1 ? 2 : 1; if (render) this.render(); },
  setLock(flag) { this.state.scoringLocked = flag; this.render(); this.pushLive(); },
  setMode(mode) { this.state.liveControl = { mode, note: mode }; this.render(); this.pushLive(); },
  clearBallTypes() { ["wide", "noball", "bye", "legbye", "wicket"].forEach(id => $(id).checked = false); this.pendingWicket = null; },
  pushUndo() { this.state.undoStack.push(clone(this.state)); if (this.state.undoStack.length > 25) this.state.undoStack.shift(); },
  async undo() { const prev = this.state.undoStack.pop(); if (!prev) return this.toast("Undo empty", true); this.state = normalizeState(prev); this.render(); await this.saveAll(false); },
  commentaryText(ballNo, batter, bowler, label, flags) { if (flags.isWicket) return `${ballNo}: ${bowler} to ${batter}, wicket! ${label}`; if (flags.isWide) return `${ballNo}: wide ball, ${label}`; if (flags.isNo) return `${ballNo}: no ball, ${label}`; return `${ballNo}: ${bowler} to ${batter}, ${label}`; },

  bindWicketModal() {
    document.querySelectorAll(".wicket-types button").forEach(b => b.onclick = () => { document.querySelectorAll(".wicket-types button").forEach(x => x.classList.remove("active")); b.classList.add("active"); this.refreshWicketOutVisibility(); });
    $("wicketCancel").onclick = () => { $("wicketModal").classList.remove("show"); $("wicket").checked = false; this.pendingWicket = null; };
    $("wicketDone").onclick = () => {
      const type = document.querySelector(".wicket-types button.active").dataset.type;
      this.pendingWicket = { type, outBatsman: $("outBatsmanSelect").value, helper: $("wicketHelper").value.trim(), note: $("dismissalNote").value.trim() };
      $("wicket").checked = true;
      $("wicketModal").classList.remove("show");
    };
  },
  openWicketModal() {
    const striker = this.state.striker === 1 ? this.state.bat1.name : this.state.bat2.name;
    const non = this.state.striker === 1 ? this.state.bat2.name : this.state.bat1.name;
    $("outBatsmanSelect").innerHTML = `<option value="${this.safe(striker)}">Striker - ${this.safe(striker)}</option><option value="${this.safe(non)}">Non-Striker - ${this.safe(non)}</option>`;
    $("wicketHelper").value = ""; $("dismissalNote").value = "";
    this.refreshWicketOutVisibility();
    $("wicketModal").classList.add("show");
  },
  refreshWicketOutVisibility() {
    const type = document.querySelector(".wicket-types button.active")?.dataset.type || "Bowled";
    const show = type === "Run Out";
    $("outBatsmanLabel").style.display = show ? "block" : "none";
    $("outBatsmanSelect").style.display = show ? "block" : "none";
  },

  bindPicker() {
    $("pickerCancel").onclick = () => this.closePicker(null);
    $("pickerOk").onclick = () => this.closePicker($("pickerManual").value.trim());
    $("mvpCancel").onclick = () => this.closeMvpModal();
  },
  pick(title, list = [], required = false) {
    return new Promise(resolve => {
      this.pickerResolve = (val) => { if (required && !val) return this.toast("Selection required", true); $("pickerModal").classList.remove("show"); resolve(val); };
      $("pickerTitle").textContent = title;
      $("pickerManual").value = "";
      $("pickerList").innerHTML = list.length ? list.map(x => `<button class="picker-option" data-name="${this.safe(x)}">${this.safe(x)}</button>`).join("") : `<div class="item">No players. Type manually.</div>`;
      document.querySelectorAll(".picker-option").forEach(b => b.onclick = () => this.closePicker(b.dataset.name));
      $("pickerModal").classList.add("show");
    });
  },
  closePicker(val) { if (this.pickerResolve) this.pickerResolve(val); },

  async manualSaveScore() {
    if (!this.state?.matchId) return this.toast("पहले match start करें", true);
    try {
      this.setSync("Manual Save Score...");
      // Freeze current score as trusted checkpoint. Undo history is cleared intentionally.
      this.state = normalizeState(this.state);
      this.state.undoStack = [];
      this.state.manualSavedAt = Date.now();
      this.state.lastManualSaveText = `${this.state.runs}/${this.state.wkts} (${overText(this.state.balls)})`;

      const checkpoint = clone(this.state);
      checkpoint.undoStack = [];
      localStorage.setItem(MANUAL_SCORE_KEY(checkpoint.matchId), JSON.stringify({
        matchId: checkpoint.matchId,
        savedAt: Date.now(),
        state: checkpoint
      }));
      localStorage.setItem(ACTIVE_MATCH_KEY, JSON.stringify({
        matchId: checkpoint.matchId,
        savedAt: Date.now(),
        state: checkpoint
      }));

      await this.pushLive();
      await saveMatch(this.state.matchId, storePayload(this.state, this.state.matchId, this.uid));

      this.setSync("Manual Score Saved");
      this.toast(`Score saved: ${this.state.lastManualSaveText}`);
      this.render();
    } catch (error) {
      console.error(error);
      this.toast("Save Score failed: " + error.message, true);
      this.setSync("Manual Save Failed");
    }
  },

  async saveAll(force) {
    if (!this.state?.matchId) return;
    this.persistActiveMatch();
    await this.pushLive();
    await saveMatch(this.state.matchId, storePayload(this.state, this.state.matchId, this.uid));
    this.persistActiveMatch();
    this.setSync(force ? "Firestore + Realtime saved" : "Live saved");
  },
  async pushLive() { if (!this.state.matchId) return; this.persistActiveMatch(); await writeLiveMatch(this.state.matchId, livePayload(this.state, this.state.matchId, this.uid)); },
  setSync(text) { $("syncStatus").textContent = text; setTimeout(() => $("syncStatus").textContent = "Ready", 1500); },

  render() {
    const s = this.state = normalizeState(this.state);
    $("topTitle").textContent = s.matchTitle || "Cricket Admin";
    $("topSub").textContent = s.matchId || "No match started";
    $("topStatus").textContent = s.matchFinished ? "COMPLETE" : (s.liveStarted ? (s.liveControl.mode || "LIVE").toUpperCase() : "NO LIVE");
    $("topStatus").className = `status-pill ${s.matchFinished ? "complete" : (s.liveStarted ? "live" : "")}`;
    $("runs").textContent = s.runs; $("wkts").textContent = s.wkts; $("overs").textContent = overText(s.balls);
    $("crr").textContent = s.balls ? (s.runs / (s.balls / 6)).toFixed(2) : "0.00";
    const remBalls = Math.max(Number(s.totalOvers || 20) * 6 - s.balls, 0); const need = s.target ? Math.max(s.target - s.runs, 0) : null;
    $("targetBox").textContent = s.target || "-"; $("needBox").textContent = need ?? "-"; $("rrrBox").textContent = need == null ? "-" : (remBalls ? ((need * 6) / remBalls).toFixed(2) : "0.00"); $("partnershipBox").textContent = `${s.partnershipRuns} (${s.partnershipBalls})`;
    $("batsmanRows").innerHTML = [s.bat1, s.bat2].map((b, i) => `<tr><td><b>${this.safe(b.name)}</b> ${s.striker === i + 1 ? "*" : ""}</td><td>${b.r}</td><td>${b.b}</td><td>${b.f}</td><td>${b.s}</td><td>${calcSR(b.r, b.b)}</td></tr>`).join("");
    $("bowlerRows").innerHTML = `<tr><td><b>${this.safe(s.bowler.name)}</b></td><td>${overText(s.bowler.balls)}</td><td>${s.bowler.r}</td><td>${s.bowler.w}</td><td>${calcER(s.bowler.r, s.bowler.balls)}</td></tr>`;
    $("thisOver").innerHTML = s.over.length ? s.over.map(x => `<span class="ball ${this.ballClass(x)}">${this.safe(String(x).slice(0, 3))}</span>`).join("") : "<span class='item'>No balls</span>";
    $("recentBalls").innerHTML = s.recentBalls.length ? s.recentBalls.map(x => `<div class="item"><b>${this.safe(x.label)}</b> ${this.safe(x.score)}<br><small>${this.safe(x.text)}</small></div>`).join("") : "<div class='item'>No recent balls</div>";
    $("overSummary").innerHTML = s.overSummary.length ? s.overSummary.map(o => `<div class="item">Over ${o.overNo} ${o.bowler ? "- " + this.safe(o.bowler) : ""}: ${o.timeline.map(x => this.safe(x)).join(" ")}</div>`).join("") : "<div class='item'>No over completed</div>";
    $("fowList").innerHTML = s.fallOfWickets.length ? s.fallOfWickets.map((x, i) => `<div class="item">${i + 1}. ${this.safe(x)}</div>`).join("") : "<div class='item'>No wickets</div>";
    $("commentaryList").innerHTML = s.commentary.length ? s.commentary.slice(0, 30).map(c => `<div class="item"><b>${this.safe(c.ball)}</b> ${this.safe(c.text)}</div>`).join("") : "<div class='item'>No commentary</div>";
    document.querySelectorAll(".mode").forEach(b => b.classList.toggle("active", b.dataset.mode === s.liveControl.mode));
    if (s.matchId) {
      $("publicLink").textContent = this.publicLink();
      const qr = $("liveUserQrImg");
      if (qr) qr.src = this.qrCodeUrl(this.publicLink());
    }
    this.renderLeagueSchedule(); this.renderHistory();
  },
  ballClass(x) { const t = String(x); if (/^W(?!d)/i.test(t)) return "wicket"; if (t === "4") return "four"; if (t === "6") return "six"; return ""; },

  renderTeams() {
    $("teamList").innerHTML = this.teams.map(t => `<div class="card-mini" data-id="${t.teamId}"><b>${this.safe(t.name)}</b><br><small>${this.safe(t.shortName || "")} · ${(t.players || []).length} players</small></div>`).join("") || "<div class='item'>No teams</div>";
    document.querySelectorAll("#teamList .card-mini").forEach(el => el.onclick = () => this.selectTeam(el.dataset.id));
  },
  selectTeam(id) {
    const t = this.teamById(id); if (!t) return; this.selectedTeamId = id; $("teamId").value = id; $("teamName").value = t.name || ""; $("teamShort").value = t.shortName || ""; $("teamLogo").value = t.logo || ""; $("selectedTeamName").textContent = t.name;
    if (this.activeUnsubPlayers) this.activeUnsubPlayers();
    this.activeUnsubPlayers = listenPlayers(id, players => { t.players = players; this.renderPlayers(players); this.fillTeamSelectors(); }, e => this.toast(e.message, true));
  },
  renderPlayers(players = []) { $("playerList").innerHTML = players.map(p => `<div class="card-mini" data-id="${p.playerId}"><b>${this.safe(p.name)}</b><br><small>${this.safe(p.role || "Player")}</small></div>`).join("") || "<div class='item'>No players</div>"; document.querySelectorAll("#playerList .card-mini").forEach(el => el.onclick = () => this.selectPlayer(el.dataset.id)); },
  selectPlayer(id) { const team = this.teamById(this.selectedTeamId); const p = (team?.players || []).find(x => x.playerId === id); if (!p) return; this.selectedPlayerId = id; $("playerId").value = id; $("playerName").value = p.name || ""; $("playerRole").value = p.role || "Batsman"; $("battingStyle").value = p.battingStyle || ""; $("bowlingStyle").value = p.bowlingStyle || ""; $("jerseyNo").value = p.jerseyNo || ""; $("playerImage").value = p.image || ""; },
  async saveTeamForm() { const id = $("teamId").value || undefined; const name = $("teamName").value.trim(); if (!name) return this.toast("Team name required", true); const teamId = await saveTeam({ teamId: id, name, shortName: $("teamShort").value.trim(), logo: $("teamLogo").value.trim() }); this.selectTeam(teamId); this.toast("Team saved"); },
  clearTeamForm() { ["teamId", "teamName", "teamShort", "teamLogo"].forEach(id => $(id).value = ""); this.selectedTeamId = ""; },
  async deleteSelectedTeam() { if (!this.selectedTeamId || !confirm("Delete team?")) return; await deleteTeam(this.selectedTeamId); this.clearTeamForm(); this.toast("Team deleted"); },
  async savePlayerForm() { if (!this.selectedTeamId) return this.toast("Team select करें", true); const name = $("playerName").value.trim(); if (!name) return this.toast("Player name required", true); await savePlayer(this.selectedTeamId, { playerId: $("playerId").value || undefined, name, role: $("playerRole").value, battingStyle: $("battingStyle").value, bowlingStyle: $("bowlingStyle").value, jerseyNo: $("jerseyNo").value, image: $("playerImage").value.trim() }); this.clearPlayerForm(false); this.toast("Player saved"); },
  clearPlayerForm(clearId = true) { ["playerId", "playerName", "battingStyle", "bowlingStyle", "jerseyNo", "playerImage"].forEach(id => $(id).value = ""); if (clearId) this.selectedPlayerId = ""; },
  async deleteSelectedPlayer() { if (!this.selectedTeamId || !this.selectedPlayerId || !confirm("Delete player?")) return; await deletePlayer(this.selectedTeamId, this.selectedPlayerId); this.clearPlayerForm(); this.toast("Player deleted"); },

  async uploadImage(file, targetInput) { if (!file) return; if (!cloudinaryConfig.cloudName || cloudinaryConfig.cloudName.includes("YOUR")) return this.toast("Cloudinary config भरें", true); const fd = new FormData(); fd.append("file", file); fd.append("upload_preset", cloudinaryConfig.uploadPreset); try { const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`, { method: "POST", body: fd }); if (!res.ok) throw new Error("Cloudinary upload failed"); const json = await res.json(); $(targetInput).value = json.secure_url || json.url || ""; this.toast("Image uploaded"); } catch (e) { this.toast(e.message, true); } },

  renderLeagueTeamChecks() { $("leagueTeamChecks").innerHTML = this.teams.map(t => `<label><input type="checkbox" value="${t.teamId}"> ${this.safe(t.name)}</label>`).join("") || "No teams"; },
  generateSchedule() { const ids = [...document.querySelectorAll("#leagueTeamChecks input:checked")].map(x => x.value); const teams = ids.map(id => this.teamById(id)).filter(Boolean); if (teams.length < 2) return this.toast("At least 2 teams", true); const format = $("leagueFormat").value; const schedule = []; const rounds = format === "double" ? 2 : 1; let n = 1; for (let r = 1; r <= rounds; r++) for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) schedule.push({ id: makeId("fix"), stage: "League", round: `Round ${r}`, teamA: r === 1 ? this.teamObj(teams[i]) : this.teamObj(teams[j]), teamB: r === 1 ? this.teamObj(teams[j]) : this.teamObj(teams[i]), overs: Number($("leagueOvers").value || 20), status: "pending", matchNo: n++ }); if ($("iplPlayoffs").checked) ["Qualifier 1", "Eliminator", "Qualifier 2", "Final"].forEach(stage => schedule.push({ id: makeId("fix"), stage, round: "Playoffs", teamA: { name: "TBA" }, teamB: { name: "TBA" }, overs: Number($("leagueOvers").value || 20), status: "pending", matchNo: n++ })); this.draftSchedule = schedule; this.renderLeagueSchedule(); },
  async saveLeagueForm() { const selectedTeams = [...document.querySelectorAll("#leagueTeamChecks input:checked")].map(x => this.teamObj(this.teamById(x.value))).filter(Boolean); const league = { leagueId: this.editingLeagueId || undefined, name: $("leagueName").value.trim() || "Cricket League", shortName: $("leagueShort").value.trim(), season: $("leagueSeason").value.trim(), logo: $("leagueLogo").value.trim(), defaultOvers: Number($("leagueOvers").value || 20), format: $("leagueFormat").value, playoffs: $("iplPlayoffs").checked, teams: selectedTeams, schedule: this.draftSchedule || [], pointsTable: {}, status: "active" }; await saveLeague(league); this.toast("League saved"); },
  clearLeagueForm() { ["leagueName", "leagueShort", "leagueSeason", "leagueLogo"].forEach(id => $(id).value = ""); this.draftSchedule = []; this.renderLeagueSchedule(); },
  renderLeagueSchedule() { const current = this.draftSchedule || this.leagues[0]?.schedule || []; $("leagueSchedule").innerHTML = current.length ? current.map((m, i) => `<div class="item"><b>${i + 1}. ${this.safe(m.teamA?.name)} vs ${this.safe(m.teamB?.name)}</b><br><small>${this.safe(m.stage)} · ${this.safe(m.round)} · ${m.status}</small></div>`).join("") : "<div class='item'>No schedule</div>"; const pts = this.state.pointsTable || this.leagues[0]?.pointsTable || {}; $("leaguePoints").innerHTML = Object.entries(pts).map(([team, p]) => `<tr><td>${this.safe(team)}</td><td>${p.P || 0}</td><td>${p.W || 0}</td><td>${p.L || 0}</td><td>${p.T || 0}</td><td>${p.Pts || 0}</td><td>${this.nrr(p)}</td></tr>`).join("") || `<tr><td colspan="7">No points</td></tr>`; },
  nrr(p) { const rf = p.BF ? p.RF / (p.BF / 6) : 0; const ra = p.BA ? p.RA / (p.BA / 6) : 0; return (rf - ra).toFixed(3); },

  renderHistory() {
    const saved = this.getActiveBackup();
    const continueCard = saved ? `<div class="card-mini" style="border-color:#f59e0b;background:#fffbeb"><b>Unfinished Match Backup</b><br><small>${this.safe(saved.state.matchTitle || saved.matchId)}</small><p>${this.safe(saved.state.battingTeam?.name || "-")} ${Number(saved.state.runs || 0)}/${Number(saved.state.wkts || 0)} (${overText(saved.state.balls || 0)})</p><div class="actions"><button class="btn" onclick="app.continueRecoveredMatch()">Continue Match</button><button class="btn light" onclick="window.open('user.html?match=${saved.state.matchId}','_blank')">Open User</button></div></div>` : "";
    const historyHtml = this.completed.map(m => `<div class="card-mini"><b>${this.safe(m.matchTitle || m.title || "Match")}</b><br><small>${this.safe(m.leagueName || "")}</small><p>${this.safe(m.firstInnings || "")} ${m.secondInnings ? " | " + this.safe(m.secondInnings) : ""}</p><b>${this.safe(m.winnerText || "-")}</b><div class="actions"><button class="btn light" onclick="window.open('user.html?match=${m.matchId}','_blank')">View</button><button class="btn" onclick="window.open('scorecard-download.html?match=${m.matchId}','_blank')">PDF</button><button class="btn warn" onclick="app.editManOfMatch('${m.matchId}')">Edit MVP</button><button class="btn danger" onclick="app.deleteHistoryMatch('${m.matchId}')">Delete</button></div></div>`).join("");
    $("historyList").innerHTML = continueCard + (historyHtml || "<div class='item'>No completed matches</div>");
  },

  async editManOfMatch(matchId) {
    const match = this.completed.find(m => m.matchId === matchId);
    if (!match) return this.toast("Match not found", true);
    let scorecard = match.fullScorecardData || match.scorecard || {};
    const players = new Set();
    const addPlayers = (items = []) => {
      if (!items) return;
      if (!Array.isArray(items)) items = [items];
      items.forEach(inn => {
        (inn?.battingScorecard || []).forEach(b => { if (b?.name) players.add(b.name); });
      });
    };
    addPlayers(scorecard.firstInnings || scorecard.firstInningsDetail || []);
    addPlayers(scorecard.secondInnings || scorecard.secondInningsDetail || []);
    addPlayers(scorecard.completedInnings?.teamA || []);
    addPlayers(scorecard.completedInnings?.teamB || []);
    Object.values(scorecard.inningsDetails || {}).forEach(inn => addPlayers([inn]));
    if (!players.size) {
      const stored = await getStoredScorecard(matchId);
      if (stored?.fullScorecardData) {
        scorecard = stored.fullScorecardData;
        addPlayers(scorecard.firstInnings || scorecard.firstInningsDetail || []);
        addPlayers(scorecard.secondInnings || scorecard.secondInningsDetail || []);
        addPlayers(scorecard.completedInnings?.teamA || []);
        addPlayers(scorecard.completedInnings?.teamB || []);
        Object.values(scorecard.inningsDetails || {}).forEach(inn => addPlayers([inn]));
      }
    }
    if (!players.size) {
      addPlayers(match.battingScorecard || []);
      addPlayers(match.completedInnings?.teamA || []);
      addPlayers(match.completedInnings?.teamB || []);
    }
    const playerList = Array.from(players).sort();
    const currentMvp = match.playerOfMatch || match.mvp || "";
    this.mvpCurrentMatch = matchId;
    this.mvpCurrentMvp = currentMvp;
    const html = playerList.length ? playerList.map(p => `<button class="picker-option" data-mvp="${this.safe(p)}" style="${p === currentMvp ? 'background:#10b981;color:white;' : ''}">${this.safe(p)}</button>`).join("") : `<div class="item">No players found</div>`;
    $("mvpPlayerList").innerHTML = html;
    document.querySelectorAll("#mvpPlayerList .picker-option").forEach(b => b.onclick = () => this.selectMvp(b.dataset.mvp));
    $("mvpModal").classList.add("show");
  },

  selectMvp(playerName) {
    const matchId = this.mvpCurrentMatch;
    const currentMvp = this.mvpCurrentMvp;
    if (playerName === currentMvp) {
      this.closeMvpModal();
      return;
    }
    updateCompletedMatchMvp(matchId, playerName).then(() => {
      this.toast("Man of the Match updated to " + playerName);
      this.completed = this.completed.map(m => m.matchId === matchId ? { ...m, playerOfMatch: playerName, mvp: playerName } : m);
      this.renderHistory();
      this.closeMvpModal();
    }).catch(e => this.toast("Failed to update: " + e.message, true));
  },

  async deleteHistoryMatch(matchId) {
    const enteredId = prompt(`Delete match ${matchId}?
Type the match ID to confirm deletion:`);
    if (enteredId === null) return;
    if (enteredId.trim() !== matchId) {
      this.toast("Match ID mismatch. Delete canceled.", true);
      return;
    }
    try {
      await deleteCompletedMatch(matchId);
      this.toast("Match deleted successfully");
      this.completed = this.completed.filter(m => m.matchId !== matchId);
      this.renderHistory();
    } catch (e) {
      this.toast("Delete failed: " + e.message, true);
    }
  },

  closeMvpModal() {
    $("mvpModal").classList.remove("show");
    this.mvpCurrentMatch = null;
    this.mvpCurrentMvp = null;
  },

  toast(text, error = false) { const t = $("toast"); t.textContent = text; t.style.background = error ? "#b91c1c" : "#111827"; t.classList.add("show"); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => t.classList.remove("show"), 2400); },
  safe(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); },
  short(name) { return String(name || "-").split(/\s+/).map(x => x[0]).join("").slice(0, 3).toUpperCase(); }
};

window.app.init();
