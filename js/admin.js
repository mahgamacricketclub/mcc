import { cloudinaryConfig } from "../firebase/firebase-config.js";
import {
  loginAdmin, logoutAdmin, watchAuth, isAdmin,
  saveTeam, deleteTeam, listenTeams, savePlayer, deletePlayer, listenPlayers,
  getTeamsWithPlayers, saveLeague, deleteLeague, listenLeagues,
  saveMatch, saveCompletedMatch, listenCompletedMatches, listenScheduledMatches, updateCompletedMatchMvp, deleteCompletedMatch, getStoredScorecard, savePlayerMatchStats, saveSavedLink, savePublicSettings, makeId, safeId
} from "./firebase-store.js";
import { writeLiveMatch } from "./firebase-live.js";
import { livePayload, storePayload, normalizeState, normalizeBatter, overText, calcSR, calcER, clone } from "./live-sync.js";

const $ = (id) => document.getElementById(id);
const todayKey = () => new Date().toISOString().slice(0, 10).replaceAll("-", "");
const ACTIVE_MATCH_KEY = "cricket_admin_active_match_backup";
const MANUAL_SCORE_KEY = (matchId) => `cricket_admin_manual_score_checkpoint_${matchId || "none"}`;
const PUBLIC_LEAGUE_TABS_KEY = "cricket_admin_public_league_tabs";

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
  superOver: null,
  mvp: "",
  playerOfMatch: "",
  commentaryMode: "en",
  setupMode: "schedule",
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
  scheduled: [],
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
        this.toast("Unable to verify admin access: " + e.message, true);
        return this.showLogin();
      }
      if (!this.adminOk) {
        this.toast("This account does not have admin access. Check Firestore admins/{uid}.", true);
        await logoutAdmin().catch(() => {});
        return this.showLogin();
      }
      this.showAdmin();
      this.startListeners();
    });
  },

  bindBaseEvents() {
    this.ensureEliminatorControl();
    $("loginBtn").onclick = () => this.login();
    $("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") this.login(); });
    $("logoutBtn").onclick = () => logoutAdmin();
    document.querySelectorAll(".tab").forEach(btn => btn.onclick = () => this.openPage(btn.dataset.page));
    document.querySelectorAll("input[name='setupMode']").forEach(r => r.onchange = () => this.setSetupMode(r.value));
    ["teamASelect", "teamBSelect", "tossDecision", "tossWinner"].forEach(id => $(id).addEventListener("change", () => { this.clearOpeningSelections(); this.refreshSetupPlayers(); }));
    $("openingStriker").addEventListener("change", () => this.refreshSetupPlayers());
    $("setupLeague").onchange = () => this.onSetupLeagueChange();
    $("saveScheduleBtn").onclick = () => this.runOnce("saveSchedule", "saveScheduleBtn", () => this.saveScheduleOnly());
    $("startMatchBtn").onclick = () => this.runOnce("startMatch", "startMatchBtn", () => this.startMatch());
    $("commentaryMode").onchange = () => { this.state.commentaryMode = $("commentaryMode").value; if (this.state.matchId) this.saveAll(false); };
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
    $("startSuperOverBtn").onclick = () => this.runOnce("startSuperOver", "startSuperOverBtn", () => this.startSuperOver());
    $("manualSaveBtn").onclick = () => this.runOnce("manualSave", "manualSaveBtn", () => this.manualSaveScore());
    $("completeBtn").onclick = () => this.runOnce("completeMatch", "completeBtn", () => this.completeMatch());
    $("lockBtn").onclick = () => this.setLock(true);
    $("unlockBtn").onclick = () => this.setLock(false);
    $("showTimeBtn").onclick = () => this.setTimedMode();
    document.querySelectorAll(".mode").forEach(b => b.onclick = () => this.setMode(b.dataset.mode));
    $("saveTeamBtn").onclick = () => this.runOnce("saveTeam", "saveTeamBtn", () => this.saveTeamForm());
    $("newTeamBtn").onclick = () => this.clearTeamForm();
    $("deleteTeamBtn").onclick = () => this.runOnce("deleteTeam", "deleteTeamBtn", () => this.deleteSelectedTeam());
    $("savePlayerBtn").onclick = () => this.runOnce("savePlayer", "savePlayerBtn", () => this.savePlayerForm());
    $("newPlayerBtn").onclick = () => this.clearPlayerForm();
    $("deletePlayerBtn").onclick = () => this.runOnce("deletePlayer", "deletePlayerBtn", () => this.deleteSelectedPlayer());
    $("teamLogoFile").onchange = e => this.uploadImage(e.target.files[0], "teamLogo");
    $("playerImageFile").onchange = e => this.uploadImage(e.target.files[0], "playerImage");
    $("leagueLogoFile").onchange = e => this.uploadImage(e.target.files[0], "leagueLogo");
    if ($("loadLeagueBtn")) $("loadLeagueBtn").onclick = () => this.loadSelectedLeagueForEdit();
    if ($("newLeagueBtn")) $("newLeagueBtn").onclick = () => this.newLeagueEditor();
    if ($("deleteLeagueBtn")) $("deleteLeagueBtn").onclick = () => this.runOnce("deleteLeague", "deleteLeagueBtn", () => this.deleteSelectedLeague());
    if ($("publicLeagueTabsBtn")) $("publicLeagueTabsBtn").onclick = () => this.togglePublicLeagueTabs();
    this.loadPublicLeagueTabsSetting();
    $("generateScheduleBtn").onclick = () => this.runOnce("generateSchedule", "generateScheduleBtn", () => this.generateSchedule());
    if ($("autoFillPlayoffsBtn")) $("autoFillPlayoffsBtn").onclick = () => this.autoFillPlayoffs();
    $("saveLeagueBtn").onclick = () => this.runOnce("saveLeague", "saveLeagueBtn", () => this.saveLeagueForm());
    $("clearLeagueBtn").onclick = () => this.clearLeagueForm();
    this.bindPicker();
    this.bindWicketModal();
    this.bindInningsModal();
    this.bindInningsBreakModal();
    this.setSetupMode("schedule");
  },

  async runOnce(key, buttonId, fn) {
    this.busyActions = this.busyActions || {};
    if (this.busyActions[key]) return;
    this.busyActions[key] = true;
    const btn = buttonId ? $(buttonId) : null;
    const oldText = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }
    try {
      return await fn();
    } catch (e) {
      this.toast(e.message || String(e), true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
      }
      this.busyActions[key] = false;
    }
  },

  ensureEliminatorControl() {
    if ($("includeEliminator")) return;
    const playoffToggle = $("iplPlayoffs");
    if (!playoffToggle) return;
    const label = document.createElement("label");
    label.innerHTML = `Eliminator<select id="includeEliminator"><option value="on" selected>On</option><option value="off">Off</option></select>`;
    playoffToggle.closest("label")?.after(label);
  },

  updatePublicLeagueTabsButton() {
    const checked = $("publicLeagueTabs")?.checked !== false;
    const btn = $("publicLeagueTabsBtn");
    if (!btn) return;
    btn.textContent = `User League & Points: ${checked ? "On" : "Off"}`;
    btn.classList.toggle("on", checked);
    btn.classList.toggle("off", !checked);
    if (!checked) $("leagueEditor")?.classList.add("hidden");
  },
  loadPublicLeagueTabsSetting() {
    const saved = localStorage.getItem(PUBLIC_LEAGUE_TABS_KEY);
    if (saved !== null && $("publicLeagueTabs")) $("publicLeagueTabs").checked = saved !== "off";
    this.updatePublicLeagueTabsButton();
  },
  async togglePublicLeagueTabs() {
    const input = $("publicLeagueTabs");
    if (!input) return;
    input.checked = !input.checked;
    localStorage.setItem(PUBLIC_LEAGUE_TABS_KEY, input.checked ? "on" : "off");
    this.updatePublicLeagueTabsButton();
    if (input.checked) this.openLeagueEditor(this.editingLeagueId ? "Edit League" : "Create League");
    try { await savePublicSettings({ showPublicLeague: input.checked }); } catch (error) { console.warn("Public settings save failed", error); }
    const id = this.editingLeagueId || $("leagueManageSelect")?.value || this.state.league?.leagueId || "";
    const league = this.leagues.find(l => l.leagueId === id) || (this.state.league?.leagueId === id ? this.state.league : null);
    if (league?.leagueId) {
      const updated = { ...league, showPublicLeague: input.checked };
      try { await saveLeague(updated); } catch (error) { console.warn("League display setting save failed", error); }
    }
    this.state.showPublicLeague = input.checked;
    if (this.state.matchId) {
      this.state.league = { ...(this.state.league || league || {}), showPublicLeague: input.checked };
      await this.saveAll(true);
    }
    this.toast(`User League & Points ${input.checked ? "enabled" : "disabled"}.`);
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
    if (String(code).includes("invalid")) return "Invalid email or password.";
    if (String(code).includes("permission")) return "Permission denied.";
    return String(code);
  },
  showLogin() { $("loginScreen").classList.remove("hidden"); $("adminApp").classList.add("hidden"); },
  showAdmin() { $("loginScreen").classList.add("hidden"); $("adminApp").classList.remove("hidden"); },

  startListeners() {
    listenTeams((teams) => { this.teams = teams; this.renderTeams(); this.fillTeamSelectors(); this.renderLeagueTeamChecks(); }, e => this.toast(e.message, true));
    listenLeagues((leagues) => { this.leagues = leagues; this.fillLeagueSelectors(); this.renderLeagueSchedule(); }, e => this.toast(e.message, true));
    listenCompletedMatches((rows) => { this.completed = rows; this.renderHistory(); }, e => this.toast(e.message, true));
    listenScheduledMatches((rows) => { this.scheduled = rows; this.renderHistory(); }, e => this.toast(e.message, true));
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
    this.needsSetupSync = true;
    this.setSync("Recovered local live match backup");
    return true;
  },

  async continueRecoveredMatch() {
    const saved = this.getActiveBackup();
    if (!saved) return this.toast("No recoverable match backup found.", true);
    this.state = normalizeState(saved.state);
    this.currentMatchId = this.state.matchId;
    this.needsSetupSync = true;
    this.openPage(this.state.status === "scheduled" ? "setup" : "live");
    this.render();
    await this.saveAll(true);
    this.toast(this.state.status === "scheduled" ? "Scheduled setup restored." : "Match restored from the saved backup.");
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
    $("tossWinner").value = "";
    this.refreshSetupPlayers();
    this.syncSetupFormFromState();
  },

  clearOpeningSelections() {
    ["openingStriker", "openingNonStriker", "openingBowler"].forEach(id => { if ($(id)) $(id).value = ""; });
  },

  setSetupMode(mode = "schedule") {
    this.state.setupMode = mode;
    document.querySelectorAll("input[name='setupMode']").forEach(r => { r.checked = r.value === mode; });
    document.querySelectorAll(".live-only").forEach(el => el.classList.toggle("hidden", mode !== "live"));
    $("saveScheduleBtn")?.classList.toggle("hidden", mode !== "schedule");
    $("startMatchBtn")?.classList.toggle("hidden", mode !== "live");
    if (mode !== "live") {
      if ($("tossWinner")) $("tossWinner").value = "";
      this.clearOpeningSelections();
    }
  },

  fillLeagueSelectors() {
    $("setupLeague").innerHTML = `<option value="">No League</option>` + this.leagues.map(l => `<option value="${l.leagueId}">${this.safe(l.name)}</option>`).join("");
    if ($("leagueManageSelect")) $("leagueManageSelect").innerHTML = `<option value="">Select league to edit</option>` + this.leagues.map(l => `<option value="${l.leagueId}">${this.safe(l.name)}${l.season ? " - " + this.safe(l.season) : ""}</option>`).join("");
    this.syncSetupFormFromState();
  },

  onSetupLeagueChange() {
    this.pendingFixture = null;
    this.refreshSetupPlayers();
  },

  syncSetupFormFromState(force = false) {
    if (!force && !this.needsSetupSync) return;
    const s = this.state || {};
    if (!s.matchId) return;
    if ($("setupLeague")) $("setupLeague").value = s.leagueId || "";
    if ($("teamASelect") && s.teamA?.teamId) $("teamASelect").value = s.teamA.teamId;
    if ($("teamBSelect") && s.teamB?.teamId) $("teamBSelect").value = s.teamB.teamId;
    if ($("venue")) $("venue").value = s.venue || "";
    if ($("matchDate")) $("matchDate").value = s.matchDate || "";
    if ($("matchTime")) $("matchTime").value = s.matchTime || s.liveControl?.displayTime || "";
    if ($("totalOvers")) $("totalOvers").value = Number(s.totalOvers || 20);
    if ($("matchType")) $("matchType").value = s.matchType || "T20";
    if ($("commentaryMode")) $("commentaryMode").value = s.commentaryMode || "en";
    if ($("followLink")) $("followLink").value = s.followLink || "";
    this.setSetupMode(s.liveStarted ? "live" : (s.setupMode || "schedule"));
    if ($("tossDecision")) $("tossDecision").value = s.tossDecision || "bat";
    this.refreshSetupPlayers();
    if ($("tossWinner")) $("tossWinner").value = this.teamByNameValue(s.tossWinner) || "";
    this.refreshSetupPlayers();
    if ($("openingStriker") && s.bat1?.playerId) {
      $("openingStriker").value = s.bat1.playerId;
      this.refreshSetupPlayers();
    }
    if ($("openingNonStriker") && s.bat2?.playerId) $("openingNonStriker").value = s.bat2.playerId;
    if ($("openingBowler") && s.bowler?.playerId) $("openingBowler").value = s.bowler.playerId;
    const teamSynced = (!s.teamA?.teamId || $("teamASelect")?.value === s.teamA.teamId) && (!s.teamB?.teamId || $("teamBSelect")?.value === s.teamB.teamId);
    const leagueSynced = !s.leagueId || $("setupLeague")?.value === s.leagueId;
    if (teamSynced && leagueSynced) this.needsSetupSync = false;
  },

  teamByNameValue(name) {
    if (!name) return "";
    return this.teams.find(t => t.name === name)?.teamId || "";
  },

  async refreshSetupPlayers() {
    const teamA = this.teamById($("teamASelect").value);
    const teamB = this.teamById($("teamBSelect").value);

    // Toss winner must be only Team A or Team B. Earlier it allowed any saved team,
    // which could accidentally create a match with a third team batting/bowling.
    const tossSelect = $("tossWinner");
    const selectedTeams = [teamA, teamB].filter(Boolean);
    const previousToss = tossSelect.value;
    tossSelect.innerHTML = `<option value="">Select Toss Winner</option>` + selectedTeams.map(t => `<option value="${t.teamId}">${this.safe(t.name)}</option>`).join("");
    if (selectedTeams.some(t => t.teamId === previousToss)) tossSelect.value = previousToss;
    else tossSelect.value = "";

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
      el.innerHTML = `<option value="">Select</option>` + list.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
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

  setupTeamsAndLeague() {
    const teamA = this.teamById($("teamASelect").value);
    const teamB = this.teamById($("teamBSelect").value);
    if (!teamA || !teamB || teamA.teamId === teamB.teamId) {
      this.toast("Select two different teams.", true);
      return null;
    }
    const totalOvers = Number($("totalOvers").value || 0);
    if (!Number.isFinite(totalOvers) || totalOvers <= 0) {
      this.toast("Total overs must be at least 1.", true);
      return null;
    }
    const league = this.leagues.find(l => l.leagueId === $("setupLeague").value) || null;
    return { teamA, teamB, league, totalOvers };
  },

  async saveScheduleOnly() {
    const setup = this.setupTeamsAndLeague();
    if (!setup) return;
    if (!$("matchTime").value) return this.toast("Select match start time before saving schedule.", true);
    const { teamA, teamB, league, totalOvers } = setup;
    const matchId = this.state?.matchId && !this.state.matchFinished && this.state.status === "scheduled" ? this.state.matchId : this.newMatchId();
    this.currentMatchId = matchId;
    this.state = blankState();
    Object.assign(this.state, {
      matchId,
      matchTitle: `${teamA.name} vs ${teamB.name}`,
      leagueId: league?.leagueId || "",
      leagueName: league?.name || "",
      league: league || null,
      fixtureId: this.pendingFixture?.id || "",
      leagueStage: this.pendingFixture?.stage || "",
      leagueRound: this.pendingFixture?.round || "",
      leagueMatchNo: this.pendingFixture?.matchNo || "",
      venue: $("venue").value.trim(),
      matchDate: $("matchDate").value,
      matchTime: $("matchTime").value,
      matchType: $("matchType").value.trim() || "T20",
      setupMode: "schedule",
      liveStarted: false,
      status: "scheduled",
      liveControl: { mode: "time", note: "Scheduled Time", displayTime: $("matchTime").value },
      teamA: this.teamObj(teamA),
      teamB: this.teamObj(teamB),
      totalOvers,
      commentaryMode: $("commentaryMode")?.value || "en",
      followLink: $("followLink").value.trim(),
      teams: this.teamsToMap(),
      teamInfo: this.teamInfoMap(),
      pointsTable: league?.pointsTable || {},
      showPublicLeague: $("publicLeagueTabs")?.checked !== false
    });
    this.persistActiveMatch();
    this.needsSetupSync = true;
    await this.saveAll(true);
    await saveSavedLink({ matchId, name: this.state.matchTitle, url: this.publicLink(), createdAt: Date.now() });
    $("publicLink").textContent = this.publicLink();
    this.render();
    this.toast("Schedule saved. Public page will show the selected time.");
  },

  async startMatch() {
    const setup = this.setupTeamsAndLeague();
    if (!setup) return;
    const { teamA, teamB, league, totalOvers } = setup;
    const tossTeam = this.teamById($("tossWinner").value);
    if (!tossTeam) return this.toast("Select toss winner before starting match.", true);
    if (![teamA.teamId, teamB.teamId].includes(tossTeam.teamId)) return this.toast("Toss winner must be Team A or Team B.", true);
    const otherTeam = tossTeam.teamId === teamA.teamId ? teamB : teamA;
    const batting = $("tossDecision").value === "bat" ? tossTeam : otherTeam;
    const bowling = $("tossDecision").value === "bat" ? otherTeam : tossTeam;
    const striker = this.playerById(batting, $("openingStriker").value);
    const nonStriker = this.playerById(batting, $("openingNonStriker").value);
    const bowler = this.playerById(bowling, $("openingBowler").value);
    if (!striker || !nonStriker || !bowler) return this.toast("Select opening striker, non-striker, and bowler.", true);
    if (striker.playerId === nonStriker.playerId) return this.toast("Striker and non-striker must be different players.", true);
    const matchId = this.state?.matchId && !this.state.matchFinished && this.state.status === "scheduled" ? this.state.matchId : this.newMatchId();
    this.currentMatchId = matchId;
    this.state = blankState();
    Object.assign(this.state, {
      matchId,
      matchTitle: `${teamA.name} vs ${teamB.name}`,
      leagueId: league?.leagueId || "",
      leagueName: league?.name || "",
      league: league || null,
      fixtureId: this.pendingFixture?.id || "",
      leagueStage: this.pendingFixture?.stage || "",
      leagueRound: this.pendingFixture?.round || "",
      leagueMatchNo: this.pendingFixture?.matchNo || "",
      venue: $("venue").value.trim(),
      matchDate: $("matchDate").value,
      matchTime: $("matchTime").value,
      matchType: $("matchType").value.trim() || "T20",
      setupMode: "live",
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
      commentaryMode: $("commentaryMode")?.value || this.state.commentaryMode || "en",
      bat1: normalizeBatter({ playerId: striker.playerId, name: striker.name, position: 1 }),
      bat2: normalizeBatter({ playerId: nonStriker.playerId, name: nonStriker.name, position: 2 }),
      bowler: { playerId: bowler.playerId, name: bowler.name, balls: 0, r: 0, w: 0, runs: 0, wkts: 0, dots: 0, wides: 0, noBalls: 0 },
      followLink: $("followLink").value.trim(),
      teams: this.teamsToMap(),
      teamInfo: this.teamInfoMap(),
      pointsTable: league?.pointsTable || {},
      showPublicLeague: $("publicLeagueTabs")?.checked !== false
    });
    this.pendingFixture = null;
    this.persistActiveMatch();
    await this.saveAll(true);
    await saveSavedLink({ matchId, name: this.state.matchTitle, url: this.publicLink(), createdAt: Date.now() });
    $("publicLink").textContent = this.publicLink();
    this.openPage("live");
    this.toast("Match is now live.");
  },

  teamsToMap() { const out = {}; this.teams.forEach(t => out[t.name] = (t.players || []).map(p => p.name)); return out; },
  teamInfoMap() { const out = {}; this.teams.forEach(t => { out[t.name] = { teamId: t.teamId, shortName: t.shortName || this.short(t.name), logo: t.logo || "", players: {} }; (t.players || []).forEach(p => out[t.name].players[p.name] = { ...p }); }); return out; },
  publicLink() { return new URL(`user.html?match=${this.currentMatchId || this.state.matchId || ""}`, location.href).href; },
  qrCodeUrl(link) { return link ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(link)}` : ""; },
  async copyPublicLink() { const link = this.publicLink(); try { await navigator.clipboard.writeText(link); this.toast("Public link copied."); } catch { prompt("Copy public link", link); } },

  async scoreBall(run) {
    const s = this.state = normalizeState(this.state);
    if (!s.matchId) return this.toast("Start a match first.", true);
    if (s.matchFinished) return this.toast("This match has already been completed.", true);
    if (s.scoringLocked) return this.toast("Scoring is locked.", true);
    if (!(await this.ensureLivePlayersSelected())) return;
    if (run === "custom") { const v = prompt("Enter runs"); if (v === null || isNaN(v)) return; run = Number(v); }
    const isWide = $("wide").checked, isNo = $("noball").checked, isBye = $("bye").checked, isLb = $("legbye").checked, isWicket = $("wicket").checked;
    if (isWide && isNo) return this.toast("Wide and No Ball cannot be selected together.", true);
    if (isBye && isLb) return this.toast("Bye and Leg Bye cannot be selected together.", true);
    if (isWide && (isBye || isLb)) return this.toast("Do not combine Wide with Bye or Leg Bye. Add wide runs with the run button.", true);
    if (isWicket && !this.pendingWicket) return this.openWicketModal();
    if (isNo && isWicket && !["Run Out", "Retired Out"].includes(this.pendingWicket?.type)) {
      $("wicket").checked = false;
      this.pendingWicket = null;
      return this.toast("Only Run Out is valid as a wicket on a No Ball.", true);
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

    const wicketInfo = this.pendingWicket ? { ...this.pendingWicket } : null;
    let label = this.ballLabel(run, { isWide, isNo, isBye, isLb, isWicket });
    if (isWicket) label = this.applyWicket(label, legal, bowlerKey, bs);

    s.over.push(label);
    const ballNo = overText(s.balls);
    const text = this.advancedCommentaryText(ballNo, striker.name, bowlerKey, label, { run, isWide, isNo, isBye, isLb, isWicket, batRuns, totalRuns, extraRuns, wicketInfo });
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
      await this.offerInningsBreakOrContinue();
      return;
    } else if (s.inningNumber > 1 && (chaseComplete || inningsOver)) {
      this.finishOver(true);
      if (this.isSuperOverActive()) await this.finishSuperOverInnings();
      else await this.finishMatchByCondition();
    }

    this.clearBallTypes();
    this.render();
    await this.saveAll(true);
  },

  async ensureLivePlayersSelected() {
    const s = this.state;
    const validBat1 = s.bat1?.name && s.bat1.name !== "-";
    const validBat2 = s.bat2?.name && s.bat2.name !== "-";
    const validBowler = s.bowler?.name && s.bowler.name !== "-";
    if (validBat1 && validBat2 && validBowler && s.bat1.name !== s.bat2.name) return true;
    this.toast("Select striker, non-striker, and bowler before scoring.", true);
    const started = await this.openInningsModal();
    if (!started) return false;
    return !!(this.state.bat1?.name && this.state.bat1.name !== "-" && this.state.bat2?.name && this.state.bat2.name !== "-" && this.state.bowler?.name && this.state.bowler.name !== "-");
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
    const overRuns = this.state.over.reduce((sum, label) => sum + this.labelRuns(label), 0);
    const overWkts = this.state.over.filter(label => /^W(?!d)|wicket/i.test(String(label))).length;
    this.state.overSummary.unshift({ overNo, bowler: this.state.bowler.name, timeline: [...this.state.over] });
    const summary = this.overCommentary(overNo, overRuns, overWkts);
    this.state.commentary.unshift({ ball: `Over ${overNo}`, text: summary, time: new Date().toLocaleTimeString(), type: "over" });
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

  async offerInningsBreakOrContinue() {
    this.saveCurrentInnings();
    this.state.firstInningsScore = this.state.runs;
    this.state.firstInningsWkts = this.state.wkts;
    this.state.firstInnings = `${this.state.runs}/${this.state.wkts} (${overText(this.state.balls)})`;
    this.state.target = this.state.runs + 1;
    this.state.status = "innings-break";
    this.state.scoringLocked = true;
    this.state.liveControl = { mode: "paused", note: "Innings Break" };
    this.render();
    await this.saveAll(true);
    const action = await this.openInningsBreakModal();
    if (action === "continue") await this.askSwitchInnings(false);
  },

  openInningsBreakModal() {
    return new Promise(resolve => {
      this.inningsBreakResolve = resolve;
      $("inningsBreakText").textContent = `First innings saved: ${this.state.firstInnings}. Target ${this.state.target}.`;
      $("inningsBreakModal").classList.add("show");
    });
  },

  bindInningsBreakModal() {
    $("inningsBreakBtn").onclick = () => {
      $("inningsBreakModal").classList.remove("show");
      if (this.inningsBreakResolve) this.inningsBreakResolve("break");
      this.inningsBreakResolve = null;
      this.toast("Innings break saved. Use Switch Innings when ready.");
    };
    $("inningsContinueBtn").onclick = () => {
      $("inningsBreakModal").classList.remove("show");
      if (this.inningsBreakResolve) this.inningsBreakResolve("continue");
      this.inningsBreakResolve = null;
    };
  },

  async askSwitchInnings(confirmStart = true) {
    if (!this.state.matchId || this.state.inningNumber > 1) { this.toast("Second innings is already active.", true); return false; }
    if (confirmStart && !confirm("Save the first innings and start the second innings?")) return false;
    const before = clone(this.state);
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
    const started = await this.openInningsModal();
    if (!started) {
      this.state = normalizeState(before);
      this.toast("Second innings was not started. Select players to continue.", true);
      return false;
    }
    return true;
  },

  openInningsModal() {
    return new Promise(resolve => {
      this.inningsResolve = resolve;
      const bat = this.currentBattingPlayers();
      const bowl = this.currentBowlingPlayers();
      $("inningsTargetText").textContent = `Target: ${this.state.target}`;
      $("nextStriker").innerHTML = bat.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
      $("nextNonStriker").innerHTML = bat.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
      $("nextBowler").innerHTML = bowl.map(p => `<option value="${p.playerId}">${this.safe(p.name)}</option>`).join("");
      $("inningsModal").classList.add("show");
    });
  },

  bindInningsModal() {
    $("inningsCancel").onclick = () => { $("inningsModal").classList.remove("show"); if (this.inningsResolve) this.inningsResolve(false); this.inningsResolve = null; };
    $("inningsStart").onclick = async () => {
      const bat = this.currentBattingPlayers(), bowl = this.currentBowlingPlayers();
      const s = bat.find(p => p.playerId === $("nextStriker").value);
      const ns = bat.find(p => p.playerId === $("nextNonStriker").value);
      const bo = bowl.find(p => p.playerId === $("nextBowler").value);
      if (!s || !ns || !bo || s.playerId === ns.playerId) return this.toast("Select a valid striker, non-striker, and bowler.", true);
      this.state.bat1 = normalizeBatter({ playerId: s.playerId, name: s.name, position: 1 });
      this.state.bat2 = normalizeBatter({ playerId: ns.playerId, name: ns.name, position: 2 });
      this.state.bowler = this.bowlerFromStats(bo);
      this.state.scoringLocked = false;
      this.state.liveStarted = true;
      this.state.status = "live";
      this.state.liveControl = { mode: "live", note: "Live" };
      $("inningsModal").classList.remove("show");
      if (this.inningsResolve) this.inningsResolve(true);
      this.inningsResolve = null;
      await this.saveAll(true); this.render(); this.toast("Second innings started.");
    };
  },

  async finishMatchByCondition() {
    const s = this.state;
    const target = Number(s.target || 0);
    if (s.runs >= target && target > 0) {
      const teamSize = Math.max(this.currentBattingPlayers().length, 2);
      const wktsLeft = Math.max(teamSize - s.wkts - 1, 0);
      const ballsLeft = Math.max(Number(s.totalOvers || 20) * 6 - s.balls, 0);
      s.winnerText = `${s.battingTeam.name} won by ${wktsLeft} wickets (${ballsLeft} balls left)`;
    } else {
      const margin = target - s.runs - 1;
      s.winnerText = margin === 0 ? "Match Tied" : `${s.bowlingTeam.name} won by ${margin} runs`;
    }
    if (s.winnerText === "Match Tied") {
      s.secondInnings = `${s.runs}/${s.wkts} (${overText(s.balls)})`;
      s.status = "tied";
      s.liveControl = { mode: "paused", note: "Match Tied - Super Over Available" };
      s.scoringLocked = true;
      await this.saveAll(true);
      this.render();
      return this.toast("Match tied. Start Super Over to decide the winner.");
    }
    await this.completeMatch(true);
  },

  isSuperOverActive() {
    return !!this.state.superOver?.active;
  },

  async startSuperOver() {
    const s = this.state;
    if (!s.matchId) return this.toast("No active match found.", true);
    if (s.winnerText !== "Match Tied" && s.status !== "tied") return this.toast("Super Over is available only after a tied match.", true);
    const first = s.secondBattingTeam || s.battingTeam;
    const second = s.firstBattingTeam || s.bowlingTeam;
    if (!first?.teamId || !second?.teamId) return this.toast("Team data is missing for Super Over.", true);
    this.saveCurrentInnings();
    s.superOver = { active: true, inning: 1, totalOvers: 1, teamA: first, teamB: second, first: null, second: null };
    this.resetInningsForSuperOver(first, second, 1, null);
    s.scoringLocked = false;
    s.liveStarted = true;
    s.status = "super-over";
    s.liveControl = { mode: "live", note: "Super Over" };
    await this.pickSuperOverPlayers();
    await this.saveAll(true);
    this.render();
    this.toast("Super Over started.");
  },

  resetInningsForSuperOver(batting, bowling, inning, target) {
    Object.assign(this.state, {
      battingTeam: this.teamObj(this.teamById(batting.teamId)) || batting,
      bowlingTeam: this.teamObj(this.teamById(bowling.teamId)) || bowling,
      inningNumber: inning,
      totalOvers: 1,
      runs: 0,
      wkts: 0,
      balls: 0,
      extras: 0,
      target,
      bat1: normalizeBatter({ name: "-" }),
      bat2: normalizeBatter({ name: "-" }),
      striker: 1,
      bowler: { name: "-", playerId: "", balls: 0, r: 0, w: 0, runs: 0, wkts: 0, dots: 0, wides: 0, noBalls: 0 },
      bowlerStats: {},
      battingScorecard: [],
      over: [],
      overSummary: [],
      recentBalls: [],
      fallOfWickets: [],
      partnershipRuns: 0,
      partnershipBalls: 0,
      lastWicket: "-",
      dismissed: [],
      retired: []
    });
  },

  async pickSuperOverPlayers() {
    const bat = this.currentBattingPlayers();
    const bowl = this.currentBowlingPlayers();
    const s1 = await this.pickName("Super Over striker", bat.map(p => ({ label: p.name, value: p.playerId })), true);
    const ns = await this.pickName("Super Over non-striker", bat.filter(p => p.playerId !== s1).map(p => ({ label: p.name, value: p.playerId })), true);
    const bo = await this.pickName("Super Over bowler", bowl.map(p => ({ label: p.name, value: p.playerId })), true);
    const striker = bat.find(p => p.playerId === s1);
    const non = bat.find(p => p.playerId === ns);
    const bowler = bowl.find(p => p.playerId === bo);
    if (!striker || !non || !bowler) return this.toast("Super Over players not selected.", true);
    this.state.bat1 = normalizeBatter({ playerId: striker.playerId, name: striker.name, position: 1 });
    this.state.bat2 = normalizeBatter({ playerId: non.playerId, name: non.name, position: 2 });
    this.state.bowler = this.bowlerFromStats(bowler);
  },

  async finishSuperOverInnings() {
    const s = this.state;
    this.saveCurrentInnings();
    if (s.superOver.inning === 1) {
      s.superOver.first = { team: s.battingTeam, runs: s.runs, wkts: s.wkts, balls: s.balls, score: `${s.runs}/${s.wkts} (${overText(s.balls)})` };
      const batting = s.superOver.teamB;
      const bowling = s.superOver.teamA;
      this.resetInningsForSuperOver(batting, bowling, 2, s.superOver.first.runs + 1);
      s.superOver.inning = 2;
      await this.pickSuperOverPlayers();
      await this.saveAll(true);
      this.render();
      return this.toast("Super Over chase started.");
    }
    s.superOver.second = { team: s.battingTeam, runs: s.runs, wkts: s.wkts, balls: s.balls, score: `${s.runs}/${s.wkts} (${overText(s.balls)})` };
    const a = s.superOver.first;
    const b = s.superOver.second;
    if (b.runs > a.runs) s.winnerText = `${b.team.name} won in Super Over`;
    else if (a.runs > b.runs) s.winnerText = `${a.team.name} won in Super Over`;
    else s.winnerText = "Match Tied after Super Over";
    s.superOver.active = false;
    s.superOver.completed = true;
    await this.completeMatch(true);
  },

  async completeMatch(auto = false) {
    if (!this.state.matchId) return this.toast("No active match found.", true);
    if (this.state.matchFinished) return this.toast("This match is already completed.", true);
    if (!auto && Number(this.state.inningNumber || 1) < 2) return this.toast("Use Switch Innings before completing the match.", true);
    this.saveCurrentInnings();
    if (!this.state.winnerText) this.state.winnerText = this.deriveWinnerText();
    const suggestedMvp = this.calculateMvp();
    if (!auto && !confirm(`Complete this match and save it permanently?\n\nSuggested Player of Match: ${suggestedMvp || "Not available"}`)) return;
    if (this.state.winnerText === "Match Tied" && !this.state.superOver?.completed) {
      this.state.status = "tied";
      this.state.scoringLocked = true;
      this.state.liveControl = { mode: "paused", note: "Match Tied - Super Over Available" };
      await this.saveAll(true);
      this.render();
      return this.toast("Match tied. Start Super Over to decide the winner.");
    }
    this.state.matchFinished = true;
    this.state.liveStarted = false;
    this.state.status = "completed";
    this.state.scoringLocked = true;
    this.state.liveControl = { mode: "paused", note: "Match Complete" };
    if (!this.state.superOver?.completed) this.state.secondInnings = `${this.state.runs}/${this.state.wkts} (${overText(this.state.balls)})`;
    this.state.mvp = suggestedMvp;
    this.state.playerOfMatch = this.state.mvp;
    await this.updateLeagueAfterCompletion();
    const final = storePayload(this.state, this.state.matchId, this.uid);
    await saveCompletedMatch(this.state.matchId, final);
    await savePlayerMatchStats(this.state.matchId, this.playerStatsForMatch());
    await this.pushLive();
    this.clearActiveMatchBackup();
    this.render();
    this.toast("Match completed and saved to history.");
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
    const teams = [this.state.teamA?.name, this.state.teamB?.name].filter(Boolean);
    const winner = teams.find(team => this.state.winnerText?.includes(team)) || "";
    const score = (p) => {
      const runs = Number(p.runs || 0);
      const balls = Number(p.balls || 0);
      const wkts = Number(p.wickets || 0);
      const bowlingBalls = Number(p.bowlingBalls || 0);
      const bowlingRuns = Number(p.bowlingRuns || 0);
      const sr = balls ? (runs * 100) / balls : 0;
      const er = bowlingBalls ? (bowlingRuns * 6) / bowlingBalls : 99;
      let value = runs + Number(p.fours || 0) + Number(p.sixes || 0) * 2 + wkts * 25;
      if (runs >= 100) value += 20;
      else if (runs >= 75) value += 12;
      else if (runs >= 50) value += 8;
      if (balls >= 10 && sr >= 160) value += 8;
      else if (balls >= 10 && sr >= 130) value += 4;
      else if (balls >= 15 && sr < 80) value -= 5;
      if (wkts >= 5) value += 30;
      else if (wkts >= 4) value += 18;
      else if (wkts >= 3) value += 10;
      if (bowlingBalls >= 12 && er <= 5) value += 10;
      else if (bowlingBalls >= 12 && er <= 7) value += 5;
      else if (bowlingBalls >= 12 && er > 10) value -= 5;
      value += Math.min(Number(p.bowlingDots || 0), 12) * 1.5;
      if (runs >= 25 && wkts >= 2) value += 15;
      if (winner && p.teamName === winner) value += 8;
      return value;
    };
    const best = stats.sort((a, b) => score(b) - score(a) || Number(b.runs || 0) - Number(a.runs || 0) || Number(b.wickets || 0) - Number(a.wickets || 0))[0];
    return best ? best.playerName : "";
  },

  pointsBallsForTeam(teamName, innings = {}) {
    const normalBalls = Number(innings.balls || 0);
    const players = Object.keys(this.state.teamInfo?.[teamName]?.players || {}).length || (this.state.teams?.[teamName] || []).length || 0;
    const allOut = Number(innings.wkts || 0) >= Math.max(players - 1, 1);
    return allOut ? Number(this.state.totalOvers || 20) * 6 : normalBalls;
  },

  buildPointsImpact(status = "completed") {
    const a = this.state.teamA?.name || "";
    const b = this.state.teamB?.name || "";
    if (!a || !b) return null;
    const impact = {
      matchId: this.state.matchId || "",
      status,
      teams: {
        [a]: { P: 0, W: 0, L: 0, T: 0, NR: 0, Pts: 0, RF: 0, BF: 0, RA: 0, BA: 0 },
        [b]: { P: 0, W: 0, L: 0, T: 0, NR: 0, Pts: 0, RF: 0, BF: 0, RA: 0, BA: 0 }
      }
    };
    impact.teams[a].P++;
    impact.teams[b].P++;
    if (status === "no-result") {
      impact.teams[a].NR++;
      impact.teams[b].NR++;
      impact.teams[a].Pts++;
      impact.teams[b].Pts++;
      return impact;
    }
    const innA = this.state.inningsDetails?.[a] || {};
    const innB = this.state.inningsDetails?.[b] || {};
    impact.teams[a].RF += Number(innA.runs || 0);
    impact.teams[a].BF += this.pointsBallsForTeam(a, innA);
    impact.teams[a].RA += Number(innB.runs || 0);
    impact.teams[a].BA += this.pointsBallsForTeam(b, innB);
    impact.teams[b].RF += Number(innB.runs || 0);
    impact.teams[b].BF += this.pointsBallsForTeam(b, innB);
    impact.teams[b].RA += Number(innA.runs || 0);
    impact.teams[b].BA += this.pointsBallsForTeam(a, innA);
    if (/tied/i.test(this.state.winnerText) && !/super over/i.test(this.state.winnerText)) {
      impact.teams[a].T++; impact.teams[b].T++; impact.teams[a].Pts++; impact.teams[b].Pts++;
    } else if (this.state.winnerText.startsWith(a) || this.state.winnerText.includes(`${a} won in Super Over`)) {
      impact.teams[a].W++; impact.teams[b].L++; impact.teams[a].Pts += 2;
    } else if (this.state.winnerText.startsWith(b) || this.state.winnerText.includes(`${b} won in Super Over`)) {
      impact.teams[b].W++; impact.teams[a].L++; impact.teams[b].Pts += 2;
    }
    return impact;
  },

  applyPointsImpact(league, impact, direction = 1) {
    if (!league || !impact?.teams) return;
    const pts = league.pointsTable || {};
    Object.entries(impact.teams).forEach(([team, delta]) => {
      pts[team] = pts[team] || { P: 0, W: 0, L: 0, T: 0, NR: 0, Pts: 0, RF: 0, BF: 0, RA: 0, BA: 0 };
      ["P", "W", "L", "T", "NR", "Pts", "RF", "BF", "RA", "BA"].forEach(k => {
        pts[team][k] = Math.max(0, Number(pts[team][k] || 0) + Number(delta[k] || 0) * direction);
      });
    });
    league.pointsTable = pts;
  },

  updatePointsTable() {
    const league = this.state.league;
    if (!league) return;
    const applied = league.pointsAppliedMatchIds || {};
    if (this.state.matchId && applied[this.state.matchId]) return;
    const impact = this.buildPointsImpact("completed");
    this.applyPointsImpact(league, impact, 1);
    league.pointsAppliedMatchIds = { ...applied, [this.state.matchId]: true };
    this.state.pointsTable = league.pointsTable || {};
    this.state.pointsImpact = impact;
  },

  async updateLeagueAfterCompletion() {
    const league = this.state.league;
    if (!league?.leagueId) return;
    this.updatePointsTable();
    this.markLeagueFixtureCompleted(league);
    this.state.league = league;
    await saveLeague(league);
  },

  markLeagueFixtureCompleted(league) {
    const schedule = Array.isArray(league.schedule) ? league.schedule : [];
    if (!schedule.length) return;
    const teamAId = this.state.teamA?.teamId || "";
    const teamBId = this.state.teamB?.teamId || "";
    const teamAName = this.state.teamA?.name || "";
    const teamBName = this.state.teamB?.name || "";
    const sameTeam = (fixtureTeam = {}, id, name) => {
      const fixtureId = fixtureTeam?.teamId || "";
      const fixtureName = fixtureTeam?.name || String(fixtureTeam || "");
      return (id && fixtureId === id) || (name && fixtureName === name);
    };
    const sameMatch = (fixture) => {
      if (this.state.fixtureId && fixture.id === this.state.fixtureId) return true;
      const direct = sameTeam(fixture.teamA, teamAId, teamAName) && sameTeam(fixture.teamB, teamBId, teamBName);
      const reverse = sameTeam(fixture.teamA, teamBId, teamBName) && sameTeam(fixture.teamB, teamAId, teamAName);
      return direct || reverse;
    };
    const fixture = schedule.find(m => sameMatch(m) && !["completed", "done"].includes(String(m.status || "").toLowerCase()));
    if (!fixture) return;
    Object.assign(fixture, {
      status: "completed",
      matchId: this.state.matchId,
      winnerText: this.state.winnerText || "",
      result: this.state.winnerText || "",
      firstInnings: this.state.firstInnings || "",
      secondInnings: this.state.secondInnings || "",
      pointsImpact: this.state.pointsImpact || this.buildPointsImpact("completed"),
      completedAt: Date.now()
    });
    this.state.leagueStage = fixture.stage || "";
    this.state.leagueRound = fixture.round || "";
    this.state.leagueMatchNo = fixture.matchNo || "";
    this.updatePlayoffProgression(league, fixture);
  },

  updatePlayoffProgression(league, completedFixture) {
    const schedule = Array.isArray(league.schedule) ? league.schedule : [];
    const stage = String(completedFixture.stage || "").toLowerCase();
    const winner = this.winnerTeamObj();
    const loser = this.loserTeamObj();
    if (!winner) return;
    const setSlot = (targetStage, field, team) => {
      const row = schedule.find(m => String(m.stage || "").toLowerCase() === targetStage.toLowerCase());
      if (row && team) row[field] = this.teamObj(this.teamById(team.teamId)) || team;
    };
    if (stage === "qualifier 1") {
      setSlot("Final", "teamA", winner);
      setSlot("Qualifier 2", "teamA", loser);
    } else if (stage === "eliminator") {
      setSlot("Qualifier 2", "teamB", winner);
    } else if (stage === "qualifier 2") {
      setSlot("Final", "teamB", winner);
    } else if (/semi final|semifinal/.test(stage)) {
      const final = schedule.find(m => String(m.stage || "").toLowerCase() === "final");
      if (final) {
        const field = /1/.test(String(completedFixture.round || completedFixture.matchNo || "")) || String(final.teamA?.name || "").includes("Winner") ? "teamA" : "teamB";
        final[field] = this.teamObj(this.teamById(winner.teamId)) || winner;
      }
    }
  },

  winnerTeamObj() {
    const a = this.state.teamA, b = this.state.teamB;
    if (!a || !b || (/tied/i.test(this.state.winnerText || "") && !/super over/i.test(this.state.winnerText || ""))) return null;
    if (this.state.winnerText.startsWith(a.name) || this.state.winnerText.includes(`${a.name} won in Super Over`)) return a;
    if (this.state.winnerText.startsWith(b.name) || this.state.winnerText.includes(`${b.name} won in Super Over`)) return b;
    return null;
  },

  loserTeamObj() {
    const winner = this.winnerTeamObj();
    if (!winner) return null;
    return winner.teamId === this.state.teamA?.teamId ? this.state.teamB : this.state.teamA;
  },

  currentBattingPlayers() { const team = this.teams.find(t => t.teamId === this.state.battingTeam?.teamId); return team?.players || []; },
  currentBowlingPlayers() { const team = this.teams.find(t => t.teamId === this.state.bowlingTeam?.teamId); return team?.players || []; },
  swapStrike(render = true) { this.state.striker = this.state.striker === 1 ? 2 : 1; if (render) this.render(); },
  setLock(flag) { this.state.scoringLocked = flag; this.render(); this.pushLive(); },
  setMode(mode) { this.state.liveControl = { mode, note: mode }; this.render(); this.pushLive(); },
  setTimedMode() {
    const time = $("controlTime").value;
    if (!time) return this.toast("Select a time first.", true);
    this.state.liveControl = { mode: "time", note: "Scheduled Time", displayTime: time };
    this.render();
    this.saveAll(true);
    this.toast("Time is now visible on the user page.");
  },
  clearBallTypes() { ["wide", "noball", "bye", "legbye", "wicket"].forEach(id => $(id).checked = false); this.pendingWicket = null; },
  pushUndo() { this.state.undoStack.push(clone(this.state)); if (this.state.undoStack.length > 25) this.state.undoStack.shift(); },
  async undo() { const prev = this.state.undoStack.pop(); if (!prev) return this.toast("Nothing to undo.", true); this.state = normalizeState(prev); this.render(); await this.saveAll(false); },
  labelRuns(label) {
    const text = String(label || "");
    const n = Number((text.match(/\d+/) || [0])[0]);
    if (/Wd|Nb/i.test(text)) return n || 1;
    return Number.isFinite(n) ? n : 0;
  },
  commentaryPick(lines, key = "") {
    const source = `${key}|${this.state.balls}|${this.state.runs}|${this.state.wkts}|${this.state.commentary?.length || 0}`;
    const seed = [...source].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return lines[seed % lines.length];
  },
  advancedCommentaryText(ballNo, batter, bowler, label, flags = {}) {
    const run = Number(flags.run || 0);
    const score = `${this.state.runs}/${this.state.wkts}`;
    const chase = this.state.inningNumber > 1 && this.state.target ? this.chaseLine() : "";
    const base = `${bowler} to ${batter}`;
    const mode = this.state.commentaryMode || $("commentaryMode")?.value || "en";
    const total = Number(flags.totalRuns ?? run ?? 0);
    const rawType = flags.wicketInfo?.type || "Wicket";
    const hiTypes = { Bowled: "बोल्ड", LBW: "एलबीडब्ल्यू", Caught: "कैच आउट", "Run Out": "रन आउट", Stumping: "स्टंपिंग", "Hit Wicket": "हिट विकेट", "Retired Out": "रिटायर्ड आउट", Wicket: "विकेट" };
    const type = mode === "hi" ? (hiTypes[rawType] || rawType) : rawType;
    const helper = flags.wicketInfo?.helper ? (mode === "hi" ? `, ${flags.wicketInfo.helper} शामिल` : `, ${flags.wicketInfo.helper} involved`) : "";
    const packs = {
      en: {
        wicket: [`WICKET! ${type}${helper}. ${batter} is gone.`, `Breakthrough! ${type}${helper}, ${batter} has to walk back.`, `Huge moment. ${batter} falls by ${type}${helper}.`],
        wide: [`Wide ball. Extra run added.`, `Sprayed down the side, called wide.`, `The line is off, wide signalled.`],
        wideRuns: [`Wide, ${total} runs added.`, `Loose ball and ${total} wides on the board.`, `${total} added from the wide.`],
        no: [`No ball. Free hit coming.`, `Overstepped, no ball called.`, `No ball from ${bowler}; the next one is a free hit.`],
        noRuns: [`No ball and ${run} run${run > 1 ? "s" : ""}. Free hit coming.`, `Overstepped, and they take ${run}. Free hit next.`, `${run} off the no ball, pressure on the bowler.`],
        bye: [`${total} bye${total > 1 ? "s" : ""}.`, `Missed by everyone, ${total} bye${total > 1 ? "s" : ""}.`, `Extras ticking along, ${total} bye${total > 1 ? "s" : ""}.`],
        lb: [`${total} leg bye${total > 1 ? "s" : ""}.`, `Off the pad, ${total} leg bye${total > 1 ? "s" : ""}.`, `Leg bye taken, ${total} added.`],
        six: [`SIX! Clean strike, all the way.`, `SIX! That has been launched into the stands.`, `Massive hit from ${batter}, six runs.`],
        four: [`FOUR! Finds the gap and races away.`, `FOUR! Timed well and the outfield does the rest.`, `Boundary for ${batter}, placed perfectly.`],
        dot: [`Dot ball. Good control from the bowler.`, `No run, tight line from ${bowler}.`, `Beaten for pace and there is no single there.`],
        one: [`Worked away for a single.`, `Quick single taken.`, `${batter} rotates the strike.`],
        two: [`Pushed into the gap, they come back for two.`, `Good running, two added.`, `Placed softly and they complete a couple.`],
        three: [`Excellent running, three taken.`, `They push hard and get three.`, `Long chase in the deep, three runs.`],
        other: [`${run} runs taken.`, `${run} added to the total.`, `They collect ${run}.`],
        score: `Score ${score}.`
      },
      mix: {
        wicket: [`WICKET! ${type}${helper}. ${batter} ko jaana padega.`, `Breakthrough! ${type}${helper}, match me twist aa gaya.`, `Bada moment, ${batter} ${type}${helper} out.`],
        wide: [`Wide ball, extra run add hua.`, `Line miss hui, umpire ne wide diya.`, `Bowler direction se bhatak gaya, wide.`],
        wideRuns: [`Wide, ${total} runs add hue.`, `Loose ball, ${total} wides mil gaye.`, `${total} run wide se aa gaye.`],
        no: [`No ball. Free hit coming.`, `Overstep hua, no ball.`, `No ball by ${bowler}, ab free hit.`],
        noRuns: [`No ball aur ${run} run${run > 1 ? "s" : ""}. Free hit coming.`, `No ball pe ${run} run bhi mil gaya.`, `${run} run no ball se, pressure badhega.`],
        bye: [`${total} bye run.`, `Keeper miss, ${total} bye mil gaya.`, `Ball sabko beat kar gayi, ${total} bye.`],
        lb: [`${total} leg bye run.`, `Pad se laga, ${total} leg bye.`, `Leg bye se ${total} add.`],
        six: [`SIX! Zabardast hit, seedha bahar.`, `SIX! Badiya connection, crowd me ball.`, `${batter} ne pura shot khola, six.`],
        four: [`FOUR! Gap mila aur boundary.`, `FOUR! Timing superb thi.`, `${batter} ne placement se four nikala.`],
        dot: [`Dot ball. Bowler ka achha control.`, `No run, tight bowling.`, `Batter ko room nahi mila.`],
        one: [`Single nikal liya.`, `Strike rotate kar di.`, `Soft hands se ek run.`],
        two: [`Gap me push kiya, do run complete.`, `Achhi running, two mil gaye.`, `Dono batsman tez bhaage, two.`],
        three: [`Achhi running, teen run mil gaye.`, `Deep me ball gayi, three complete.`, `Fitness ka kaam, teen run.`],
        other: [`${run} runs liye.`, `${run} run add hue.`, `${run} mil gaye.`],
        score: `Score ${score}.`
      },
      hi: {
        wicket: [`विकेट! ${type}${helper}. ${batter} आउट।`, `बड़ी सफलता! ${type}${helper}, ${batter} को लौटना होगा।`, `मैच का बड़ा पल, ${batter} ${type}${helper}।`],
        wide: [`वाइड गेंद। एक अतिरिक्त रन।`, `लाइन बाहर रही, अंपायर ने वाइड दिया।`, `वाइड से एक रन जुड़ा।`],
        wideRuns: [`वाइड, ${total} रन जुड़े।`, `${total} रन वाइड से मिले।`, `वाइड गेंद और ${total} रन।`],
        no: [`नो बॉल। अब फ्री हिट आएगी।`, `ओवरस्टेप हुआ, नो बॉल।`, `${bowler} से नो बॉल।`],
        noRuns: [`नो बॉल और ${run} रन। फ्री हिट आएगी।`, `नो बॉल पर ${run} रन भी मिल गए।`, `${run} रन नो बॉल से जुड़े।`],
        bye: [`${total} बाई रन।`, `कीपर से चूक, ${total} बाई।`, `बाई से ${total} रन जुड़े।`],
        lb: [`${total} लेग बाई रन।`, `पैड से लगी गेंद, ${total} लेग बाई।`, `लेग बाई से ${total} रन जुड़े।`],
        six: [`छक्का! शानदार शॉट।`, `छक्का! गेंद सीमा रेखा के पार।`, `${batter} का बड़ा शॉट, छह रन।`],
        four: [`चौका! गैप मिला और गेंद बाउंड्री तक।`, `चौका! बहुत अच्छी टाइमिंग।`, `${batter} ने बेहतरीन चौका निकाला।`],
        dot: [`डॉट गेंद। गेंदबाज का अच्छा नियंत्रण।`, `कोई रन नहीं।`, `बल्लेबाज को जगह नहीं मिली।`],
        one: [`एक रन लिया।`, `सिंगल मिल गया।`, `स्ट्राइक बदली।`],
        two: [`दो रन पूरे।`, `गैप में खेला, दो रन।`, `अच्छी दौड़ से दो रन मिले।`],
        three: [`तीन रन मिल गए।`, `बहुत अच्छी दौड़, तीन रन।`, `गेंद डीप में गई, तीन रन।`],
        other: [`${run} रन लिए।`, `${run} रन जुड़े।`, `${run} रन मिले।`],
        score: `स्कोर ${score}।`
      }
    };
    const pack = packs[mode] || packs.en;
    let lines;
    if (flags.isWicket) lines = pack.wicket;
    else if (flags.isWide) lines = total > 1 ? pack.wideRuns : pack.wide;
    else if (flags.isNo) lines = run ? pack.noRuns : pack.no;
    else if (flags.isBye) lines = pack.bye;
    else if (flags.isLb) lines = pack.lb;
    else if (run === 6) lines = pack.six;
    else if (run === 4) lines = pack.four;
    else if (run === 0) lines = pack.dot;
    else if (run === 1) lines = pack.one;
    else if (run === 2) lines = pack.two;
    else if (run === 3) lines = pack.three;
    else lines = pack.other;
    const action = this.commentaryPick(lines, `${mode}-${label}-${batter}-${bowler}`);
    return `${ballNo}: ${base}, ${action} ${pack.score}${chase ? " " + chase : ""}`;
  },

  commentaryText(ballNo, batter, bowler, label, flags = {}) {
    const run = Number(flags.run || 0);
    const score = `${this.state.runs}/${this.state.wkts}`;
    const chase = this.state.inningNumber > 1 && this.state.target ? this.chaseLine() : "";
    const base = `${bowler} to ${batter}`;
    const mode = this.state.commentaryMode || $("commentaryMode")?.value || "en";
    let action = "";
    if (flags.isWicket) {
      const type = flags.wicketInfo?.type || "Wicket";
      const helper = flags.wicketInfo?.helper ? `, ${flags.wicketInfo.helper} involved` : "";
      action = mode === "hi" ? `WICKET! ${type}${helper}. ${batter} आउट हुए.` : mode === "mix" ? `WICKET! ${type}${helper}. ${batter} ko jaana padega.` : `WICKET! ${type}${helper}. ${batter} has to go.`;
    } else if (flags.isWide) {
      action = mode === "hi" ? (flags.totalRuns > 1 ? `Wide, ${flags.totalRuns} रन जुड़े.` : "Wide ball. एक extra run.") : mode === "mix" ? (flags.totalRuns > 1 ? `Wide, ${flags.totalRuns} runs add hue.` : "Wide ball. Extra run added.") : (flags.totalRuns > 1 ? `Wide, ${flags.totalRuns} runs added.` : "Wide ball. Extra run added.");
    } else if (flags.isNo) {
      action = mode === "hi" ? (run ? `No ball aur ${run} रन. Free hit आएगी.` : "No ball. Free hit आएगी.") : mode === "mix" ? (run ? `No ball aur ${run} run${run > 1 ? "s" : ""}. Free hit coming.` : "No ball. Free hit coming.") : (run ? `No ball and ${run} run${run > 1 ? "s" : ""}. Free hit coming.` : "No ball. Free hit coming.");
    } else if (flags.isBye) {
      action = mode === "hi" ? `${flags.totalRuns} bye रन.` : `${flags.totalRuns} bye${flags.totalRuns > 1 ? "s" : ""}.`;
    } else if (flags.isLb) {
      action = mode === "hi" ? `${flags.totalRuns} leg bye रन.` : `${flags.totalRuns} leg bye${flags.totalRuns > 1 ? "s" : ""}.`;
    } else if (run === 6) {
      action = mode === "hi" ? "SIX! शानदार शॉट, गेंद सीमा रेखा के पार." : mode === "mix" ? "SIX! Zabardast hit, seedha boundary ke bahar." : "SIX! Clean strike, all the way.";
    } else if (run === 4) {
      action = mode === "hi" ? "FOUR! गैप मिला और गेंद तेजी से बाउंड्री तक." : mode === "mix" ? "FOUR! Gap mila aur ball boundary tak gayi." : "FOUR! Finds the gap and races away.";
    } else if (run === 0) {
      action = mode === "hi" ? "Dot ball. गेंदबाज का अच्छा नियंत्रण." : mode === "mix" ? "Dot ball. Bowler ka achha control." : "Dot ball. Good control from the bowler.";
    } else if (run === 1) {
      action = mode === "hi" ? "एक रन लिया." : mode === "mix" ? "Single nikal liya." : "Worked away for a single.";
    } else if (run === 2) {
      action = mode === "hi" ? "गैप में खेला, दो रन पूरे." : mode === "mix" ? "Gap me push kiya, do run complete." : "Pushed into the gap, they come back for two.";
    } else if (run === 3) {
      action = mode === "hi" ? "बेहतरीन running, तीन रन." : mode === "mix" ? "Achhi running, teen run mil gaye." : "Excellent running, three taken.";
    } else {
      action = mode === "hi" ? `${run} रन लिए.` : `${run} runs taken.`;
    }
    const scoreText = mode === "hi" ? `स्कोर ${score}.` : `Score ${score}.`;
    return `${ballNo}: ${base}, ${action} ${scoreText}${chase ? " " + chase : ""}`;
  },
  chaseLine() {
    const need = Math.max(Number(this.state.target || 0) - Number(this.state.runs || 0), 0);
    const ballsLeft = Math.max(Number(this.state.totalOvers || 20) * 6 - Number(this.state.balls || 0), 0);
    if (!need) return "Target achieved.";
    return `Need ${need} from ${ballsLeft} balls.`;
  },
  overCommentary(overNo, runs, wickets) {
    const score = `${this.state.runs}/${this.state.wkts}`;
    const wicketText = wickets ? `${wickets} wicket${wickets > 1 ? "s" : ""}` : "no wickets";
    let note = "Steady over.";
    if (wickets >= 2) note = "Major shift in momentum.";
    else if (wickets === 1) note = "Breakthrough over.";
    else if (runs >= 16) note = "Big over for the batting side.";
    else if (runs <= 3) note = "Tidy over from the bowler.";
    const chase = this.state.inningNumber > 1 && this.state.target ? ` ${this.chaseLine()}` : "";
    return `End of over ${overNo}: ${runs} run${runs === 1 ? "" : "s"}, ${wicketText}. Score ${score}. ${note}${chase}`;
  },

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
      this.pickerResolve = (val) => { if (required && !val) return this.toast("Selection is required.", true); $("pickerModal").classList.remove("show"); resolve(val); };
      $("pickerTitle").textContent = title;
      $("pickerManual").value = "";
      $("pickerList").innerHTML = list.length ? list.map(x => `<button class="picker-option" data-name="${this.safe(x)}">${this.safe(x)}</button>`).join("") : `<div class="item">No players. Type manually.</div>`;
      document.querySelectorAll(".picker-option").forEach(b => b.onclick = () => this.closePicker(b.dataset.name));
      $("pickerModal").classList.add("show");
    });
  },
  closePicker(val) { if (this.pickerResolve) this.pickerResolve(val); },

  async manualSaveScore() {
    if (!this.state?.matchId) return this.toast("Start a match first.", true);
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
      this.toast("Unable to save score: " + error.message, true);
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
    $("topStatus").textContent = s.matchFinished ? "COMPLETE" : (s.status === "scheduled" ? "SCHEDULED" : (s.liveStarted ? (s.liveControl.mode || "LIVE").toUpperCase() : "NO LIVE"));
    $("topStatus").className = `status-pill ${s.matchFinished ? "complete" : (s.liveStarted ? "live" : "")}`;
    $("runs").textContent = s.runs; $("wkts").textContent = s.wkts; $("overs").textContent = overText(s.balls);
    $("crr").textContent = s.balls ? (s.runs / (s.balls / 6)).toFixed(2) : "0.00";
    const remBalls = Math.max(Number(s.totalOvers || 20) * 6 - s.balls, 0); const need = s.target ? Math.max(s.target - s.runs, 0) : null;
    $("targetBox").textContent = s.target || "-"; $("needBox").textContent = need ?? "-"; $("rrrBox").textContent = need == null ? "-" : (remBalls ? ((need * 6) / remBalls).toFixed(2) : "0.00"); $("partnershipBox").textContent = `${s.partnershipRuns} (${s.partnershipBalls})`;
    $("batsmanRows").innerHTML = [s.bat1, s.bat2].map((b, i) => `<tr><td><b>${this.safe(b.name)}</b> ${(s.striker === i + 1 && !b.retired) ? "*" : ""}</td><td>${b.r}</td><td>${b.b}</td><td>${b.f}</td><td>${b.s}</td><td>${calcSR(b.r, b.b)}</td></tr>`).join("");
    $("bowlerRows").innerHTML = `<tr><td><b>${this.safe(s.bowler.name)}</b></td><td>${overText(s.bowler.balls)}</td><td>${s.bowler.r}</td><td>${s.bowler.w}</td><td>${calcER(s.bowler.r, s.bowler.balls)}</td></tr>`;
    $("thisOver").innerHTML = s.over.length ? s.over.map(x => `<span class="ball ${this.ballClass(x)}">${this.safe(String(x).slice(0, 3))}</span>`).join("") : "<span class='item'>No balls</span>";
    $("recentBalls").innerHTML = s.recentBalls.length ? s.recentBalls.map(x => `<div class="item"><b>${this.safe(x.label)}</b> ${this.safe(x.score)}<br><small>${this.safe(x.text)}</small></div>`).join("") : "<div class='item'>No recent balls</div>";
    $("overSummary").innerHTML = s.overSummary.length ? s.overSummary.map(o => `<div class="item">Over ${o.overNo} ${o.bowler ? "- " + this.safe(o.bowler) : ""}: ${o.timeline.map(x => this.safe(x)).join(" ")}</div>`).join("") : "<div class='item'>No over completed</div>";
    $("fowList").innerHTML = s.fallOfWickets.length ? s.fallOfWickets.map((x, i) => `<div class="item">${i + 1}. ${this.safe(x)}</div>`).join("") : "<div class='item'>No wickets</div>";
    $("commentaryList").innerHTML = s.commentary.length ? s.commentary.slice(0, 30).map(c => `<div class="item"><b>${this.safe(c.ball)}</b> ${this.safe(c.text)}</div>`).join("") : "<div class='item'>No commentary</div>";
    document.querySelectorAll(".mode").forEach(b => b.classList.toggle("active", b.dataset.mode === s.liveControl.mode));
    const scoreDisabled = !s.matchId || !s.liveStarted || s.matchFinished || s.scoringLocked || s.status === "scheduled";
    document.querySelectorAll(".run-grid button").forEach(b => { b.disabled = scoreDisabled; b.classList.toggle("disabled", scoreDisabled); });
    ["wide", "noball", "bye", "legbye", "wicket"].forEach(id => { if ($(id)) $(id).disabled = scoreDisabled; });
    ["swapBtn", "retireBtn", "changeBatsmanBtn", "changeBowlerBtn"].forEach(id => { if ($(id)) $(id).disabled = scoreDisabled; });
    if ($("switchInningsBtn")) $("switchInningsBtn").disabled = !s.matchId || s.matchFinished || Number(s.inningNumber || 1) > 1 || s.status === "scheduled";
    if ($("startSuperOverBtn")) $("startSuperOverBtn").classList.toggle("hidden", !(s.status === "tied" || s.winnerText === "Match Tied"));
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
    this.renderAdminTeamProfile();
  },
  selectTeam(id) {
    const t = this.teamById(id); if (!t) return; this.selectedTeamId = id; $("teamId").value = id; $("teamName").value = t.name || ""; $("teamShort").value = t.shortName || ""; $("teamLogo").value = t.logo || ""; $("selectedTeamName").textContent = t.name;
    this.renderAdminTeamProfile();
    if (this.activeUnsubPlayers) this.activeUnsubPlayers();
    this.activeUnsubPlayers = listenPlayers(id, players => { t.players = players; this.renderPlayers(players); this.fillTeamSelectors(); this.renderAdminTeamProfile(); }, e => this.toast(e.message, true));
  },
  renderAdminTeamProfile() {
    const box = $("adminTeamProfile");
    if (!box) return;
    const team = this.teamById(this.selectedTeamId);
    if (!team) return box.innerHTML = "<div class='item'>Select a team to view profile.</div>";
    const pts = this.teamLeaguePoints(team.name);
    const logo = team.logo ? `<img src="${this.safe(team.logo)}" alt="">` : this.short(team.name);
    box.innerHTML = `<div class="admin-team-head"><div class="logo-preview">${logo}</div><div><h3>${this.safe(team.name)}</h3><p>${this.safe(team.shortName || this.short(team.name))}</p></div></div><div class="small-metrics"><div><span>Players</span><b>${(team.players || []).length}</b></div><div><span>Played</span><b>${pts.P || 0}</b></div><div><span>Won</span><b>${pts.W || 0}</b></div><div><span>Points</span><b>${pts.Pts || 0}</b></div></div><div class="admin-team-squad">${(team.players || []).map(p => `<span>${this.safe(p.name)}</span>`).join("") || "<small>No players added</small>"}</div>`;
  },
  teamLeaguePoints(teamName) {
    const league = this.currentLeague();
    return league?.pointsTable?.[teamName] || this.state.pointsTable?.[teamName] || {};
  },
  renderPlayers(players = []) { $("playerList").innerHTML = players.map(p => `<div class="card-mini" data-id="${p.playerId}"><b>${this.safe(p.name)}</b><br><small>${this.safe(p.role || "Player")}</small></div>`).join("") || "<div class='item'>No players</div>"; document.querySelectorAll("#playerList .card-mini").forEach(el => el.onclick = () => this.selectPlayer(el.dataset.id)); },
  selectPlayer(id) { const team = this.teamById(this.selectedTeamId); const p = (team?.players || []).find(x => x.playerId === id); if (!p) return; this.selectedPlayerId = id; $("playerId").value = id; $("playerName").value = p.name || ""; $("playerRole").value = p.role || "Batsman"; $("battingStyle").value = p.battingStyle || ""; $("bowlingStyle").value = p.bowlingStyle || ""; $("jerseyNo").value = p.jerseyNo || ""; $("playerImage").value = p.image || ""; },
  async saveTeamForm() { const id = $("teamId").value || undefined; const name = $("teamName").value.trim(); if (!name) return this.toast("Team name is required.", true); const teamId = await saveTeam({ teamId: id, name, shortName: $("teamShort").value.trim(), logo: $("teamLogo").value.trim() }); this.selectTeam(teamId); this.toast("Team saved."); },
  clearTeamForm() { ["teamId", "teamName", "teamShort", "teamLogo"].forEach(id => $(id).value = ""); this.selectedTeamId = ""; },
  async deleteSelectedTeam() { if (!this.selectedTeamId || !confirm("Delete this team?")) return; await deleteTeam(this.selectedTeamId); this.clearTeamForm(); this.toast("Team deleted."); },
  async savePlayerForm() { if (!this.selectedTeamId) return this.toast("Select a team first.", true); const name = $("playerName").value.trim(); if (!name) return this.toast("Player name is required.", true); await savePlayer(this.selectedTeamId, { playerId: $("playerId").value || undefined, name, role: $("playerRole").value, battingStyle: $("battingStyle").value, bowlingStyle: $("bowlingStyle").value, jerseyNo: $("jerseyNo").value, image: $("playerImage").value.trim() }); this.clearPlayerForm(false); this.toast("Player saved."); },
  clearPlayerForm(clearId = true) { ["playerId", "playerName", "battingStyle", "bowlingStyle", "jerseyNo", "playerImage"].forEach(id => $(id).value = ""); if (clearId) this.selectedPlayerId = ""; },
  async deleteSelectedPlayer() { if (!this.selectedTeamId || !this.selectedPlayerId || !confirm("Delete this player?")) return; await deletePlayer(this.selectedTeamId, this.selectedPlayerId); this.clearPlayerForm(); this.toast("Player deleted."); },

  async uploadImage(file, targetInput) { if (!file) return; if (!cloudinaryConfig.cloudName || cloudinaryConfig.cloudName.includes("YOUR")) return this.toast("Cloudinary configuration is required.", true); const fd = new FormData(); fd.append("file", file); fd.append("upload_preset", cloudinaryConfig.uploadPreset); try { const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`, { method: "POST", body: fd }); if (!res.ok) throw new Error("Cloudinary upload failed"); const json = await res.json(); $(targetInput).value = json.secure_url || json.url || ""; this.toast("Image uploaded."); } catch (e) { this.toast(e.message, true); } },

  renderLeagueTeamChecks() { const source = this.editingLeagueId ? this.leagues.find(l => l.leagueId === this.editingLeagueId) : null; const selected = new Set((source?.teams || []).map(t => t.teamId).filter(Boolean)); $("leagueTeamChecks").innerHTML = this.teams.map(t => `<label><input type="checkbox" value="${t.teamId}" ${selected.has(t.teamId) ? "checked" : ""}> ${this.safe(t.name)}</label>`).join("") || "No teams"; },
  includeEliminatorOn() { const el = $("includeEliminator"); return el?.type === "checkbox" ? el.checked : el?.value !== "off"; },
  currentLeague() { return (this.editingLeagueId && this.leagues.find(l => l.leagueId === this.editingLeagueId)) || this.state.league || this.leagues.find(l => l.leagueId === $("setupLeague")?.value) || this.leagues[0] || null; },
  currentSchedule() { return this.draftSchedule || this.currentLeague()?.schedule || []; },
  teamOptions(selected = "") { return `<option value="">TBA</option>` + this.teams.map(t => `<option value="${t.teamId}" ${t.teamId === selected ? "selected" : ""}>${this.safe(t.name)}</option>`).join(""); },

  openLeagueEditor(title = "Create League") {
    if ($("publicLeagueTabs")?.checked === false) {
      $("leagueEditor")?.classList.add("hidden");
      return;
    }
    $("leagueEditor")?.classList.remove("hidden");
    if ($("leagueEditorTitle")) $("leagueEditorTitle").textContent = title;
  },

  newLeagueEditor() {
    this.editingLeagueId = "";
    this.editingFixtureIndex = null;
    this.draftSchedule = [];
    ["leagueName", "leagueShort", "leagueSeason", "leagueLogo"].forEach(id => $(id).value = "");
    $("leagueOvers").value = 20;
    $("leagueFormat").value = "single";
    $("includeEliminator").value = "on";
    $("iplPlayoffs").checked = true;
    this.updatePublicLeagueTabsButton();
    document.querySelectorAll("#leagueTeamChecks input").forEach(x => x.checked = false);
    this.openLeagueEditor("Create League");
    this.renderLeagueSchedule();
  },

  loadSelectedLeagueForEdit() {
    const id = $("leagueManageSelect")?.value || "";
    const league = this.leagues.find(l => l.leagueId === id);
    if (!league) return this.toast("Select a league first.", true);
    this.editingLeagueId = league.leagueId;
    this.editingFixtureIndex = null;
    this.draftSchedule = clone(league.schedule || []);
    $("leagueName").value = league.name || "";
    $("leagueShort").value = league.shortName || "";
    $("leagueSeason").value = league.season || "";
    $("leagueLogo").value = league.logo || "";
    $("leagueOvers").value = league.defaultOvers || 20;
    $("leagueFormat").value = league.format || "single";
    $("includeEliminator").value = league.includeEliminator === false ? "off" : "on";
    $("iplPlayoffs").checked = league.playoffs !== false;
    $("publicLeagueTabs").checked = league.showPublicLeague !== false;
    localStorage.setItem(PUBLIC_LEAGUE_TABS_KEY, $("publicLeagueTabs").checked ? "on" : "off");
    this.updatePublicLeagueTabsButton();
    const ids = new Set((league.teams || []).map(t => t.teamId).filter(Boolean));
    document.querySelectorAll("#leagueTeamChecks input").forEach(x => x.checked = ids.has(x.value));
    this.openLeagueEditor("Edit League");
    this.renderLeagueSchedule();
  },

  async deleteSelectedLeague() {
    const id = $("leagueManageSelect")?.value || this.editingLeagueId || "";
    const league = this.leagues.find(l => l.leagueId === id);
    if (!league) return this.toast("Select a league first.", true);
    if (!confirm(`Delete league "${league.name}"? Schedule, points table, and league data will be removed.`)) return;
    await deleteLeague(id);
    if (this.editingLeagueId === id) this.newLeagueEditor();
    this.toast("League deleted.");
  },

  generateSchedule() {
    const ids = [...document.querySelectorAll("#leagueTeamChecks input:checked")].map(x => x.value);
    const teams = ids.map(id => this.teamById(id)).filter(Boolean);
    if (teams.length < 2) return this.toast("Select at least two teams.", true);
    if (this.currentSchedule().length && !confirm("Generate a new schedule? The current draft schedule will be replaced.")) return;
    const format = $("leagueFormat").value;
    const schedule = [];
    let n = 1;

    if (format === "knockout") {
      const round = teams.length <= 2 ? "Final" : (teams.length <= 4 ? "Semi Final" : "Knockout");
      for (let i = 0; i < teams.length; i += 2) {
        schedule.push({ id: makeId("fix"), stage: i + 1 >= teams.length ? "Bye" : round, round, teamA: this.teamObj(teams[i]), teamB: this.teamObj(teams[i + 1]) || { name: "TBA" }, overs: Number($("leagueOvers").value || 20), venue: "", matchDate: "", matchTime: "", status: "pending", matchNo: n++ });
      }
      if (teams.length > 2) schedule.push({ id: makeId("fix"), stage: "Final", round: "Final", teamA: { name: "Winner SF 1" }, teamB: { name: "Winner SF 2" }, overs: Number($("leagueOvers").value || 20), venue: "", matchDate: "", matchTime: "", status: "pending", matchNo: n++ });
    } else {
      const rounds = format === "double" ? 2 : 1;
      for (let r = 1; r <= rounds; r++) for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
        schedule.push({ id: makeId("fix"), stage: "League", round: `Round ${r}`, teamA: r === 1 ? this.teamObj(teams[i]) : this.teamObj(teams[j]), teamB: r === 1 ? this.teamObj(teams[j]) : this.teamObj(teams[i]), overs: Number($("leagueOvers").value || 20), venue: "", matchDate: "", matchTime: "", status: "pending", matchNo: n++ });
      }
      if ($("iplPlayoffs").checked) {
        const stages = this.includeEliminatorOn() ? ["Qualifier 1", "Eliminator", "Qualifier 2", "Final"] : ["Qualifier 1", "Qualifier 2", "Final"];
        stages.forEach(stage => schedule.push({ id: makeId("fix"), stage, round: "Playoffs", teamA: { name: "TBA" }, teamB: { name: "TBA" }, overs: Number($("leagueOvers").value || 20), venue: "", matchDate: "", matchTime: "", status: "pending", matchNo: n++ }));
      }
    }
    this.draftSchedule = schedule;
    this.editingFixtureIndex = null;
    this.renderLeagueSchedule();
  },

  async saveLeagueForm() {
    const selectedTeams = [...document.querySelectorAll("#leagueTeamChecks input:checked")].map(x => this.teamObj(this.teamById(x.value))).filter(Boolean);
    const existing = (this.editingLeagueId && this.leagues.find(l => l.leagueId === this.editingLeagueId)) || (this.state.league?.leagueId ? this.state.league : null);
    const league = { leagueId: this.editingLeagueId || existing?.leagueId || undefined, name: $("leagueName").value.trim() || existing?.name || "Cricket League", shortName: $("leagueShort").value.trim(), season: $("leagueSeason").value.trim(), logo: $("leagueLogo").value.trim(), defaultOvers: Number($("leagueOvers").value || 20), format: $("leagueFormat").value, playoffs: $("iplPlayoffs").checked, includeEliminator: this.includeEliminatorOn(), showPublicLeague: $("publicLeagueTabs").checked, teams: selectedTeams.length ? selectedTeams : (existing?.teams || []), schedule: this.draftSchedule || existing?.schedule || [], pointsTable: existing?.pointsTable || this.state.pointsTable || {}, pointsAppliedMatchIds: existing?.pointsAppliedMatchIds || this.state.league?.pointsAppliedMatchIds || {}, status: "active" };
    await saveLeague(league);
    this.state.league = league;
    this.state.showPublicLeague = $("publicLeagueTabs").checked;
    this.draftSchedule = league.schedule;
    if (this.state.matchId && this.state.leagueId === league.leagueId && !this.state.matchFinished) {
      this.state.pointsTable = league.pointsTable || this.state.pointsTable || {};
      await this.saveAll(true);
    }
    this.toast("League saved.");
    this.renderLeagueSchedule();
  },

  clearLeagueForm() {
    const hasData = this.currentSchedule().length || ["leagueName", "leagueShort", "leagueSeason", "leagueLogo"].some(id => $(id).value.trim());
    if (hasData && !confirm("Clear the draft form? The saved Firebase league will not change until you save.")) return;
    ["leagueName", "leagueShort", "leagueSeason", "leagueLogo"].forEach(id => $(id).value = "");
    this.updatePublicLeagueTabsButton();
    this.editingLeagueId = "";
    this.editingFixtureIndex = null;
    this.draftSchedule = [];
    this.renderLeagueSchedule();
  },

  editFixture(index) {
    this.editingFixtureIndex = index;
    this.renderLeagueSchedule();
  },

  cancelFixtureEdit() {
    this.editingFixtureIndex = null;
    this.renderLeagueSchedule();
  },

  updateFixture(index, field, value) {
    const schedule = this.currentSchedule();
    const fixture = schedule[index];
    if (!fixture) return;
    if (field === "teamA" || field === "teamB") fixture[field] = this.teamObj(this.teamById(value)) || { name: "TBA" };
    else if (field === "overs" || field === "matchNo") fixture[field] = Number(value || 0);
    else fixture[field] = value;
    this.draftSchedule = schedule;
    this.renderLeagueSchedule();
  },

  async saveFixture(index) {
    const schedule = this.currentSchedule();
    const fixture = schedule[index];
    if (!fixture) return;
    this.draftSchedule = schedule;
    const league = this.editingLeagueId ? this.leagues.find(l => l.leagueId === this.editingLeagueId) : this.state.league;
    if (!league?.leagueId) {
      this.toast("Fixture draft saved. Use Save League to publish changes.");
      this.editingFixtureIndex = null;
      this.renderLeagueSchedule();
      return;
    }
    const updated = { ...league, schedule: this.draftSchedule };
    if (String(fixture.status || "").toLowerCase() === "no-result") this.applyNoResultFixture(updated, fixture);
    await saveLeague(updated);
    if (this.state.league?.leagueId === updated.leagueId) this.state.league = updated;
    if (this.state.matchId && this.state.leagueId === updated.leagueId && !this.state.matchFinished) await this.saveAll(true);
    this.editingFixtureIndex = null;
    this.toast("Fixture saved.");
    this.renderLeagueSchedule();
  },

  applyNoResultFixture(league, fixture) {
    const key = fixture.matchId || fixture.id || `fixture_${fixture.matchNo || ""}`;
    const applied = league.pointsAppliedMatchIds || {};
    if (!key || applied[key]) return;
    const a = fixture.teamA?.name || "";
    const b = fixture.teamB?.name || "";
    if (!a || !b || a === "TBA" || b === "TBA") return;
    const impact = {
      matchId: key,
      status: "no-result",
      teams: {
        [a]: { P: 1, W: 0, L: 0, T: 0, NR: 1, Pts: 1, RF: 0, BF: 0, RA: 0, BA: 0 },
        [b]: { P: 1, W: 0, L: 0, T: 0, NR: 1, Pts: 1, RF: 0, BF: 0, RA: 0, BA: 0 }
      }
    };
    this.applyPointsImpact(league, impact, 1);
    league.pointsAppliedMatchIds = { ...applied, [key]: true };
    fixture.pointsImpact = impact;
    fixture.result = "No Result";
  },

  useFixtureSetup(index, fromSetupSelect = false) {
    const selectedLeague = this.leagues.find(l => l.leagueId === $("setupLeague")?.value);
    const schedule = Array.isArray(selectedLeague?.schedule) ? selectedLeague.schedule : this.currentSchedule();
    const fixture = schedule[index];
    if (!fixture) return;
    const a = fixture.teamA?.teamId, b = fixture.teamB?.teamId;
    if (!a || !b) return this.toast("Select both fixture teams before loading setup.", true);
    const league = selectedLeague || this.currentLeague();
    if (league?.leagueId) $("setupLeague").value = league.leagueId;
    $("teamASelect").value = a;
    $("teamBSelect").value = b;
    $("totalOvers").value = fixture.overs || $("leagueOvers").value || 20;
    $("venue").value = fixture.venue || "";
    $("matchDate").value = fixture.matchDate || "";
    $("matchTime").value = fixture.matchTime || "";
    $("matchType").value = fixture.stage || league?.shortName || "T20";
    this.pendingFixture = { id: fixture.id, index, stage: fixture.stage || "", round: fixture.round || "", matchNo: fixture.matchNo || "" };
    this.refreshSetupPlayers();
    $("tossWinner").value = "";
    $("openingStriker").value = "";
    this.refreshSetupPlayers();
    $("openingNonStriker").value = "";
    $("openingBowler").value = "";
    this.openPage("setup");
    this.toast(fromSetupSelect ? "Schedule loaded. Select toss and players when match starts." : "Fixture loaded into match setup.");
  },

  autoFillPlayoffs() {
    const schedule = this.currentSchedule();
    const pts = this.state.pointsTable || this.currentLeague()?.pointsTable || {};
    const ranked = Object.entries(pts).sort((a, b) => (Number(b[1].Pts || 0) - Number(a[1].Pts || 0)) || (Number(this.nrr(b[1])) - Number(this.nrr(a[1])))).map(([name]) => this.teams.find(t => t.name === name) || { name });
    if (ranked.length < 2) return this.toast("Not enough ranked teams in the points table.", true);
    const setStage = (stage, teamA, teamB) => {
      const row = schedule.find(m => String(m.stage || "").toLowerCase() === stage.toLowerCase());
      if (row) { row.teamA = this.teamObj(teamA) || teamA || { name: "TBA" }; row.teamB = this.teamObj(teamB) || teamB || { name: "TBA" }; }
    };
    setStage("Qualifier 1", ranked[0], ranked[1]);
    setStage("Eliminator", ranked[2], ranked[3]);
    setStage("Qualifier 2", { name: "Loser Qualifier 1" }, { name: this.includeEliminatorOn() ? "Winner Eliminator" : "Rank 3" });
    setStage("Final", { name: "Winner Qualifier 1" }, { name: "Winner Qualifier 2" });
    this.draftSchedule = schedule;
    this.renderLeagueSchedule();
    this.toast("Playoff fixtures auto-filled.");
  },

  renderLeagueSchedule() {
    const current = this.currentSchedule();
    const pts = this.state.pointsTable || this.currentLeague()?.pointsTable || {};
    const done = current.filter(x => ["completed", "done"].includes(String(x.status || "").toLowerCase())).length;
    const pending = current.length - done;
    const next = current.find(x => !["completed", "done"].includes(String(x.status || "").toLowerCase()));
    if ($("leagueDashboard")) $("leagueDashboard").innerHTML = `<div><span>Matches</span><b>${current.length}</b></div><div><span>Completed</span><b>${done}</b></div><div><span>Pending</span><b>${pending}</b></div><div><span>Next</span><b>${this.safe(next ? `${next.teamA?.name || "TBA"} vs ${next.teamB?.name || "TBA"}` : "-")}</b></div>`;
    $("leagueSchedule").innerHTML = current.length ? current.map((m, i) => {
      const result = m.result || m.winnerText || "";
      const score = [m.firstInnings, m.secondInnings].filter(Boolean).join(" | ");
      const disabled = ["completed", "done"].includes(String(m.status || "").toLowerCase()) ? "disabled" : "";
      const isEditing = this.editingFixtureIndex === i;
      const when = [m.matchDate, m.matchTime].filter(Boolean).join(" ");
      const summary = [this.safe(m.stage || "League"), this.safe(m.round || ""), when ? this.safe(when) : "", m.venue ? this.safe(m.venue) : "", `Overs ${Number(m.overs || 20)}`].filter(Boolean).join(" | ");
      const controls = isEditing ? `<div class="grid3"><div><label>Team A</label><select onchange="app.updateFixture(${i}, 'teamA', this.value)" ${disabled}>${this.teamOptions(m.teamA?.teamId || "")}</select></div><div><label>Team B</label><select onchange="app.updateFixture(${i}, 'teamB', this.value)" ${disabled}>${this.teamOptions(m.teamB?.teamId || "")}</select></div><div><label>Status</label><select onchange="app.updateFixture(${i}, 'status', this.value)"><option value="pending" ${String(m.status || "pending") === "pending" ? "selected" : ""}>Pending</option><option value="live" ${m.status === "live" ? "selected" : ""}>Live</option><option value="completed" ${m.status === "completed" ? "selected" : ""}>Completed</option><option value="cancelled" ${m.status === "cancelled" ? "selected" : ""}>Cancelled</option><option value="no-result" ${m.status === "no-result" ? "selected" : ""}>No Result</option></select></div></div><div class="grid3"><div><label>Stage</label><input value="${this.safe(m.stage || "")}" onchange="app.updateFixture(${i}, 'stage', this.value)" ${disabled}></div><div><label>Date</label><input type="date" value="${this.safe(m.matchDate || "")}" onchange="app.updateFixture(${i}, 'matchDate', this.value)" ${disabled}></div><div><label>Time</label><input type="time" value="${this.safe(m.matchTime || "")}" onchange="app.updateFixture(${i}, 'matchTime', this.value)" ${disabled}></div></div><div class="grid2"><div><label>Overs</label><input type="number" min="1" value="${Number(m.overs || 20)}" onchange="app.updateFixture(${i}, 'overs', this.value)" ${disabled}></div><div><label>Match No</label><input type="number" min="1" value="${Number(m.matchNo || i + 1)}" onchange="app.updateFixture(${i}, 'matchNo', this.value)" ${disabled}></div></div><label>Venue</label><input value="${this.safe(m.venue || "")}" onchange="app.updateFixture(${i}, 'venue', this.value)" ${disabled}><div class="actions"><button class="btn primary" onclick="app.saveFixture(${i})">Save Fixture</button><button class="btn light" onclick="app.cancelFixtureEdit()">Close</button><button class="btn" onclick="app.useFixtureSetup(${i})" ${disabled}>Use Setup</button></div>` : `<small>${summary}${result ? " | " + this.safe(result) : ""}${score ? " | " + this.safe(score) : ""}</small><div class="actions"><button class="btn" onclick="app.editFixture(${i})">Edit</button><button class="btn primary" onclick="app.useFixtureSetup(${i})" ${disabled}>Use Setup</button></div>`;
      return `<div class="item fixture-row"><div class="fixture-head"><b>${Number(m.matchNo || i + 1)}. ${this.safe(m.teamA?.name || m.teamA || "TBA")} vs ${this.safe(m.teamB?.name || m.teamB || "TBA")}</b><span>${this.safe(m.status || "pending")}</span></div>${controls}</div>`;
    }).join("") : "<div class='item'>No schedule</div>";
    $("leaguePoints").innerHTML = Object.entries(pts).map(([team, p]) => `<tr><td>${this.safe(team)}</td><td>${p.P || 0}</td><td>${p.W || 0}</td><td>${p.L || 0}</td><td>${p.T || 0}</td><td>${p.NR || 0}</td><td>${p.Pts || 0}</td><td>${this.nrr(p)}</td></tr>`).join("") || `<tr><td colspan="8">No points</td></tr>`;
  },
  nrr(p) { const rf = p.BF ? p.RF / (p.BF / 6) : 0; const ra = p.BA ? p.RA / (p.BA / 6) : 0; return (rf - ra).toFixed(3); },

  renderHistory() {
    const saved = this.getActiveBackup();
    const continueCard = saved ? this.historyContinueCard(saved) : "";
    const savedId = saved?.state?.matchId || "";
    const scheduledHtml = (this.scheduled || [])
      .filter(m => m.matchId && m.matchId !== savedId)
      .map(m => this.scheduledHistoryCard(m))
      .join("");
    const historyHtml = this.completed.map(m => `<div class="card-mini"><b>${this.safe(m.matchTitle || m.title || "Match")}</b><br><small>${this.safe(m.leagueName || "")}</small><p>${this.safe(m.firstInnings || "")} ${m.secondInnings ? " | " + this.safe(m.secondInnings) : ""}</p><b>${this.safe(m.winnerText || "-")}</b><div class="actions"><button class="btn light" onclick="window.open('user.html?match=${m.matchId}','_blank')">View</button><button class="btn" onclick="window.open('scorecard-download.html?match=${m.matchId}','_blank')">PDF</button><button class="btn warn" onclick="app.editManOfMatch('${m.matchId}')">Edit MVP</button><button class="btn danger" onclick="app.deleteHistoryMatch('${m.matchId}')">Delete</button></div></div>`).join("");
    $("historyList").innerHTML = continueCard + scheduledHtml + (historyHtml || "<div class='item'>No completed matches</div>");
  },

  historyContinueCard(saved) {
    const s = saved.state || {};
    const scheduled = String(s.status || "").toLowerCase() === "scheduled";
    const detail = scheduled
      ? ([s.matchDate, s.matchTime].filter(Boolean).join(" ") || "Schedule saved")
      : `${this.safe(s.battingTeam?.name || "-")} ${Number(s.runs || 0)}/${Number(s.wkts || 0)} (${overText(s.balls || 0)})`;
    return `<div class="card-mini" style="border-color:#f59e0b;background:#fffbeb"><b>${scheduled ? "Scheduled Match Setup" : "Unfinished Match Backup"}</b><br><small>${this.safe(s.matchTitle || saved.matchId)}</small><p>${this.safe(detail)}</p><div class="actions"><button class="btn" onclick="app.continueRecoveredMatch()">${scheduled ? "Continue Setup" : "Continue Match"}</button><button class="btn light" onclick="window.open('user.html?match=${s.matchId}','_blank')">Open User</button></div></div>`;
  },

  scheduledHistoryCard(match) {
    const detail = [match.matchDate, match.matchTime].filter(Boolean).join(" ") || "Schedule saved";
    return `<div class="card-mini" style="border-color:#0ea5e9;background:#f0f9ff"><b>Scheduled Match Setup</b><br><small>${this.safe(match.matchTitle || match.title || match.matchId)}</small><p>${this.safe(detail)}</p><div class="actions"><button class="btn" onclick="app.continueScheduledMatch('${this.safe(match.matchId)}')">Continue Setup</button><button class="btn light" onclick="window.open('user.html?match=${this.safe(match.matchId)}','_blank')">Open User</button></div></div>`;
  },

  async continueScheduledMatch(matchId) {
    const match = (this.scheduled || []).find(m => m.matchId === matchId);
    if (!match) return this.toast("Scheduled match not found.", true);
    this.state = normalizeState({ ...match, setupMode: "schedule", status: "scheduled", liveStarted: false });
    this.currentMatchId = this.state.matchId;
    this.needsSetupSync = true;
    this.persistActiveMatch();
    this.openPage("setup");
    await this.saveAll(true);
    this.toast("Scheduled setup loaded from Firebase.");
  },

  async editManOfMatch(matchId) {
    const match = this.completed.find(m => m.matchId === matchId);
    if (!match) return this.toast("Match not found.", true);
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
      this.toast("Player of the Match updated to " + playerName + ".");
      this.completed = this.completed.map(m => m.matchId === matchId ? { ...m, playerOfMatch: playerName, mvp: playerName } : m);
      this.renderHistory();
      this.closeMvpModal();
    }).catch(e => this.toast("Unable to update: " + e.message, true));
  },

  async deleteHistoryMatch(matchId) {
    const match = this.completed.find(m => m.matchId === matchId);
    const enteredId = prompt(`Delete match ${matchId}?
Type the match ID to confirm permanent deletion:`);
    if (enteredId === null) return;
    if (enteredId.trim() !== matchId) {
      this.toast("Match ID mismatch. Deletion cancelled.", true);
      return;
    }
    try {
      await this.rollbackLeagueForDeletedMatch(match || { matchId });
      await deleteCompletedMatch(matchId);
      this.toast("Match deleted successfully.");
      this.completed = this.completed.filter(m => m.matchId !== matchId);
      this.renderHistory();
    } catch (e) {
      this.toast("Unable to delete match: " + e.message, true);
    }
  },

  async rollbackLeagueForDeletedMatch(match) {
    const matchId = match?.matchId || "";
    if (!matchId) return;
    const league = this.leagues.find(l => l.leagueId === match.leagueId)
      || this.leagues.find(l => (l.schedule || []).some(f => f.matchId === matchId));
    if (!league?.leagueId) return;
    const schedule = Array.isArray(league.schedule) ? clone(league.schedule) : [];
    const fixture = schedule.find(f => f.matchId === matchId);
    const impact = fixture?.pointsImpact || match.pointsImpact || null;
    const updated = { ...league, schedule };
    if (impact) this.applyPointsImpact(updated, impact, -1);
    if (updated.pointsAppliedMatchIds?.[matchId]) {
      updated.pointsAppliedMatchIds = { ...updated.pointsAppliedMatchIds };
      delete updated.pointsAppliedMatchIds[matchId];
    }
    if (fixture) {
      fixture.status = "pending";
      delete fixture.matchId;
      delete fixture.winnerText;
      delete fixture.result;
      delete fixture.firstInnings;
      delete fixture.secondInnings;
      delete fixture.completedAt;
      delete fixture.pointsImpact;
    }
    await saveLeague(updated);
    if (this.state.league?.leagueId === updated.leagueId) {
      this.state.league = updated;
      this.state.pointsTable = updated.pointsTable || {};
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
