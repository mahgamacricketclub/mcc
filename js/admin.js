import { listenLiveMatch, writeLiveMatch } from "./firebase-live.js";
import { listenTeamCatalog, saveTeamCatalogData, listenMatchStore, getLegacyMatchStore, saveMatchStore, saveSavedLinks } from "./firebase-store.js";
import { buildLivePayload, buildStorePayload } from "./live-sync.js";
import { persistCompletedMatch } from "./history-manager.js";

const params = new URLSearchParams(location.search);
const MATCH_ID = (params.get("match") || "liveMatch1").trim();
const TEAM_BACKUP_KEY = "cricket_team_catalog_backup";
const SAVED_LINKS_KEY = "cricket_saved_links";
const UNDO_BACKUP_KEY = `cricket_undo_backup_${MATCH_ID}`;
const MATCH_BACKUP_KEY = `cricket_live_match_backup_${MATCH_ID}`;
const ADMIN_PASSWORD = "Sahib12@";
const CLOUD_NAME = "dsnuatuc8";
const UPLOAD_PRESET = "ml_default";

window.app = {
  isHydrated:false,
  hasLocalChanges:false,
  hasTeamCatalog:false,
  dirtyTeams:new Set(),
  sessionId: (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("admin-" + Date.now()),
  state: {
    runs:0,wkts:0,balls:0,extras:0,striker:1,
    bat1:{name:"-",r:0,b:0,f:0,s:0}, bat2:{name:"-",r:0,b:0,f:0,s:0}, bowler:{name:"-",balls:0,m:0,r:0,w:0},
    over:[],overSummary:[],commentary:[],highlights:[],history:[],ballHistory:[],ballEvents:[],
    inningNumber:1,matchTitle:"Select Teams",battingTeam:"",bowlingTeam:"",tossText:"Toss pending",
    tossWinner:"A",tossDecision:"bat",
    wicketType:"",wicketHelper:"",partnershipRuns:0,partnershipBalls:0,lastWicket:"-",lastOverBowler:"-",firstInningsScore:null,firstInningsWkts:null,target:null,totalOvers:20,matchFinished:false,winnerText:"",
    scoringLocked:false,bowlerStats:{},fallOfWickets:[],completedMatches:[],resultRecorded:false,tournamentStats:{players:{}},pointsTable:{},mvpLog:[],archived:false,offlineQueue:[],
    dismissedPlayers:[],
    liveControl:{mode:"live",note:""},
    updatedBy:"",
    activeLeagueMatch:null,
    teams:{},
    teamInfo:{},
    league:{name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]},
    benchPlayers:[],
    battingScorecard:[],
    completedInnings:{},completedBowling:{}
  },
  init(){
    this.bindAuthEvents();
    if(localStorage.getItem("cricket_admin_unlocked") !== ADMIN_PASSWORD){
      this.setStatus("Admin: locked","");
      return;
    }
    this.startApp();
  },
  bindAuthEvents(){
    const input=document.getElementById("adminPasswordInput");
    const btn=document.getElementById("adminLoginBtn");
    if(input) input.addEventListener("keydown",(e)=>{ if(e.key==="Enter") this.unlockAdmin(); });
    if(btn) btn.addEventListener("click",()=>this.unlockAdmin());
  },
  unlockAdmin(){
    const input=document.getElementById("adminPasswordInput");
    const error=document.getElementById("authError");
    if((input?.value||"")!==ADMIN_PASSWORD){
      if(error) error.innerText="Wrong password";
      return;
    }
    localStorage.setItem("cricket_admin_unlocked",ADMIN_PASSWORD);
    this.startApp();
  },
  startApp(){
    const overlay=document.getElementById("authOverlay");
    if(overlay) overlay.style.display="none";
    this.cleanupLargeUndoBackup();
    this.loadTeamBackup(); this.loadMatchBackup(); this.ensureTeamData(); this.refreshTeamSelectors(); this.setupTeamCatalog(); this.setupFirebase(); this.setupEventListeners(); this.renderBench(); this.updateLiveControls(); this.updateMatchPreview(); this.updateShareQr(); this.renderSavedLinks(); this.renderLeaguePage(); this.setStatus(`Firebase: loading (${MATCH_ID})`,"");
  },
  switchPage(page){
    const home=page==='home';
    const setup=page==='setup';
    const league=page==='league';
    const history=page==='history';
    const teams=page==='teams';
    document.getElementById('homePage').classList.toggle('active',home);
    document.getElementById('setupPage').classList.toggle('active',setup);
    document.getElementById('leaguePage').classList.toggle('active',league);
    document.getElementById('historyPage').classList.toggle('active',history);
    document.getElementById('teamsPage').classList.toggle('active',teams);
    document.getElementById('homeTab').classList.toggle('active',home);
    document.getElementById('setupTab').classList.toggle('active',setup);
    document.getElementById('leagueTab').classList.toggle('active',league);
    document.getElementById('historyTab').classList.toggle('active',history);
    document.getElementById('teamsTab').classList.toggle('active',teams);
    if(league) this.renderLeaguePage();
    if(history) this.renderHistory();
    if(teams) this.renderTeamsPage();
  },
  renderHistory(){
    const history = this.state.completedMatches || [];
    const html = history.length > 0
      ? history.map((m, i) => `
          <div class="history-item">
            <div class="history-title">${String(m.title || "Match").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}</div>
            <div class="history-meta">${String(m.winnerText || "-").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}</div>
            <div class="history-meta">1st: ${String(m.firstInnings || "-").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))} | 2nd: ${String(m.secondInnings || "-").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn secondary small" onclick="app.openScorecardPdf(${i})">Download PDF</button>
              <button class="btn danger small" onclick="app.deleteMatch(${i})">Delete</button>
            </div>
          </div>
        `).join("")
      : "<div class='muted'>No completed matches yet.</div>";
    document.getElementById("historyList").innerHTML = html;
  },
  deleteMatch(index){
    if(!confirm("Delete this match from history?")) return;
    if(Array.isArray(this.state.completedMatches)) {
      this.state.completedMatches.splice(index, 1);
      this.hasLocalChanges = true;
      this.renderHistory();
      this.saveToFirebase();
    }
  },
  openScorecardPdf(index){
    const url=new URL("scorecard-download.html", location.href);
    url.searchParams.set("match",MATCH_ID);
    url.searchParams.set("index",String(index));
    window.open(url.href,"_blank");
  },
  setupEventListeners(){ ["totalOvers","followLinkInput"].forEach(id=>document.getElementById(id)?.addEventListener("input",()=>this.updateSetupPreviewFromInputs())); ["battingTeam","bowlingTeam","tossDecision"].forEach(id=>document.getElementById(id).addEventListener("change",()=>this.updateSetupPreviewFromInputs())); ["tossWinnerA","tossWinnerB"].forEach(id=>document.getElementById(id).addEventListener("change",()=>this.updateSetupPreviewFromInputs())); ["leagueName","leagueOvers","leagueFormat","leaguePlayoffs"].forEach(id=>document.getElementById(id)?.addEventListener("input",()=>this.syncLeagueDraft(false))); document.getElementById("leagueTeamsSelect")?.addEventListener("change",()=>this.syncLeagueDraft(false)); const teamForPlayer=document.getElementById("teamForPlayer"); if(teamForPlayer) teamForPlayer.addEventListener("change",()=>this.showTeamPlayersForAdd()); const openingStriker=document.getElementById("openingStriker"); if(openingStriker) openingStriker.addEventListener("change",()=>this.updateOpeningPlayerOptions()); const savedName=document.getElementById("savedLinkName"); if(savedName) savedName.addEventListener("keydown",(e)=>{ if(e.key==="Enter") this.saveCurrentLink(); }); document.addEventListener("keydown",(e)=>this.handleShortcuts(e)); },
  selectedLeagueTeams(){
    const sel=document.getElementById("leagueTeamsSelect");
    return sel ? Array.from(sel.selectedOptions).map(o=>o.value).filter(Boolean) : [];
  },
  syncLeagueDraft(markDirty=true){
    if(!this.state.league || typeof this.state.league!=="object") this.state.league={name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]};
    this.state.league.name=(document.getElementById("leagueName")?.value||this.state.league.name||"").trim();
    this.state.league.overs=Math.max(1,Number(document.getElementById("leagueOvers")?.value||this.state.league.overs||20));
    this.state.league.format=document.getElementById("leagueFormat")?.value || this.state.league.format || "single";
    this.state.league.playoffs=!!document.getElementById("leaguePlayoffs")?.checked;
    const selected=this.selectedLeagueTeams();
    if(selected.length) this.state.league.teams=selected;
    if(markDirty) this.hasLocalChanges=true;
    this.renderLeagueSummary();
  },
  renderLeagueTeamPicker(){
    const el=document.getElementById("leagueTeamsSelect");
    const dataList=document.getElementById("leagueTeamNames");
    const selected=new Set(this.state.league?.teams||[]);
    const names=Object.keys(this.state.teams||{});
    if(el) el.innerHTML=names.length?names.map(t=>`<option value="${this.safeText(t)}" ${selected.has(t)?"selected":""}>${this.safeText(t)} (${(this.state.teams[t]||[]).length})</option>`).join(""):"";
    if(dataList) dataList.innerHTML=names.map(t=>`<option value="${this.safeText(t)}"></option>`).join("") + '<option value="TBA"></option>';
  },
  renderLeaguePage(){
    if(!this.state.league || typeof this.state.league!=="object") this.state.league={name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]};
    const l=this.state.league;
    const set=(id,val)=>{ const el=document.getElementById(id); if(el && document.activeElement!==el) el.value=val; };
    set("leagueName",l.name||"");
    set("leagueOvers",l.overs||20);
    set("leagueFormat",l.format||"single");
    const playoffs=document.getElementById("leaguePlayoffs"); if(playoffs) playoffs.checked=l.playoffs!==false;
    this.renderLeagueTeamPicker();
    this.renderLeagueSchedule();
    this.renderLeagueSummary();
    this.renderLeaguePoints();
  },
  renderLeagueSummary(){
    const l=this.state.league||{};
    const schedule=Array.isArray(l.schedule)?l.schedule:[];
    const done=schedule.filter(m=>m.status==="done").length;
    const setText=(id,val)=>{ const el=document.getElementById(id); if(el) el.innerText=String(val); };
    setText("leagueTeamCount",(l.teams||[]).length);
    setText("leagueMatchCount",schedule.length);
    setText("leagueDoneCount",done);
    setText("leaguePendingCount",Math.max(schedule.length-done,0));
    const hint=document.getElementById("leagueHint");
    if(hint) hint.innerText=l.name?`${l.name}: ${(l.teams||[]).length} teams, ${schedule.length} matches`:"League create karo, phir schedule se match setup load karo.";
  },
  leagueStatusLabel(status){
    if(status==="done") return "Completed";
    if(status==="live") return "Loaded";
    return "Pending";
  },
  renderLeagueSchedule(){
    const el=document.getElementById("leagueScheduleList");
    if(!el) return;
    const schedule=Array.isArray(this.state.league?.schedule)?this.state.league.schedule:[];
    if(!schedule.length){ el.innerHTML='<div class="muted">No schedule yet. Teams select karke Generate Schedule dabao.</div>'; return; }
    el.innerHTML=schedule.map((m,i)=>{
      const cls=`league-schedule-item ${m.status==="done"?"done":(m.status==="live"?"live":"")}`;
      const disabled=m.teamA==="TBA"||m.teamB==="TBA";
      return `<div class="${cls}">
        <div>
          <div class="league-round">${this.safeText(m.round||"Round")} · Match ${i+1}</div>
          <div class="league-match-title">${this.safeText(m.teamA)} vs ${this.safeText(m.teamB)}</div>
          <div class="league-match-meta">${this.safeText(m.stage||"League")} · ${Number(m.overs||this.state.league?.overs||20)} overs${m.date?` · ${this.safeText(m.date)}`:""}${m.time?` ${this.safeText(m.time)}`:""}${m.venue?` · ${this.safeText(m.venue)}`:""}</div>
          <span class="league-status ${m.status==="done"?"done":(m.status==="live"?"live":"")}">${this.leagueStatusLabel(m.status)}</span>
        </div>
        <div class="league-actions">
          <button class="btn secondary" ${disabled?"disabled":""} onclick="app.loadLeagueMatch(${i})">Setup</button>
          <button class="btn secondary" onclick="app.fillLeagueMatchEditor(${i})">Edit</button>
          <button class="btn secondary" onclick="app.moveLeagueMatch(${i},-1)">Up</button>
          <button class="btn secondary" onclick="app.moveLeagueMatch(${i},1)">Down</button>
          <button class="btn danger" onclick="app.deleteLeagueMatch(${i})">Delete</button>
        </div>
      </div>`;
    }).join("");
  },
  renderLeaguePoints(){
    const el=document.getElementById("leaguePointsTableBody");
    if(!el) return;
    const teams=this.state.league?.teams?.length ? this.state.league.teams : Object.keys(this.state.pointsTable||{});
    const pts=this.state.pointsTable||{};
    el.innerHTML=teams.length?teams.map(team=>{
      const s=pts[team]||{P:0,W:0,L:0,T:0,Pts:0};
      return `<tr><td><b>${this.safeText(team)}</b></td><td>${s.P||0}</td><td>${s.W||0}</td><td>${s.L||0}</td><td>${s.T||0}</td><td>${s.Pts||0}</td><td>${this.nrr(team)}</td></tr>`;
    }).join(""):'<tr><td colspan="7">No league teams</td></tr>';
  },
  selectAllLeagueTeams(){
    const el=document.getElementById("leagueTeamsSelect");
    if(!el) return;
    Array.from(el.options).forEach(o=>o.selected=true);
    this.state.league.teams=this.selectedLeagueTeams();
    this.hasLocalChanges=true;
    this.renderLeagueSummary();
  },
  clearLeagueTeamSelection(){
    const el=document.getElementById("leagueTeamsSelect");
    if(!el) return;
    Array.from(el.options).forEach(o=>o.selected=false);
    this.state.league.teams=[];
    this.hasLocalChanges=true;
    this.renderLeagueSummary();
  },
  async addLeagueManualTeams(){
    const raw=(document.getElementById("leagueManualTeams")?.value||"").trim();
    if(!raw) return this.showPopup("Team names likho","warn");
    const names=raw.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);
    if(!names.length) return;
    names.forEach(name=>{
      if(!this.state.teams[name]) this.state.teams[name]=[];
      if(!this.state.teamInfo[name]) this.state.teamInfo[name]={shortName:this.autoShortName(name),logo:"",players:{}};
      this.dirtyTeams.add(name);
    });
    document.getElementById("leagueManualTeams").value="";
    this.state.league.teams=[...new Set([...(this.state.league?.teams||[]),...names])];
    this.hasLocalChanges=true;
    this.ensureTeamData();
    this.refreshTeamSelectors();
    this.renderLeaguePage();
    await this.saveTeamCatalog();
    await this.saveToFirebase(true);
    this.showPopup("League teams added","success");
  },
  roundRobinPairs(teams){
    const list=[...teams];
    if(list.length%2) list.push("BYE");
    const rounds=[];
    const n=list.length;
    for(let r=0;r<n-1;r++){
      const pairs=[];
      for(let i=0;i<n/2;i++){
        const a=list[i], b=list[n-1-i];
        if(a!=="BYE" && b!=="BYE") pairs.push(r%2?{teamA:b,teamB:a}:{teamA:a,teamB:b});
      }
      rounds.push(pairs);
      list.splice(1,0,list.pop());
    }
    return rounds;
  },
  createLeagueSchedule(){
    this.syncLeagueDraft(false);
    const selected=this.selectedLeagueTeams();
    const teams=[...new Set(selected.length?selected:(this.state.league?.teams||[]))].filter(Boolean);
    if(teams.length<2) return this.showPopup("League ke liye at least 2 teams select karo","warn");
    const name=(document.getElementById("leagueName")?.value||"").trim() || "Cricket League";
    const overs=Math.max(1,Number(document.getElementById("leagueOvers")?.value||20));
    const format=document.getElementById("leagueFormat")?.value || "single";
    const playoffs=!!document.getElementById("leaguePlayoffs")?.checked;
    const rounds=this.roundRobinPairs(teams);
    const schedule=[];
    let matchNo=1;
    rounds.forEach((pairs,ri)=>pairs.forEach(pair=>schedule.push({id:Date.now()+"-"+matchNo,matchNo:matchNo++,round:`Round ${ri+1}`,stage:"League",teamA:pair.teamA,teamB:pair.teamB,overs,date:"",time:"",venue:"",status:"pending"})));
    if(format==="double"){
      rounds.forEach((pairs,ri)=>pairs.forEach(pair=>schedule.push({id:Date.now()+"-"+matchNo,matchNo:matchNo++,round:`Return ${ri+1}`,stage:"League",teamA:pair.teamB,teamB:pair.teamA,overs,date:"",time:"",venue:"",status:"pending"})));
    }
    if(playoffs){
      ["Q1","Eliminator","Q2","Final"].forEach(stage=>schedule.push({id:Date.now()+"-"+matchNo,matchNo:matchNo++,round:"Playoffs",stage,teamA:"TBA",teamB:"TBA",overs,date:"",time:"",venue:"",status:"pending"}));
    }
    this.state.league={name,teams,overs,format,playoffs,schedule};
    teams.forEach(t=>this.ensureTeamInPoints(t));
    this.hasLocalChanges=true;
    this.renderLeaguePage();
    this.saveToFirebase(true);
    this.showPopup("League schedule generated","success");
  },
  saveLeague(){
    this.syncLeagueDraft(true);
    this.saveToFirebase(true);
    this.renderLeaguePage();
    this.showPopup("League saved","success");
  },
  clearLeague(){
    if(!confirm("Clear league schedule? Teams and match history will stay.")) return;
    this.state.league={name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]};
    this.hasLocalChanges=true;
    this.renderLeaguePage();
    this.saveToFirebase(true);
  },
  loadLeagueMatch(index){
    const match=this.state.league?.schedule?.[index];
    if(!match || match.teamA==="TBA" || match.teamB==="TBA") return this.showPopup("TBA match setup nahi ho sakta","warn");
    this.state.battingTeam=match.teamA;
    this.state.bowlingTeam=match.teamB;
    this.state.activeLeagueMatch={id:match.id,index,matchNo:match.matchNo||index+1};
    const batEl=document.getElementById("battingTeam"), bowlEl=document.getElementById("bowlingTeam"), oversEl=document.getElementById("totalOvers");
    if(batEl) batEl.value=match.teamA;
    if(bowlEl) bowlEl.value=match.teamB;
    if(oversEl) oversEl.value=match.overs || this.state.league?.overs || 20;
    if(this.state.league?.schedule) this.state.league.schedule=this.state.league.schedule.map((m,i)=>i===index?{...m,status:m.status==="done"?"done":"live"}:(m.status==="live"?{...m,status:"pending"}:m));
    this.hasLocalChanges=true;
    this.updateSetupPreviewFromInputs();
    this.renderLeaguePage();
    this.switchPage("setup");
    this.saveToFirebase(true);
    this.showPopup("League match loaded in Match Setup","success");
  },
  moveLeagueMatch(index,dir){
    const schedule=this.state.league?.schedule;
    if(!Array.isArray(schedule)) return;
    const next=index+dir;
    if(next<0 || next>=schedule.length) return;
    [schedule[index],schedule[next]]=[schedule[next],schedule[index]];
    this.hasLocalChanges=true;
    this.renderLeagueSchedule();
    this.saveToFirebase(true);
  },
  deleteLeagueMatch(index){
    if(!confirm("Delete this scheduled match?")) return;
    this.state.league?.schedule?.splice(index,1);
    this.hasLocalChanges=true;
    this.renderLeaguePage();
    this.saveToFirebase(true);
  },
  leagueEditorPayload(){
    const stage=(document.getElementById("manualMatchStage")?.value||"League").trim() || "League";
    const round=(document.getElementById("manualMatchRound")?.value||"").trim() || (stage==="League" ? "Manual" : "Playoffs");
    const teamA=(document.getElementById("manualTeamA")?.value||"").trim();
    const teamB=(document.getElementById("manualTeamB")?.value||"").trim();
    const date=(document.getElementById("manualMatchDate")?.value||"").trim();
    const time=(document.getElementById("manualMatchTime")?.value||"").trim();
    const venue=(document.getElementById("manualMatchVenue")?.value||"").trim();
    const overs=Math.max(1,Number(document.getElementById("manualMatchOvers")?.value||this.state.league?.overs||20));
    if(!teamA || !teamB){ this.showPopup("Team A aur Team B required hai","warn"); return null; }
    if(teamA===teamB && teamA!=="TBA"){ this.showPopup("Dono team same nahi ho sakti","warn"); return null; }
    [teamA,teamB].forEach(team=>{
      if(team && team!=="TBA" && !this.state.teams[team]){
        this.state.teams[team]=[];
        this.state.teamInfo[team]={shortName:this.autoShortName(team),logo:"",players:{}};
        this.dirtyTeams.add(team);
      }
    });
    const leagueTeams=[...(this.state.league?.teams||[])];
    [teamA,teamB].forEach(team=>{ if(team && team!=="TBA" && !leagueTeams.includes(team)) leagueTeams.push(team); });
    this.state.league.teams=leagueTeams;
    return {round,stage,teamA,teamB,overs,date,time,venue,status:"pending"};
  },
  addManualLeagueMatch(){
    if(!this.state.league || typeof this.state.league!=="object") this.state.league={name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]};
    const item=this.leagueEditorPayload();
    if(!item) return;
    if(!Array.isArray(this.state.league.schedule)) this.state.league.schedule=[];
    const matchNo=this.state.league.schedule.length+1;
    this.state.league.schedule.push({id:Date.now()+"-"+matchNo,matchNo,...item});
    this.hasLocalChanges=true;
    this.ensureTeamData();
    this.refreshTeamSelectors();
    this.renderLeaguePage();
    this.saveTeamCatalog();
    this.saveToFirebase(true);
    this.showPopup("Manual match added","success");
  },
  fillLeagueMatchEditor(index){
    const match=this.state.league?.schedule?.[index];
    if(!match) return;
    const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.value=val; };
    set("leagueEditIndex",String(index));
    set("manualMatchStage",match.stage||"League");
    set("manualMatchRound",match.round||"");
    set("manualTeamA",match.teamA||"");
    set("manualTeamB",match.teamB||"");
    set("manualMatchDate",match.date||"");
    set("manualMatchTime",match.time||"");
    set("manualMatchVenue",match.venue||"");
    set("manualMatchOvers",match.overs||this.state.league?.overs||20);
    this.showPopup("Fixture editor me load ho gaya","success");
  },
  updateLeagueMatchFromEditor(){
    const index=Number(document.getElementById("leagueEditIndex")?.value);
    if(!Number.isInteger(index) || index<0 || !this.state.league?.schedule?.[index]) return this.showPopup("Schedule se Edit click karo","warn");
    const item=this.leagueEditorPayload();
    if(!item) return;
    const old=this.state.league.schedule[index];
    this.state.league.schedule[index]={...old,...item,status:old.status==="done"?"done":item.status};
    this.hasLocalChanges=true;
    this.ensureTeamData();
    this.refreshTeamSelectors();
    this.renderLeaguePage();
    this.saveTeamCatalog();
    this.saveToFirebase(true);
    this.showPopup("Fixture updated","success");
  },
  clearLeagueMatchEditor(){
    ["leagueEditIndex","manualTeamA","manualTeamB","manualMatchRound","manualMatchDate","manualMatchTime","manualMatchVenue"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
    const stage=document.getElementById("manualMatchStage"); if(stage) stage.value="League";
    const overs=document.getElementById("manualMatchOvers"); if(overs) overs.value=this.state.league?.overs||20;
  },
  refreshPlayerDeskSelectors(){
    const dismissed = this.state.dismissedPlayers || [];
    const bats=(this.state.teams[this.state.battingTeam]||[]).filter(Boolean).filter(p=>!dismissed.includes(p));
    const bowls=(this.state.teams[this.state.bowlingTeam]||[]).filter(Boolean).filter(p=>p!==this.state.lastOverBowler);
    const fill=(id,list,current)=>{
      const el=document.getElementById(id);
      if(!el) return;
      const options=list.length?list:[current||"-"];
      el.innerHTML=options.map(p=>`<option>${p}</option>`).join("");
      if(current && options.includes(current)) el.value=current;
      else if(options.length) el.value=options[0];
    };
    const strikerCurrent=this.state.bat1?.name||"";
    const nonStrikerCurrent=this.state.bat2?.name||"";
    fill("strikerName",bats.filter(p=>p!==nonStrikerCurrent),strikerCurrent);
    fill("nonStrikerName",bats.filter(p=>p!==strikerCurrent),nonStrikerCurrent);
    fill("bowlerNameInput",bowls,this.state.bowler?.name||"");
  },
  updateOpeningPlayerOptions(){
    const matchTeams=this.getSetupMatchTeams();
    const batters=(this.state.teams?.[matchTeams.battingTeam]||[]).filter(Boolean);
    const bowlers=(this.state.teams?.[matchTeams.bowlingTeam]||[]).filter(Boolean);
    const fill=(id,list,current)=>{
      const el=document.getElementById(id);
      if(!el) return;
      const options=list.length?list:["-"];
      el.innerHTML=options.map(p=>`<option>${p}</option>`).join("");
      if(current && options.includes(current)) el.value=current;
    };
    const currentStriker=document.getElementById("openingStriker")?.value || this.state.bat1?.name;
    const currentNonStriker=document.getElementById("openingNonStriker")?.value || this.state.bat2?.name;
    const currentBowler=document.getElementById("openingBowler")?.value || this.state.bowler?.name;
    fill("openingStriker",batters,currentStriker);
    fill("openingNonStriker",batters.filter(p=>p!==document.getElementById("openingStriker")?.value),currentNonStriker);
    fill("openingBowler",bowlers,currentBowler);
  },
  getSetupMatchTeams(){
    const teamA=document.getElementById("battingTeam")?.value || this.state.battingTeam || "";
    const teamB=document.getElementById("bowlingTeam")?.value || this.state.bowlingTeam || "";
    const tossWinner=document.getElementById("tossWinnerB")?.checked ? "B" : "A";
    const tossDecision=document.getElementById("tossDecision")?.value || this.state.tossDecision || "bat";
    const tossTeam=tossWinner==="B" ? teamB : teamA;
    const otherTeam=tossWinner==="B" ? teamA : teamB;
    const battingTeam=tossDecision==="bat" ? tossTeam : otherTeam;
    const bowlingTeam=tossDecision==="bat" ? otherTeam : tossTeam;
    return {teamA,teamB,tossWinner,tossDecision,tossTeam,otherTeam,battingTeam,bowlingTeam};
  },
  scoreDefaults(){
    return {
      runs:0,wkts:0,balls:0,extras:0,striker:1,
      bat1:{name:"-",r:0,b:0,f:0,s:0}, bat2:{name:"-",r:0,b:0,f:0,s:0}, bowler:{name:"-",balls:0,m:0,r:0,w:0},
      over:[],overSummary:[],commentary:[],highlights:[],history:[],ballHistory:[],ballEvents:[],
      inningNumber:1,wicketType:"",wicketHelper:"",partnershipRuns:0,partnershipBalls:0,lastWicket:"-",lastOverBowler:"",
      firstInningsScore:null,firstInningsWkts:null,target:null,matchFinished:false,winnerText:"",
      scoringLocked:false,bowlerStats:{},fallOfWickets:[],resultRecorded:false,dismissedPlayers:[],
      liveControl:{mode:"live",note:"Live"},
      activeLeagueMatch:null,
      battingScorecard:[],completedInnings:{},completedBowling:{}
    };
  },
  safeText(value){ return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); },
  autoShortName(name){ return (name||"-").split(/\s+/).filter(Boolean).map(x=>x[0]).join("").slice(0,3).toUpperCase() || "-"; },
  ensureTeamData(){
    if(!this.state.teams||typeof this.state.teams!=="object") this.state.teams={};
    if(!this.state.teamInfo||typeof this.state.teamInfo!=="object") this.state.teamInfo={};
    Object.keys(this.state.teams).forEach(team=>{
      if(!Array.isArray(this.state.teams[team])) this.state.teams[team]=[];
      if(!this.state.teamInfo[team]||typeof this.state.teamInfo[team]!=="object") this.state.teamInfo[team]={};
      if(!this.state.teamInfo[team].shortName) this.state.teamInfo[team].shortName=this.autoShortName(team);
      if(!this.state.teamInfo[team].players||typeof this.state.teamInfo[team].players!=="object") this.state.teamInfo[team].players={};
    });
    if(this.state.battingTeam && !this.state.teams[this.state.battingTeam]) this.state.teams[this.state.battingTeam]=[];
    if(this.state.bowlingTeam && !this.state.teams[this.state.bowlingTeam]) this.state.teams[this.state.bowlingTeam]=[];
  },
  teamMeta(team){ this.ensureTeamData(); return this.state.teamInfo[team] || {shortName:this.autoShortName(team),logo:"",players:{}}; },
  teamShort(team){ return this.teamMeta(team).shortName || this.autoShortName(team); },
  playerMeta(team,player){ const meta=this.teamMeta(team); return (meta.players && meta.players[player]) ? meta.players[player] : {}; },
  avatarHtml(text,url,cls="team-logo-mini"){
    const safeUrl=this.safeText(url||"");
    return `<div class="${cls}">${safeUrl?`<img src="${safeUrl}" alt="">`:this.safeText(text||"-")}</div>`;
  },
  userLink(){
    const url=new URL("user.html", location.href);
    url.searchParams.set("match",MATCH_ID);
    return url.href;
  },
  async copyUserLink(){
    const link=this.userLink();
    try{
      await navigator.clipboard.writeText(link);
      this.showPopup("User live link copied","success");
    }catch(e){
      prompt("Copy user live link:",link);
    }
  },
  updateShareQr(){
    const link=this.userLink();
    const img=document.getElementById("shareQr");
    const text=document.getElementById("shareLinkText");
    const homeImg=document.getElementById("homeShareQr");
    const homeText=document.getElementById("homeShareLinkText");
    if(img) img.src=`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`;
    if(text) text.innerText=link;
    if(homeImg) homeImg.src=`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`;
    if(homeText) homeText.innerText=link;
  },
  savedLinks(){
    try{return JSON.parse(localStorage.getItem(SAVED_LINKS_KEY)||"[]");}catch(e){return[];}
  },
  persistSavedLinks(list){
    localStorage.setItem(SAVED_LINKS_KEY,JSON.stringify(list));
    saveSavedLinks(MATCH_ID,list).catch(e=>console.warn("Saved links Firestore sync failed",e));
  },
  renderSavedLinks(){
    const sel=document.getElementById("savedLinksSelect");
    if(!sel) return;
    const links=this.savedLinks();
    sel.innerHTML=links.length?links.map((x,i)=>`<option value="${i}">${this.safeText(x.name)} - ${this.safeText(x.matchId)}</option>`).join(""):'<option value="">No saved links</option>';
  },
  saveCurrentLink(){
    const name=(document.getElementById("savedLinkName")?.value||"").trim() || (this.state.matchTitle||MATCH_ID);
    const links=this.savedLinks().filter(x=>x.matchId!==MATCH_ID);
    links.unshift({name,matchId:MATCH_ID,url:this.userLink(),savedAt:Date.now()});
    this.persistSavedLinks(links.slice(0,30));
    const input=document.getElementById("savedLinkName"); if(input) input.value="";
    this.renderSavedLinks();
    this.showPopup("Link saved","success");
  },
  selectedSavedLink(){
    const sel=document.getElementById("savedLinksSelect");
    const links=this.savedLinks();
    return links[Number(sel?.value||0)]||null;
  },
  async copySavedLink(){
    const item=this.selectedSavedLink();
    if(!item) return this.showPopup("No saved link","warn");
    try{ await navigator.clipboard.writeText(item.url); this.showPopup("Saved link copied","success"); }
    catch(e){ prompt("Copy saved link:",item.url); }
  },
  openSavedLink(){
    const item=this.selectedSavedLink();
    if(!item) return this.showPopup("No saved link","warn");
    window.open(item.url,"_blank");
  },
  async uploadToCloudinary(file){
    if(!file) return "";
    const data=new FormData();
    data.append("file",file);
    data.append("upload_preset",UPLOAD_PRESET);
    const res=await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,{method:"POST",body:data});
    if(!res.ok) throw new Error("Cloudinary upload failed");
    const json=await res.json();
    return json.secure_url || json.url || "";
  },
  async uploadNewTeamLogo(input){
    try{
      this.setStatus("Logo: uploading...","");
      const url=await this.uploadToCloudinary(input.files?.[0]);
      if(url) document.getElementById("newTeamLogo").value=url;
      this.setStatus("Logo: uploaded","success");
      this.showPopup("Team logo uploaded","success");
    }catch(e){ this.setStatus("Logo Upload Error","error"); this.showPopup(e.message,"warn"); }
    if(input) input.value="";
  },
  async uploadTeamLogo(input){
    try{
      this.setStatus("Logo: uploading...","");
      const url=await this.uploadToCloudinary(input.files?.[0]);
      if(url){ document.getElementById("editTeamLogo").value=url; document.getElementById("teamLogoPreview").innerHTML=`<img src="${this.safeText(url)}" alt="">`; }
      this.setStatus("Logo: uploaded","success");
      this.showPopup("Team logo uploaded. Save Team to publish.","success");
    }catch(e){ this.setStatus("Logo Upload Error","error"); this.showPopup(e.message,"warn"); }
    if(input) input.value="";
  },
  async uploadPlayerImage(input){
    try{
      this.setStatus("Player image: uploading...","");
      const url=await this.uploadToCloudinary(input.files?.[0]);
      if(url){ document.getElementById("editPlayerImage").value=url; document.getElementById("playerPhotoPreview").innerHTML=`<img src="${this.safeText(url)}" alt="">`; }
      this.setStatus("Player image: uploaded","success");
      this.showPopup("Player image uploaded. Save Player to publish.","success");
    }catch(e){ this.setStatus("Image Upload Error","error"); this.showPopup(e.message,"warn"); }
    if(input) input.value="";
  },
  refreshTeamSelectors(){
    this.ensureTeamData();
    const names=Object.keys(this.state.teams);
    const teamForPlayerCurrent=document.getElementById("teamForPlayer")?.value || "";
    if(names.length===0){
      ["battingTeam","bowlingTeam","teamForPlayer","openingStriker","openingNonStriker","openingBowler"].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=""; });
      const title=document.getElementById("matchTitle"); if(title) title.value="Select Teams";
      this.updateMatchPreview();
      return;
    }
    const batCurrent=document.getElementById("battingTeam")?.value || this.state.battingTeam || "";
    const bowlCurrent=document.getElementById("bowlingTeam")?.value || this.state.bowlingTeam || "";
    if(!this.state.battingTeam || !names.includes(this.state.battingTeam)) this.state.battingTeam = names.includes(batCurrent) ? batCurrent : names[0];
    if(!this.state.bowlingTeam || !names.includes(this.state.bowlingTeam)) this.state.bowlingTeam = names.includes(bowlCurrent) ? bowlCurrent : (names[1] || "");
    if(names.length>1 && this.state.bowlingTeam===this.state.battingTeam) this.state.bowlingTeam = names.find(t=>t!==this.state.battingTeam) || "";

    const batEl = document.getElementById("battingTeam");
    const bowlEl = document.getElementById("bowlingTeam");
    const teamForPlayerEl = document.getElementById("teamForPlayer");

    if(batEl){
      batEl.innerHTML = names.map(t=>`<option>${t}</option>`).join("");
      if(names.includes(this.state.battingTeam)) batEl.value = this.state.battingTeam;
    }
    if(bowlEl){
      bowlEl.innerHTML = names.map(t=>`<option>${t}</option>`).join("");
      if(names.includes(this.state.bowlingTeam)) bowlEl.value = this.state.bowlingTeam;
    }
    if(teamForPlayerEl){
      teamForPlayerEl.innerHTML = names.map(t=>`<option>${t}</option>`).join("");
      teamForPlayerEl.value = names.includes(teamForPlayerCurrent) ? teamForPlayerCurrent : (teamForPlayerEl.value || names[0]);
    }
    this.updateOpeningPlayerOptions();
    this.showTeamPlayersForAdd();
    this.renderLeagueTeamPicker();
  },
  showTeamPlayersForAdd(){
    const el=document.getElementById("selectedTeamPlayers");
    if(!el) return;
    const team=document.getElementById("teamForPlayer")?.value || "";
    const players=(this.state.teams?.[team]||[]).filter(Boolean);
    el.innerText=team ? (players.length ? `${team}: ${players.join(", ")}` : `${team}: no players yet`) : "No team selected";
  },
  setupTeamCatalog(){
    listenTeamCatalog((catalog)=>{
      if(!catalog){
        if(Object.keys(this.state.teams||{}).length) this.saveTeamCatalog();
        return;
      }
      const remoteTeams=catalog.teams || {};
      const remoteTeamInfo=catalog.teamInfo || {};
      if(!remoteTeams || typeof remoteTeams!=="object") return;
      const localTeams=this.state.teams || {};
      const localTeamInfo=this.state.teamInfo || {};
      const teams={...remoteTeams};
      const teamInfo={...remoteTeamInfo};
      let removedDefaults=false;
      ["Team A","Team B"].forEach(team=>{ if(Array.isArray(teams[team]) && teams[team].length===0){ delete teams[team]; removedDefaults=true; } });
      [...(this.dirtyTeams||new Set())].forEach(team=>{ teams[team]=localTeams[team]||[]; teamInfo[team]=localTeamInfo[team]||teamInfo[team]||{}; });
      this.state.teams=teams;
      this.state.teamInfo=teamInfo;
      this.persistTeamBackup();
      this.hasTeamCatalog=true;
      this.ensureTeamData();
      this.refreshTeamSelectors();
      this.renderBench();
      this.updateMatchPreview();
      if(removedDefaults || (this.dirtyTeams||new Set()).size) this.saveTeamCatalog();
    },(e)=>this.setStatus("Team Catalog Error: "+e.message,"error"));
  },
  loadTeamBackup(){
    try{
      const raw=localStorage.getItem(TEAM_BACKUP_KEY);
      if(!raw) return;
      const saved=JSON.parse(raw);
      if(saved && saved.teams && typeof saved.teams==="object"){
        this.state.teams={...this.state.teams,...saved.teams};
        this.state.teamInfo={...this.state.teamInfo,...(saved.teamInfo||{})};
      }
    }catch(e){ console.error(e); }
  },
  persistTeamBackup(){
    try{
      localStorage.setItem(TEAM_BACKUP_KEY,JSON.stringify({teams:this.state.teams||{},teamInfo:this.state.teamInfo||{},timestamp:Date.now()}));
    }catch(e){ console.error(e); }
  },
  loadMatchBackup(){
    try{
      const raw=localStorage.getItem(MATCH_BACKUP_KEY);
      if(!raw) return;
      const saved=JSON.parse(raw);
      if(!saved || !saved.state || typeof saved.state!=="object") return;
      this.state={...this.state,...saved.state};
      this.hasLocalChanges=false;
      this.ensureTeamData();
      this.refreshTeamSelectors();
      this.renderBench();
      this.render(false);
      this.renderLeaguePage();
      this.setStatus("Firebase: loading saved local view...","");
    }catch(e){ console.error("Match backup load failed",e); }
  },
  persistMatchBackup(force=false){
    try{
      const now=Date.now();
      if(!force && this._lastMatchBackupAt && now-this._lastMatchBackupAt<1500) return;
      this._lastMatchBackupAt=now;
      const copy=JSON.parse(JSON.stringify(this.state||{}));
      delete copy.history;
      delete copy.ballHistory;
      delete copy.ballEvents;
      localStorage.setItem(MATCH_BACKUP_KEY,JSON.stringify({state:copy,timestamp:Date.now()}));
    }catch(e){ console.warn("Match backup failed",e); }
  },
  async saveTeamCatalog(){
    try{
      const teams=this.state.teams||{};
      const teamInfo=this.state.teamInfo||{};
      this.setStatus("Teams: saving...","");
      this.persistTeamBackup();
      await saveTeamCatalogData({teams,teamInfo,updatedBy:this.sessionId});
      await saveMatchStore(MATCH_ID,{teamCatalog:teams,teams,teamInfo,updatedBy:this.sessionId});
      this.dirtyTeams.clear();
      this.setStatus("Teams: saved","success");
      return true;
    }catch(e){
      this.setStatus("Team Save Error","error");
      console.error(e);
      return false;
    }
  },
  async setupFirebase(){
    const hydrateFromStore = async (remote) => {
      this.isHydrated=true;
      if(!remote){
        remote=await getLegacyMatchStore(MATCH_ID);
      }
      if(!remote){
        if(this.hasLocalChanges) this.saveToFirebase();
        return;
      }

      const firstHydrate=!this._remoteHydratedOnce;
      this._remoteHydratedOnce=true;
      const remoteTeams=remote.teamCatalog || remote.teams || {};
      const remoteTeamInfo=remote.teamInfo || {};
      if(!this.hasTeamCatalog && remoteTeams && typeof remoteTeams==="object"){
        const imported={...remoteTeams};
        ["Team A","Team B"].forEach(team=>{ if(Array.isArray(imported[team]) && imported[team].length===0) delete imported[team]; });
        if(Object.keys(imported).length){
          this.state.teams={...this.state.teams,...imported};
          this.state.teamInfo={...this.state.teamInfo,...remoteTeamInfo};
          this.persistTeamBackup();
        }
      }

      if(remote.updatedBy===this.sessionId) return;
      if(this.hasLocalChanges && !firstHydrate) return;

      const teams=this.hasTeamCatalog ? this.state.teams : (remoteTeams || this.state.teams);
      const teamInfo=this.hasTeamCatalog ? this.state.teamInfo : (remoteTeamInfo || this.state.teamInfo);
      this.state={...this.state,...remote,teams,teamInfo};
      this.hasLocalChanges=false;
      this.persistMatchBackup();
      this.restoreUndoBackup();
      this.ensureTeamData();
      this.refreshTeamSelectors();
      document.getElementById("matchTitle").value=this.state.matchTitle||"";
      document.getElementById("totalOvers").value=this.state.totalOvers||20;
      const followEl=document.getElementById("followLinkInput"); if(followEl) followEl.value=this.state.followLink||"";
      document.getElementById("tossDecision").value=this.state.tossDecision||"bat";
      document.getElementById(this.state.tossWinner==="B"?"tossWinnerB":"tossWinnerA").checked=true;
      this.renderBench();
      this.render(false);
      this.renderLeaguePage();
    };

    listenMatchStore(MATCH_ID,(remote)=>hydrateFromStore(remote),(e)=>this.setStatus("Firestore Store Error: "+e.message,"error"));
    listenLiveMatch(MATCH_ID,(live)=>{
      if(!live || live.updatedBy===this.sessionId || this.hasLocalChanges) return;
      this.state={...this.state,...live};
      this.persistMatchBackup();
      this.render(false);
    },(e)=>this.setStatus("Realtime DB Error: "+e.message,"error"));
  },
  renderTeamsPage(){
    this.ensureTeamData();
    const names=Object.keys(this.state.teams);
    const active=this.selectedTeamName && names.includes(this.selectedTeamName) ? this.selectedTeamName : names[0];
    if(active && this.selectedTeamName!==active) this.selectedTeamName=active;
    document.getElementById("teamsList").innerHTML=names.length?names.map((team,i)=>{
      const meta=this.teamMeta(team);
      const cls=team===this.selectedTeamName?"team-list-item active":"team-list-item";
      return `<div class="${cls}" onclick="app.selectTeamByIndex(${i})">${this.avatarHtml(this.teamShort(team),meta.logo)}<div><b>${this.safeText(team)}</b><div class="muted">${this.safeText(this.teamShort(team))} · ${(this.state.teams[team]||[]).length} players</div></div></div>`;
    }).join(""):'<div class="muted">No teams created yet.</div>';
    if(this.selectedTeamName && names.includes(this.selectedTeamName)) this.fillTeamEditor(this.selectedTeamName);
    else {
      document.getElementById("teamEditor").style.display="none";
      document.getElementById("teamEditorEmpty").style.display="block";
    }
  },
  selectTeamByIndex(index){ const team=Object.keys(this.state.teams||{})[index]; if(team) this.selectTeam(team); },
  selectTeam(team){ this.selectedTeamName=team; this.selectedPlayerName=""; this.fillTeamEditor(team); this.renderTeamsPage(); },
  fillTeamEditor(team){
    const meta=this.teamMeta(team), players=this.state.teams[team]||[];
    document.getElementById("teamEditorEmpty").style.display="none";
    document.getElementById("teamEditor").style.display="block";
    document.getElementById("teamEditorTitle").innerText=team;
    document.getElementById("teamEditorMeta").innerText=`${players.length} players`;
    document.getElementById("teamLogoPreview").innerHTML=meta.logo?`<img src="${this.safeText(meta.logo)}" alt="">`:this.safeText(this.teamShort(team));
    document.getElementById("editTeamName").value=team;
    document.getElementById("editTeamShort").value=meta.shortName||this.autoShortName(team);
    document.getElementById("editTeamLogo").value=meta.logo||"";
    document.getElementById("teamPlayersList").innerHTML=players.length?players.map((p,i)=>{
      const pm=this.playerMeta(team,p);
      const active=p===this.selectedPlayerName?"player-row active":"player-row";
      return `<div class="${active}" onclick="app.selectPlayerByIndex(${i})"><div style="display:flex;align-items:center;gap:10px;">${this.avatarHtml(this.autoShortName(p).slice(0,2),pm.image,"player-photo-mini")}<span>${this.safeText(p)}</span></div><span class="muted">Edit</span></div>`;
    }).join(""):'<div class="muted">No players yet.</div>';
    this.fillPlayerEditor();
  },
  selectPlayerByIndex(index){ const players=this.state.teams?.[this.selectedTeamName]||[]; const player=players[index]; if(player){ this.selectedPlayerName=player; this.fillTeamEditor(this.selectedTeamName); } },
  fillPlayerEditor(){
    const team=this.selectedTeamName, player=this.selectedPlayerName;
    const exists=team && player && (this.state.teams[team]||[]).includes(player);
    document.getElementById("playerEditorEmpty").style.display=exists?"none":"block";
    document.getElementById("playerEditor").style.display=exists?"block":"none";
    if(!exists) return;
    const meta=this.playerMeta(team,player);
    document.getElementById("playerEditorTitle").innerText=player;
    document.getElementById("editPlayerName").value=player;
    document.getElementById("editPlayerImage").value=meta.image||"";
    document.getElementById("playerPhotoPreview").innerHTML=meta.image?`<img src="${this.safeText(meta.image)}" alt="">`:this.safeText(this.autoShortName(player).slice(0,2));
  },
  async saveTeamEdit(){
    const oldName=this.selectedTeamName;
    if(!oldName) return;
    const newName=(document.getElementById("editTeamName").value||"").trim();
    const shortName=(document.getElementById("editTeamShort").value||"").trim() || this.autoShortName(newName);
    const logo=(document.getElementById("editTeamLogo").value||"").trim();
    if(!newName) return this.showPopup("Team name required","warn");
    if(newName!==oldName && this.state.teams[newName]) return this.showPopup("Team already exists","warn");
    const players=this.state.teams[oldName]||[];
    const meta={...(this.state.teamInfo?.[oldName]||{}),shortName,logo,players:{...((this.state.teamInfo?.[oldName]||{}).players||{})}};
    if(newName!==oldName){
      delete this.state.teams[oldName]; delete this.state.teamInfo[oldName];
      this.state.teams[newName]=players; this.state.teamInfo[newName]=meta;
      if(this.state.battingTeam===oldName) this.state.battingTeam=newName;
      if(this.state.bowlingTeam===oldName) this.state.bowlingTeam=newName;
      if(this.state.matchTitle) this.state.matchTitle=this.state.matchTitle.replace(oldName,newName);
      this.dirtyTeams.delete(oldName);
    } else {
      this.state.teamInfo[oldName]=meta;
    }
    this.selectedTeamName=newName;
    this.dirtyTeams.add(newName);
    this.hasLocalChanges=true;
    this.refreshTeamSelectors();
    const saved=await this.saveTeamCatalog();
    await this.saveToFirebase(true);
    this.renderTeamsPage();
    this.render(false);
    this.showPopup(saved?"Team updated":"Team saved locally. Firebase failed.",saved?"success":"warn");
  },
  async addPlayerFromTeamPage(){
    const team=this.selectedTeamName, name=(document.getElementById("teamPageNewPlayer").value||"").trim();
    if(!team||!name) return this.showPopup("Player name required","warn");
    if(!this.state.teams[team]) this.state.teams[team]=[];
    if(this.state.teams[team].includes(name)) return this.showPopup("Player already exists","warn");
    this.state.teams[team].push(name);
    document.getElementById("teamPageNewPlayer").value="";
    this.selectedPlayerName=name;
    this.dirtyTeams.add(team); this.hasLocalChanges=true; this.persistTeamBackup();
    await this.saveTeamCatalog();
    await this.saveToFirebase(true);
    this.refreshTeamSelectors(); this.renderTeamsPage();
  },
  async savePlayerEdit(){
    const team=this.selectedTeamName, oldName=this.selectedPlayerName;
    if(!team||!oldName) return;
    const newName=(document.getElementById("editPlayerName").value||"").trim();
    const image=(document.getElementById("editPlayerImage").value||"").trim();
    if(!newName) return this.showPopup("Player name required","warn");
    const players=this.state.teams[team]||[];
    const oldIndex=players.indexOf(oldName);
    if(oldIndex<0) return;
    if(newName!==oldName && players.includes(newName)) return this.showPopup("Player already exists","warn");
    players[oldIndex]=newName;
    const meta=this.teamMeta(team);
    const playerInfo={...(meta.players?.[oldName]||{}),image};
    if(!meta.players) meta.players={};
    delete meta.players[oldName];
    meta.players[newName]=playerInfo;
    this.state.teamInfo[team]=meta;
    ["bat1","bat2","bowler"].forEach(k=>{ if(this.state[k]?.name===oldName) this.state[k].name=newName; });
    this.selectedPlayerName=newName;
    this.dirtyTeams.add(team); this.hasLocalChanges=true; this.persistTeamBackup();
    const saved=await this.saveTeamCatalog();
    await this.saveToFirebase(true);
    this.refreshTeamSelectors(); this.renderTeamsPage(); this.render(false);
    this.showPopup(saved?"Player updated":"Player saved locally. Firebase failed.",saved?"success":"warn");
  },
  async deleteSelectedPlayer(){
    const team=this.selectedTeamName, player=this.selectedPlayerName;
    if(!team||!player) return;
    if(!confirm(`Delete ${player} from ${team}?`)) return;
    this.state.teams[team]=(this.state.teams[team]||[]).filter(p=>p!==player);
    if(this.state.teamInfo?.[team]?.players) delete this.state.teamInfo[team].players[player];
    this.selectedPlayerName="";
    this.dirtyTeams.add(team); this.hasLocalChanges=true; this.persistTeamBackup();
    await this.saveTeamCatalog();
    await this.saveToFirebase(true);
    this.refreshTeamSelectors(); this.renderTeamsPage();
  },
  async createTeam(){ this.hasLocalChanges=true; const name=(document.getElementById("newTeamName").value||"").trim(); const shortName=(document.getElementById("newTeamShort")?.value||"").trim()||this.autoShortName(name); const logo=(document.getElementById("newTeamLogo")?.value||"").trim(); if(!name) return this.showPopup("Enter team name","warn"); if(this.state.teams[name]) return this.showPopup("Team already exists","warn"); this.state.teams[name]=[]; if(!this.state.teamInfo) this.state.teamInfo={}; this.state.teamInfo[name]={shortName,logo,players:{}}; this.dirtyTeams.add(name); this.persistTeamBackup(); this.state.battingTeam=name; document.getElementById("newTeamName").value=""; document.getElementById("newTeamShort").value=""; document.getElementById("newTeamLogo").value=""; this.selectedTeamName=name; this.refreshTeamSelectors(); const saved=await this.saveTeamCatalog(); this.showPopup(saved?"Team saved permanently":"Team saved locally. Firebase failed.","success"); this.render(); },
  async addPlayerToTeam(){ this.hasLocalChanges=true; const team=document.getElementById("teamForPlayer").value; const raw=(document.getElementById("newPlayerName").value||"").trim(); const players=raw.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean); if(!team||!players.length) return this.showPopup("Team and players required","warn"); if(!this.state.teams[team]) this.state.teams[team]=[]; let added=0; players.forEach(player=>{ if(!this.state.teams[team].includes(player)){ this.state.teams[team].push(player); added++; } }); if(!added) return this.showPopup("Players already exist","warn"); this.dirtyTeams.add(team); this.persistTeamBackup(); document.getElementById("newPlayerName").value=""; if(team===this.state.battingTeam){ this.state.benchPlayers=[...this.state.teams[team]]; this.renderBench(); } this.updateOpeningPlayerOptions(); this.showTeamPlayersForAdd(); const saved=await this.saveTeamCatalog(); this.showPopup(saved?`${added} player${added>1?"s":""} saved permanently`:`${added} player${added>1?"s":""} saved locally. Firebase failed.`,saved?"success":"warn"); this.render(); },
  parseBenchInput(){ const benchEl=document.getElementById("benchInput"); if(!benchEl) return; this.hasLocalChanges=true; const list=(benchEl.value||"").split(",").map(x=>x.trim()).filter(Boolean); this.state.benchPlayers=list; this.state.teams[this.state.battingTeam]=[...list]; this.dirtyTeams.add(this.state.battingTeam); this.renderBench(); this.render(); },
  renderBench(){ const sel=document.getElementById("nextBatsmanSelect"); if(!sel) return; const players=this.state.benchPlayers||[]; sel.innerHTML=players.length?players.map(p=>`<option>${p}</option>`).join(""):"<option>No players</option>"; },
  sendNextBatsman(){ const sel=document.getElementById("nextBatsmanSelect"); if(!sel) return; this.hasLocalChanges=true; const name=sel.value; if(!name||name==="No players") return; if(this.state.striker===1) this.state.bat1={name,r:0,b:0,f:0,s:0}; else this.state.bat2={name,r:0,b:0,f:0,s:0}; this.state.partnershipRuns=0; this.state.partnershipBalls=0; this.pushHighlight(`New batsman: ${name}`,"player"); this.render(); },
  openPicker(title,list,opts={}){ return new Promise((resolve)=>{ const required=!!opts.required; const overlay=document.getElementById("pickerOverlay"), titleEl=document.getElementById("pickerTitle"), listEl=document.getElementById("pickerList"), cancelBtn=document.getElementById("pickerCancelBtn"), okBtn=document.getElementById("pickerOkBtn"), inputEl=document.getElementById("pickerManualInput"); titleEl.innerText=title; listEl.innerHTML=(list&&list.length)?list.map(v=>`<div class="picker-item" data-value="${v}"><span>${v}</span></div>`).join(""):'<div class="picker-item" style="cursor:default;color:#64748b"><span>No squad players yet. Type name below.</span></div>'; inputEl.value=""; cancelBtn.innerText=required?"Required":"Cancel"; const close=(val)=>{ if(required && !val){ this.showPopup("Select player first","warn"); inputEl.focus(); return; } overlay.classList.remove("show"); listEl.onclick=null; cancelBtn.onclick=null; okBtn.onclick=null; inputEl.onkeydown=null; cancelBtn.innerText="Cancel"; resolve(val||null); }; listEl.onclick=(e)=>{ const it=e.target.closest(".picker-item[data-value]"); if(it) close(it.getAttribute("data-value")); }; okBtn.onclick=()=>{ const manual=(inputEl.value||"").trim(); close(manual||null); }; inputEl.onkeydown=(e)=>{ if(e.key==="Enter"){ e.preventDefault(); okBtn.onclick(); } if(e.key==="Escape") close(null); }; cancelBtn.onclick=()=>close(null); overlay.classList.add("show"); inputEl.focus(); }); },
  ensurePlayerInTeam(team,name){ if(!team||!name) return; if(!this.state.teams[team]) this.state.teams[team]=[]; if(!this.state.teams[team].includes(name)){ this.state.teams[team].push(name); this.dirtyTeams.add(team); this.persistTeamBackup(); this.saveTeamCatalog(); } },
  async promptNextBowler(){ const previous=this.state.lastOverBowler || this.state.bowler?.name || ""; const bowlers=(this.state.teams[this.state.bowlingTeam]||[]).filter(Boolean).filter(p=>p!==previous); const picked=await this.openPicker(`Over complete. Select bowler (${this.state.bowlingTeam})`,bowlers,{required:true}); if(!picked) return; if(picked===previous){ this.showPopup("Same bowler cannot bowl consecutive overs.","warn"); return this.promptNextBowler(); } this.ensurePlayerInTeam(this.state.bowlingTeam,picked); this.state.bowler={name:picked,balls:0,m:0,r:0,w:0}; const bowlerEl=document.getElementById("bowlerNameInput"); if(bowlerEl) bowlerEl.value=picked; this.hasLocalChanges=true; this.render(); },
  async promptNextBatsman(){ const dismissed=this.state.dismissedPlayers||[]; const bats=(this.state.teams[this.state.battingTeam]||[]).filter(Boolean).filter(p=>!dismissed.includes(p)); const picked=await this.openPicker(`Wicket fell. Select batsman (${this.state.battingTeam})`,bats,{required:true}); if(!picked) return; this.ensurePlayerInTeam(this.state.battingTeam,picked); const slot=this._lastOutSlot || this.state.striker; if(slot===1) this.state.bat1={name:picked,r:0,b:0,f:0,s:0}; else this.state.bat2={name:picked,r:0,b:0,f:0,s:0}; this._lastOutSlot=null; this.hasLocalChanges=true; this.render(); },
  async promptInningOpeners(){ const battingTeam=this.state.battingTeam; const bowlingTeam=this.state.bowlingTeam; const bats=(this.state.teams[battingTeam]||[]).filter(Boolean); const striker=await this.openPicker(`Start new innings. Select striker (${battingTeam})`,bats,{required:true}); let nonStriker=""; while(!nonStriker || nonStriker===striker){ nonStriker=await this.openPicker(`Select non-striker (${battingTeam})`, bats.filter(p=>p!==striker),{required:true}); if(nonStriker===striker){ this.showPopup("Striker and Non-Striker cannot be same","warn"); nonStriker=""; } } this.ensurePlayerInTeam(battingTeam,striker); this.ensurePlayerInTeam(battingTeam,nonStriker); this.state.bat1={name:striker,r:0,b:0,f:0,s:0}; this.state.bat2={name:nonStriker,r:0,b:0,f:0,s:0}; const bowlers=(this.state.teams[bowlingTeam]||[]).filter(Boolean); const bowler=await this.openPicker(`Select opening bowler (${bowlingTeam})`, bowlers,{required:true}); this.ensurePlayerInTeam(bowlingTeam,bowler); this.state.bowler={name:bowler,balls:0,m:0,r:0,w:0}; this.hasLocalChanges=true; this.render(); },
  needsPlayersSelected(){ return !this.state.bat1?.name || this.state.bat1.name==="-" || !this.state.bat2?.name || this.state.bat2.name==="-" || !this.state.bowler?.name || this.state.bowler.name==="-"; },
  setWicketType(type, helper="", outBatsman=""){
    this.state.wicketType=type;
    this.state.wicketHelper=helper;
    this.state.wicketOutBatsman=outBatsman;
    const hint = type ? `${type}${helper ? ` - ${helper}` : ""}` : "none";
    const el=document.getElementById("wicketTypeHint");
    if(el) el.innerText=hint;
  },
  wicketTypeText(){
    const type=this.state.wicketType||"";
    const helper=(this.state.wicketHelper||"").trim();
    if(!type) return "";
    if(type==="Bowled" || type==="LBW") return type;
    if(!helper) return type;
    if(type==="Caught") return `${type} by ${helper}`;
    if(type==="Run Out") return `${type} by ${helper}`;
    if(type==="Stumping") return `${type} by ${helper}`;
    return `${type} - ${helper}`;
  },
  handleWicketToggle(el){
    if(el?.checked) this.openWicketModal();
    else this.setWicketType("");
  },
  openWicketModal(){
    const overlay=document.getElementById("wicketOverlay");
    const input=document.getElementById("wicketHelperName");
    const list=document.getElementById("wicketHelperPlayers");
    const outSelect=document.getElementById("wicketOutBatsman");
    if(list){
      const names=(this.state.teams?.[this.state.bowlingTeam]||[]).filter(Boolean);
      list.innerHTML=names.map(n=>`<option value="${this.safeText(n)}"></option>`).join("");
    }
    if(input) input.value=this.state.wicketHelper||"";
    if(outSelect){
      const strikerName=this.state.striker===1 ? (this.state.bat1?.name||"-") : (this.state.bat2?.name||"-");
      const nonStrikerName=this.state.striker===1 ? (this.state.bat2?.name||"-") : (this.state.bat1?.name||"-");
      outSelect.innerHTML=`<option value="${this.safeText(strikerName)}">Striker - ${this.safeText(strikerName)}</option><option value="${this.safeText(nonStrikerName)}">Non-striker - ${this.safeText(nonStrikerName)}</option>`;
      outSelect.value=this.state.wicketOutBatsman || strikerName;
    }
    this.selectWicketModalType(this.state.wicketType || "Bowled");
    overlay?.classList.add("show");
    setTimeout(()=>input?.focus(),50);
  },
  selectWicketModalType(type){
    this._pendingWicketType=type;
    document.querySelectorAll(".wicket-type-btn").forEach(btn=>btn.classList.toggle("active",btn.dataset.type===type));
    const label=document.getElementById("wicketHelperLabel");
    const input=document.getElementById("wicketHelperName");
    const outLabel=document.getElementById("wicketOutLabel");
    const outSelect=document.getElementById("wicketOutBatsman");
    if(label){
      const text = type==="Caught" ? "Catch kisne liya? optional"
        : type==="Run Out" ? "Throw/run out kisne kiya? optional"
        : type==="Stumping" ? "Stumping kisne ki? optional"
        : "Is wicket type me name nahi lagega";
      label.innerText=text;
    }
    if(input){
      const needsName = type==="Caught" || type==="Run Out" || type==="Stumping";
      input.disabled = !needsName;
      input.placeholder = needsName ? "Optional name" : "Name not required";
      if(!needsName) input.value = "";
    }
    if(outLabel) outLabel.style.display = type==="Run Out" ? "" : "none";
    if(outSelect){
      outSelect.style.display = type==="Run Out" ? "" : "none";
      outSelect.disabled = type!=="Run Out";
    }
  },
  applyWicketModal(){
    const needsName = this._pendingWicketType==="Caught" || this._pendingWicketType==="Run Out" || this._pendingWicketType==="Stumping";
    const helper=needsName ? (document.getElementById("wicketHelperName")?.value||"").trim() : "";
    const outBatsman=this._pendingWicketType==="Run Out" ? (document.getElementById("wicketOutBatsman")?.value||"").trim() : "";
    this.setWicketType(this._pendingWicketType || "Bowled", helper, outBatsman);
    const wicket=document.getElementById("wicket");
    if(wicket) wicket.checked=true;
    document.getElementById("wicketOverlay")?.classList.remove("show");
  },
  cancelWicketModal(){
    if(!this.state.wicketType){
      const wicket=document.getElementById("wicket");
      if(wicket) wicket.checked=false;
    }
    document.getElementById("wicketOverlay")?.classList.remove("show");
  },
  pushHighlight(text,type="auto"){ this.state.highlights.unshift({text,type,time:new Date().toLocaleTimeString()}); if(this.state.highlights.length>20) this.state.highlights=this.state.highlights.slice(0,20); },
  ballCommentaryText({ballNo,label,run,wide,noball,byes,legbyes,wicket,batter,bowler}){
    if(wicket) return `${ballNo}: ${bowler} to ${batter}, wicket! ${label}`;
    if(wide) return `${ballNo}: ${bowler} to ${batter}, wide ball. ${label}`;
    if(noball) return `${ballNo}: ${bowler} to ${batter}, no ball. ${label}`;
    if(byes) return `${ballNo}: ${bowler} to ${batter}, ${run} bye${run===1?"":"s"}.`;
    if(legbyes) return `${ballNo}: ${bowler} to ${batter}, ${run} leg bye${run===1?"":"s"}.`;
    if(run===4) return `${ballNo}: ${batter} hits FOUR.`;
    if(run===6) return `${ballNo}: ${batter} goes big for SIX.`;
    if(run===0) return `${ballNo}: ${bowler} to ${batter}, dot ball.`;
    return `${ballNo}: ${batter} takes ${run} run${run===1?"":"s"}.`;
  },
  setLiveControl(mode){
    if(this.state.matchFinished && mode==="live"){
      this.showPopup("Match complete ho chuka hai. New match start karo.","warn");
      return;
    }
    this.hasLocalChanges=true;
    this.state.liveControl = { mode, note: mode === "paused" ? "Break" : (mode === "delay" ? "Delayed" : "Live") };
    this.showPopup(mode === "live" ? "Match is live" : (mode === "paused" ? "Match break enabled" : "Match delay enabled"), mode === "live" ? "success" : "warn");
    this.render();
  },
  updateLiveControls(){
    const mode=this.state.liveControl?.mode || "live";
    const locked=!!this.state.scoringLocked;
    const complete=!!this.state.matchFinished;
    const noLive=!this.state.liveStarted && !this.state.battingTeam && !this.state.bowlingTeam;
    const label=noLive ? "No Live" : (complete ? "Complete" : (mode==="paused" ? "Break" : (mode==="delay" ? "Delay" : "Live")));
    const note=noLive ? "Start a match from setup" : (complete ? "Match Complete" : (locked ? "Scoring locked" : "Scoring open"));
    const pill=document.getElementById("liveStatusPill");
    if(pill){ pill.innerText=label.toUpperCase(); pill.className=`pill ${noLive?"paused":(complete?"paused":mode)}`; }
    const text=document.getElementById("liveModeText");
    if(text) text.innerText=label;
    const noteEl=document.getElementById("liveModeNote");
    if(noteEl) noteEl.innerText=note;
    ["live","paused","delay"].forEach(x=>{
      const btn=document.getElementById(`${x}Btn`);
      if(btn) btn.classList.toggle("active", noLive ? false : (complete ? x==="paused" : x===mode));
    });
    const lockBtn=document.getElementById("lockBtn");
    const unlockBtn=document.getElementById("unlockBtn");
    if(lockBtn) lockBtn.classList.toggle("active", locked);
    if(unlockBtn) unlockBtn.classList.toggle("active", !locked);
  },
  setScoringLock(flag){ this.hasLocalChanges=true; this.state.scoringLocked=!!flag; this.showPopup(this.state.scoringLocked?"Scoring locked":"Scoring unlocked", this.state.scoringLocked?"warn":"success"); this.render(); },
  updateMatchPreview(){
    const bat=this.state.battingTeam||"-";
    const bowl=this.state.bowlingTeam||"-";
    const overs=Number(this.state.totalOvers||20);
    const tossTeam=this.state.tossWinner==="B"?bowl:bat;
    const tossAction=this.state.tossDecision==="bowl"?"bowl":"bat";
    const setText=(id,value)=>{ const el=document.getElementById(id); if(el) el.innerText=value; };
    setText("previewBattingTeam",bat);
    setText("previewBowlingTeam",bowl);
    setText("previewBattingCount",`${(this.state.teams?.[bat]||[]).length} players`);
    setText("previewBowlingCount",`${(this.state.teams?.[bowl]||[]).length} players`);
    setText("previewOvers",String(overs));
    setText("previewToss",`${tossTeam} chose ${tossAction}`);
    setText("previewStatus",this.state.matchFinished?"Finished":"Ready");
  },
  updateSetupPreviewFromInputs(){
    const setup=this.getSetupMatchTeams();
    const bat=setup.teamA || "-";
    const bowl=setup.teamB || "-";
    const overs=Math.max(1,Number(document.getElementById("totalOvers")?.value || this.state.totalOvers || 20));
    const tossAction=setup.tossDecision==="bowl"?"bowl":"bat";
    const setText=(id,value)=>{ const el=document.getElementById(id); if(el) el.innerText=value; };
    const title=document.getElementById("matchTitle");
    if(title) title.value=`${bat} vs ${bowl}`;
    setText("tossLabelA",bat);
    setText("tossLabelB",bowl);
    setText("previewBattingTeam",setup.battingTeam || "-");
    setText("previewBowlingTeam",setup.bowlingTeam || "-");
    setText("previewBattingCount",`${(this.state.teams?.[setup.battingTeam]||[]).length} batting players`);
    setText("previewBowlingCount",`${(this.state.teams?.[setup.bowlingTeam]||[]).length} bowling players`);
    setText("previewOvers",String(overs));
    setText("previewToss",`${setup.tossTeam || "-"} chose ${tossAction}`);
    setText("previewStatus","Draft");
    this.updateOpeningPlayerOptions();
  },
  async startNewMatch(){
    const setup=this.getSetupMatchTeams();
    if(!setup.teamA || !setup.teamB || setup.teamA===setup.teamB){
      this.showPopup("Select two different teams","warn");
      return;
    }
    const hasProgress=Number(this.state.balls||0)>0 || Number(this.state.runs||0)>0 || Number(this.state.wkts||0)>0 || (this.state.overSummary||[]).length>0;
    if(hasProgress && !confirm("Start a fresh match and reset current score?")) return;
    const keep={
      teams:this.state.teams||{},
      teamInfo:this.state.teamInfo||{},
      completedMatches:this.state.completedMatches||[],
      tournamentStats:this.state.tournamentStats||{players:{}},
      pointsTable:this.state.pointsTable||{},
      mvpLog:this.state.mvpLog||[],
      league:this.state.league||{name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]},
      activeLeagueMatch:this.state.activeLeagueMatch||null,
      archived:false,
      offlineQueue:this.state.offlineQueue||[]
    };
    const battingTeam=setup.battingTeam;
    const bowlingTeam=setup.bowlingTeam;
    const activeFixture=Array.isArray(this.state.league?.schedule) && this.state.activeLeagueMatch
      ? this.state.league.schedule.find((m,i)=> (this.state.activeLeagueMatch.id && m.id===this.state.activeLeagueMatch.id) || i===this.state.activeLeagueMatch.index)
      : null;
    const activeLeagueMatch=(activeFixture && ((activeFixture.teamA===setup.teamA && activeFixture.teamB===setup.teamB) || (activeFixture.teamA===setup.teamB && activeFixture.teamB===setup.teamA))) ? this.state.activeLeagueMatch : null;
    const tossWinner=setup.tossWinner;
    const tossDecision=setup.tossDecision;
    const totalOvers=Math.max(1,Number(document.getElementById("totalOvers")?.value||20));
    const winnerTeam=setup.tossTeam;
    const action=tossDecision==="bat"?"batting":"bowling";
    const openingStriker=document.getElementById("openingStriker")?.value || "-";
    const openingNonStriker=document.getElementById("openingNonStriker")?.value || "-";
    const openingBowler=document.getElementById("openingBowler")?.value || "-";
    if(openingStriker && openingNonStriker && openingStriker!=="-" && openingStriker===openingNonStriker){
      this.showPopup("Striker and Non-Striker cannot be same","warn");
      return;
    }
    const followLink=(document.getElementById("followLinkInput")?.value||"").trim();
    this.state={...this.state,...this.scoreDefaults(),...keep,liveStarted:true,battingTeam,bowlingTeam,matchTitle:`${setup.teamA} vs ${setup.teamB}`,tossWinner,tossDecision,tossText:`${winnerTeam} chose ${action}`,totalOvers,followLink,benchPlayers:[...(keep.teams[battingTeam]||[])]};
    this.clearUndoBackup();
    this.state.activeLeagueMatch=activeLeagueMatch;
    this.state.bat1={name:openingStriker,r:0,b:0,f:0,s:0};
    this.state.bat2={name:openingNonStriker,r:0,b:0,f:0,s:0};
    this.state.bowler={name:openingBowler,balls:0,m:0,r:0,w:0};
    this.hasLocalChanges=true;
    this.persistMatchBackup();
    this.refreshTeamSelectors();
    this.renderBench();
    this.updateMatchPreview();
    this.isHydrated=true;
    this.switchPage("home");
    this.render();
    await this.saveToFirebase(true);
    this.showPopup("New match is live for users","success");
  },
  ensureTeamInPoints(team){ if(!team) return; if(!this.state.pointsTable[team]) this.state.pointsTable[team]={P:0,W:0,L:0,T:0,Pts:0,RF:0,BF:0,RA:0,BA:0}; const s=this.state.pointsTable[team]; ["P","W","L","T","Pts","RF","BF","RA","BA"].forEach(k=>{ if(typeof s[k]!=="number") s[k]=Number(s[k]||0); }); },
  nrr(team){ const s=this.state.pointsTable?.[team]||{}; const forRate=s.BF?((s.RF||0)/(s.BF/6)):0; const againstRate=s.BA?((s.RA||0)/(s.BA/6)):0; return (forRate-againstRate).toFixed(3); },
  addPlayerStat(name,patch){ if(!name||name==="-" ) return; if(!this.state.tournamentStats.players[name]) this.state.tournamentStats.players[name]={runs:0,balls:0,wkts:0,matches:0}; const p=this.state.tournamentStats.players[name]; p.runs += Number(patch.runs||0); p.balls += Number(patch.balls||0); p.wkts += Number(patch.wkts||0); p.matches = Math.max(p.matches, (patch.matchesInc? p.matches+1 : p.matches)); },
  updateTournamentAfterMatch(){
    if(!this.state.activeLeagueMatch){
      return;
    }
    const active=this.state.activeLeagueMatch;
    const fixture=Array.isArray(this.state.league?.schedule)
      ? this.state.league.schedule.find((m,i)=> (active.id && m.id===active.id) || i===active.index)
      : null;
    if(!fixture || fixture.status==="done") return;
    const winnerText=this.state.winnerText||"";
    const teamA=this.state.matchTitle.split(" vs ")[0]||this.state.battingTeam;
    const teamB=this.state.matchTitle.split(" vs ")[1]||this.state.bowlingTeam;
    this.ensureTeamInPoints(teamA); this.ensureTeamInPoints(teamB);
    this.state.pointsTable[teamA].P++; this.state.pointsTable[teamB].P++;
    if(/tied/i.test(winnerText)){ this.state.pointsTable[teamA].T++; this.state.pointsTable[teamB].T++; this.state.pointsTable[teamA].Pts+=1; this.state.pointsTable[teamB].Pts+=1; }
    else if(winnerText.startsWith(teamA)){ this.state.pointsTable[teamA].W++; this.state.pointsTable[teamB].L++; this.state.pointsTable[teamA].Pts+=2; }
    else if(winnerText.startsWith(teamB)){ this.state.pointsTable[teamB].W++; this.state.pointsTable[teamA].L++; this.state.pointsTable[teamB].Pts+=2; }
    const firstBattingTeam=this.state.bowlingTeam, secondBattingTeam=this.state.battingTeam;
    const maxBalls=(Number(this.state.totalOvers)||20)*6;
    const firstRuns=Number(this.state.firstInningsScore||0), firstBalls=maxBalls;
    const secondRuns=Number(this.state.runs||0), secondBalls=Math.max(Number(this.state.balls||0),1);
    this.ensureTeamInPoints(firstBattingTeam); this.ensureTeamInPoints(secondBattingTeam);
    this.state.pointsTable[firstBattingTeam].RF+=firstRuns; this.state.pointsTable[firstBattingTeam].BF+=firstBalls; this.state.pointsTable[firstBattingTeam].RA+=secondRuns; this.state.pointsTable[firstBattingTeam].BA+=secondBalls;
    this.state.pointsTable[secondBattingTeam].RF+=secondRuns; this.state.pointsTable[secondBattingTeam].BF+=secondBalls; this.state.pointsTable[secondBattingTeam].RA+=firstRuns; this.state.pointsTable[secondBattingTeam].BA+=firstBalls;
    const innings=Object.values(this.state.inningsDetails||{});
    const batters=innings.flatMap(d=>Array.isArray(d?.battingScorecard)?d.battingScorecard:[]);
    const playerMatchSeen=new Set();
    batters.forEach(b=>{
      const name=b?.name;
      const firstMatch=!playerMatchSeen.has(name);
      if(name) playerMatchSeen.add(name);
      this.addPlayerStat(name,{runs:b?.r||0,balls:b?.b||0,matchesInc:firstMatch});
    });
    const bowlingTotals={};
    innings.forEach(d=>Object.entries(d?.bowlerStats||{}).forEach(([name,s])=>{
      if(!bowlingTotals[name]) bowlingTotals[name]={wkts:0};
      bowlingTotals[name].wkts+=Number(s?.wkts||0);
    }));
    Object.entries(bowlingTotals).forEach(([name,s])=>{
      const firstMatch=!playerMatchSeen.has(name);
      playerMatchSeen.add(name);
      this.addPlayerStat(name,{wkts:s.wkts||0,matchesInc:firstMatch});
    });
    let bestBatter=batters.slice().sort((a,b)=>(b?.r||0)-(a?.r||0))[0];
    let bestBowler=Object.entries(bowlingTotals).sort((a,b)=>(b[1]?.wkts||0)-(a[1]?.wkts||0))[0];
    const mvp = bestBowler && (bestBowler[1].wkts||0) > 0 ? `${bestBowler[0]} (${bestBowler[1].wkts}W)` : `${bestBatter?.name||"-"} (${bestBatter?.r||0}R)`;
    this.state.mvpLog.unshift({id:Date.now(),match:this.state.matchTitle,mvp});
    if(this.state.mvpLog.length>100) this.state.mvpLog=this.state.mvpLog.slice(0,100);
  },
  updateLeagueAfterMatch(item){
    const schedule=this.state.league?.schedule;
    if(!Array.isArray(schedule) || !schedule.length) return;
    const active=this.state.activeLeagueMatch;
    const title=item?.title || this.state.matchTitle || "";
    const [teamA,teamB]=title.split(" vs ").map(x=>String(x||"").replace(" - Super Over","").trim());
    if(!teamA || !teamB) return;
    const idx=active ? schedule.findIndex((m,i)=> (active.id && m.id===active.id) || i===active.index) : -1;
    if(idx<0) return;
    const fixture=schedule[idx];
    if(fixture.status==="done") return;
    if(item){
      item.leagueName=this.state.league?.name||"";
      item.leagueStage=fixture.stage||"League";
      item.leagueRound=fixture.round||"";
      item.leagueMatchNo=fixture.matchNo||idx+1;
      item.venue=fixture.venue||"";
      item.scheduledAt=[fixture.date,fixture.time].filter(Boolean).join(" ");
    }
    schedule[idx]={...fixture,status:"done",result:item?.winnerText||this.state.winnerText||"",completedMatchId:item?.id||Date.now(),playedAt:item?.playedAt||new Date().toISOString()};
  },
  exportTournamentSummary(){
    const lines=[];
    lines.push(`Tournament Summary - ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("Points Table:");
    Object.entries(this.state.pointsTable||{}).forEach(([t,s])=>lines.push(`${t}: P${s.P} W${s.W} L${s.L} T${s.T} Pts${s.Pts} NRR${this.nrr(t)}`));
    lines.push("");
    lines.push("Matches:");
    (this.state.completedMatches||[]).forEach((m,i)=>lines.push(`${i+1}. ${m.title} | ${m.winnerText}`));
    const blob = new Blob([lines.join("\n")], {type:"text/plain;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="tournament-summary.txt"; a.click(); URL.revokeObjectURL(a.href);
    this.showPopup("Summary exported","success");
  },
  toggleArchive(){ this.hasLocalChanges=true; this.state.archived=!this.state.archived; this.showPopup(this.state.archived?"Match archived/locked":"Archive removed", this.state.archived?"warn":"success"); this.render(); },
  currentBattingScorecard(){
    const rows=[];
    (Array.isArray(this.state.battingScorecard)?this.state.battingScorecard:[]).forEach(b=>this.upsertBattingRow(rows,b));
    [this.state.bat1,this.state.bat2].forEach(b=>{
      if(b?.name && b.name!=="-") this.upsertBattingRow(rows,{...b,out:false});
    });
    return rows;
  },
  upsertBattingRow(rows,b){
    if(!b?.name || b.name==="-") return rows;
    const idx=rows.findIndex(x=>x.name===b.name);
    const row={...b};
    if(idx>=0) rows[idx]={...rows[idx],...row};
    else rows.push(row);
    return rows;
  },
  currentInningsDetail(team){
    return {
      team,
      runs:Number(this.state.runs||0),
      wkts:Number(this.state.wkts||0),
      balls:Number(this.state.balls||0),
      overs:this.overText(this.state.balls||0),
      extras:Number(this.state.extras||0),
      battingScorecard:this.currentBattingScorecard(),
      bowlerStats:JSON.parse(JSON.stringify(this.state.bowlerStats||{})),
      fallOfWickets:[...(this.state.fallOfWickets||[])],
      commentary:JSON.parse(JSON.stringify(this.state.commentary||[])),
      overSummary:JSON.parse(JSON.stringify(this.state.overSummary||[]))
    };
  },
  finalizeMatchRecord(){
    if(this.state.resultRecorded) return;
    const completedInnings={...(this.state.completedInnings||{})};
    completedInnings[this.state.battingTeam]=this.currentBattingScorecard();
    const completedBowling={...(this.state.completedBowling||{})};
    completedBowling[this.state.battingTeam]={...(this.state.bowlerStats||{})};
    const inningsDetails={...(this.state.inningsDetails||{})};
    inningsDetails[this.state.battingTeam]=this.currentInningsDetail(this.state.battingTeam);
    const item={
      ...JSON.parse(JSON.stringify(this.state)),
      id:Date.now(),
      title:this.state.matchTitle||`${this.state.battingTeam} vs ${this.state.bowlingTeam}`,
      battingTeam:this.state.battingTeam,
      bowlingTeam:this.state.bowlingTeam,
      teamA:this.state.bowlingTeam,
      teamB:this.state.battingTeam,
      inningNumber:this.state.inningNumber||2,
      liveStarted:false,
      matchFinished:true,
      winnerText:this.state.winnerText||"Result pending",
      tossText:this.state.tossText||"-",
      firstInnings:`${Number(this.state.firstInningsScore||0)}/${Number(this.state.firstInningsWkts||0)}`,
      secondInnings:`${Number(this.state.runs||0)}/${Number(this.state.wkts||0)} (${this.overText(this.state.balls||0)})`,
      playedAt:new Date().toISOString(),
      completedInnings,
      completedBowling,
      inningsDetails,
      teams:{...this.state.teams},
      teamInfo:{...this.state.teamInfo}
    };
    delete item.history;
    delete item.ballHistory;
    if(!Array.isArray(this.state.completedMatches)) this.state.completedMatches=[];
    this.state.completedMatches.unshift(item);
    if(item.superOverFor?.id){
      const parent=this.state.completedMatches.find(m=>m.id===item.superOverFor.id);
      if(parent){
        parent.superOverStatus="completed";
        parent.superOverResult=item.winnerText;
        parent.superOverMatchId=item.id;
      }
    }
    if(this.state.completedMatches.length>100) this.state.completedMatches=this.state.completedMatches.slice(0,100);
    this.updateTournamentAfterMatch();
    this.updateLeagueAfterMatch(item);
    this.state.activeLeagueMatch=null;
    this.state.resultRecorded=true;
    this.resultOverlayClosed=false;
    this.hasLocalChanges=true;
  },
  clearCurrentLiveAfterComplete(){
    const keep={
      teams:this.state.teams||{},
      teamInfo:this.state.teamInfo||{},
      completedMatches:this.state.completedMatches||[],
      tournamentStats:this.state.tournamentStats||{players:{}},
      pointsTable:this.state.pointsTable||{},
      mvpLog:this.state.mvpLog||[],
      league:this.state.league||{name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]},
      offlineQueue:this.state.offlineQueue||[],
      followLink:this.state.followLink||""
    };
    this.state={
      ...this.state,
      ...this.scoreDefaults(),
      ...keep,
      matchTitle:"Select Teams",
      battingTeam:"",
      bowlingTeam:"",
      tossText:"Toss pending",
      liveStarted:false,
      matchFinished:false,
      winnerText:"",
      scoringLocked:false,
      liveControl:{mode:"live",note:"Live"},
      activeLeagueMatch:null
    };
  },
  async startSuperOver(){
    if(!/tied/i.test(this.state.winnerText||"")) return this.showPopup("Super Over is available only after tie.","warn");
    if(!confirm("Start Super Over? Current tied result will stay in history and scoring will reset to 1 over.")) return;
    const keep={
      teams:this.state.teams||{},
      teamInfo:this.state.teamInfo||{},
      completedMatches:this.state.completedMatches||[],
      tournamentStats:this.state.tournamentStats||{players:{}},
      pointsTable:this.state.pointsTable||{},
      mvpLog:this.state.mvpLog||[],
      league:this.state.league||{name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]}
    };
    const parentMatch=this.state.completedMatches?.[0] || null;
    if(parentMatch && /tied/i.test(parentMatch.winnerText||"")){
      parentMatch.superOverStatus="started";
    }
    const battingTeam=this.state.battingTeam, bowlingTeam=this.state.bowlingTeam;
    this.state={...this.state,...this.scoreDefaults(),...keep,liveStarted:true,battingTeam,bowlingTeam,matchTitle:`${battingTeam} vs ${bowlingTeam} - Super Over`,tossText:"Super Over",totalOvers:1,benchPlayers:[...(keep.teams[battingTeam]||[])]};
    this.clearUndoBackup();
    this.state.superOverFor=parentMatch?{id:parentMatch.id,title:parentMatch.title}:null;
    this.hasLocalChanges=true;
    this.resultOverlayClosed=true;
    this.closeResultOverlay();
    this.refreshTeamSelectors();
    this.renderBench();
    await this.promptInningOpeners();
    this.render();
    this.showPopup("Super Over started","success");
  },
  deriveWinnerText(){
    if(this.state.winnerText) return this.state.winnerText;
    if((this.state.inningNumber||1) <= 1 || !this.state.target) return "";
    const target=Number(this.state.target||0);
    const runs=Number(this.state.runs||0);
    if(runs>=target){
      const wktsLeft=Math.max(10-Number(this.state.wkts||0),0);
      const maxBalls=(Number(this.state.totalOvers)||20)*6;
      const ballsLeft=Math.max(maxBalls-Number(this.state.balls||0),0);
      return `${this.state.battingTeam} won by ${wktsLeft} wickets (${ballsLeft} balls left)`;
    }
    const margin=target-runs-1;
    if(margin===0) return "Match Tied";
    return `${this.state.bowlingTeam} won by ${Math.max(margin,0)} runs`;
  },
  async completeMatch(){
    const derivedWinner=this.deriveWinnerText();
    if(!derivedWinner){
      return this.showPopup("Complete se pehle 2nd innings / target hona chahiye.","warn");
    }
    if(!this.state.matchFinished && !confirm(`Complete match?\n${derivedWinner}`)) return;
    this.state.winnerText=derivedWinner;
    this.state.matchFinished=true;
    this.state.liveStarted=false;
    this.state.scoringLocked=true;
    this.state.liveControl={mode:"paused",note:"Match Complete"};
    if(!this.state.resultRecorded) this.finalizeMatchRecord();
    this.clearCurrentLiveAfterComplete();
    this.clearUndoBackup();
    this.hasLocalChanges=true;
    this.render(false);
    await this.saveToFirebase(true);
    await persistCompletedMatch({matchId:MATCH_ID,state:this.state,updatedBy:this.sessionId,archiveRealtime:true});
    this.showPopup("Match completed and published","success");
  },
  handleShortcuts(e){ const t=e.target?.tagName?.toLowerCase(); if(["input","textarea","select"].includes(t)) return; const k=e.key.toLowerCase(); if(["0","1","2","3","4","5","6"].includes(k)) return this.addBall(parseInt(k,10)); if(k==="w"){ const el=document.getElementById("wicket"); if(el){ el.checked=!el.checked; this.handleWicketToggle(el); } } if(k==="n") document.getElementById("noball").checked=!document.getElementById("noball").checked; if(k==="d") document.getElementById("wide").checked=!document.getElementById("wide").checked; },
  applyPlayerNames(){ const strikerEl=document.getElementById("strikerName"), nonStrikerEl=document.getElementById("nonStrikerName"), bowlerEl=document.getElementById("bowlerNameInput"); if(!strikerEl||!nonStrikerEl||!bowlerEl) return; this.hasLocalChanges=true; const s=strikerEl.value, ns=nonStrikerEl.value, b=bowlerEl.value; if(s && ns && s===ns){ this.showPopup("Striker and Non-Striker cannot be same.","warn"); this.refreshPlayerDeskSelectors(); return; } if(s) this.state.bat1.name=s; if(ns) this.state.bat2.name=ns; if(b && b===this.state.lastOverBowler && (this.state.balls%6===0) && this.state.balls>0){ this.showPopup("Same bowler cannot bowl consecutive overs.","warn"); this.refreshPlayerDeskSelectors(); return; } if(b) this.state.bowler.name=b; this.render(); this.hidePlayerDesk(); },
  hidePlayerDesk(){ const p=document.getElementById("playerDeskPanel"), s=document.getElementById("playerDeskShowPanel"); if(p&&s){ p.style.display="none"; s.style.display="block"; } },
  showPlayerDesk(){ const p=document.getElementById("playerDeskPanel"), s=document.getElementById("playerDeskShowPanel"); if(p&&s){ p.style.display="block"; s.style.display="none"; } },
  async addBall(run){
    if(this.state.archived){ this.showPopup("Match is archived. Unarchive to edit.","warn"); return; }
    if(this.state.scoringLocked){ this.showPopup("Scoring is locked. Unlock to continue.","warn"); return; }
    if(this.state.matchFinished){ this.showPopup("Match already finished.","warn"); return; }
    if(this.needsPlayersSelected()){
      await this.promptInningOpeners();
      if(this.needsPlayersSelected()) return;
    }
    if(run==="custom"){ const c=prompt("Enter custom runs:"); if(c&&!isNaN(c)) run=parseInt(c,10); else return; }
    const wicketChecked=!!document.getElementById("wicket")?.checked || !!this.state.wicketType;
    if(wicketChecked && !this.state.wicketType){
      this.openWicketModal();
      return;
    }
    const ballBackup=this.saveBallHistory();
    const wide=!!document.getElementById("wide")?.checked, noball=!!document.getElementById("noball")?.checked, byes=!!document.getElementById("byes")?.checked, legbyes=!!document.getElementById("legbyes")?.checked, wicket=wicketChecked;
    const legal=!(wide||noball); let extra=0,label="";
    if(wide){extra=1;label=run>0?(run+1)+"Wd":"Wd";} else if(noball){extra=1;label=run>0?(run+1)+"Nb":"Nb";} else if(byes){label=run+"B";} else if(legbyes){label=run>0?`LB+${run}`:"LB";} else label=String(run);
    const total=run+extra;
    const bowlerChargedRuns=(byes||legbyes)?extra:total;
    this.state.runs+=total; this.state.bowler.r+=bowlerChargedRuns; this.state.partnershipRuns+=total;
    if(wide||noball) this.state.extras+=total; else if(byes||legbyes) this.state.extras+=run;
    const currentBowlerName = this.state.bowler?.name || "-";
    if(!this.state.bowlerStats[currentBowlerName]) this.state.bowlerStats[currentBowlerName] = { balls:0, runs:0, wkts:0, dots:0 };
    this.state.bowlerStats[currentBowlerName].runs += bowlerChargedRuns;
    if(legal){
      this.state.balls++; this.state.bowler.balls++; this.state.partnershipBalls++;
      this.state.bowlerStats[currentBowlerName].balls += 1;
      if(run === 0 && !byes && !legbyes) this.state.bowlerStats[currentBowlerName].dots = Number(this.state.bowlerStats[currentBowlerName].dots || 0) + 1;
      const bat=this.state.striker===1?this.state.bat1:this.state.bat2; bat.b++;
      if(!byes&&!legbyes){ bat.r+=run; if(run===4) bat.f++; if(run===6) bat.s++; }
    }
    if(wicket){
      const runOutOutName = /run\s*out/i.test(this.state.wicketType||"") ? (this.state.wicketOutBatsman||"").trim() : "";
      const outSlot = runOutOutName && this.state.bat2?.name===runOutOutName ? 2 : (runOutOutName && this.state.bat1?.name===runOutOutName ? 1 : this.state.striker);
      const outBatsman = outSlot===1 ? (this.state.bat1?.name||"") : (this.state.bat2?.name||"");
      this._lastOutSlot=outSlot;
      if(outBatsman && outBatsman!=="-" && !(this.state.dismissedPlayers||[]).includes(outBatsman)){
        this.state.dismissedPlayers.push(outBatsman);
        const batsman = outSlot===1 ? this.state.bat1 : this.state.bat2;
        if(!Array.isArray(this.state.battingScorecard)) this.state.battingScorecard = [];
        this.upsertBattingRow(this.state.battingScorecard,{...batsman, out: true, retired:false});
      }
      const wicketText=this.wicketTypeText();
      const isBowlerWicket=!/run\s*out/i.test(wicketText||"");
      this.state.wkts++; if(isBowlerWicket) this.state.bowler.w++; const t=wicketText?` (${wicketText})`:""; label=(run>0?`W${run}`:"W") + t;
      if(isBowlerWicket) this.state.bowlerStats[currentBowlerName].wkts += 1;
      this.state.lastWicket=`${this.state.runs}/${this.state.wkts}${t}`; this.pushHighlight(`Wicket! ${this.state.lastWicket}`,"wicket");
      this.state.fallOfWickets.push(`${this.state.runs}/${this.state.wkts} (${this.overText(this.state.balls)})${t}`);
      this.state.partnershipRuns=0; this.state.partnershipBalls=0; this.setWicketType("");
    }
    this.state.over.push(label);
    const ballNo=this.overText(this.state.balls);
    const strikerName=this.state.striker===1?this.state.bat1.name:this.state.bat2.name;
    const commentaryText=this.ballCommentaryText({ballNo,label,run,wide,noball,byes,legbyes,wicket,batter:strikerName||"-",bowler:currentBowlerName||"-"});
    this.state.commentary.unshift({ball:ballNo,text:commentaryText});
    if(!Array.isArray(this.state.ballEvents)) this.state.ballEvents=[];
    this.state.ballEvents.push({id:ballBackup.id,ball:ballNo,label,text:commentaryText,before:ballBackup.before,score:`${this.state.runs}/${this.state.wkts} (${this.overText(this.state.balls)})`});
    if(this.state.ballEvents.length>120) this.state.ballEvents.shift();
    this.persistUndoBackup();
    if(run===4) this.pushHighlight(`FOUR by ${this.state.striker===1?this.state.bat1.name:this.state.bat2.name}`,"boundary");
    if(run===6) this.pushHighlight(`SIX by ${this.state.striker===1?this.state.bat1.name:this.state.bat2.name}`,"boundary");
    if(wicket) await this.promptNextBatsman();
    if(legal&&run%2===1) this.swapBatsman(false);
    const maxBalls=(Number(this.state.totalOvers)||20)*6;
    const chaseComplete = this.state.inningNumber>1 && this.state.target && this.state.runs>=this.state.target;
    const inningEnded = legal && this.state.balls>=maxBalls;
    if(legal && this.state.balls>0&&this.state.balls%6===0 && !inningEnded && !chaseComplete){
      this.state.overSummary.unshift({overNo:Math.floor(this.state.balls/6),timeline:[...this.state.over]});
      this.state.lastOverBowler=this.state.bowler.name||"-";
      this.swapBatsman(false); this.state.over=[]; await this.promptNextBowler();
    }
    if(this.state.inningNumber===1 && legal && this.state.balls>=maxBalls){
      this.clearChecks();
      this.render();
      if(confirm("1st innings overs complete. Switch innings now?")) this.switchInnings();
      return;
    }
    if(this.state.inningNumber>1 && this.state.target && this.state.runs>=this.state.target){
      const teamSize = Math.max((this.state.teams?.[this.state.battingTeam]||[]).length, 2);
      const wktsLeft = Math.max(teamSize - this.state.wkts - 1, 0);
      const maxBallsWin=(Number(this.state.totalOvers)||20)*6;
      const ballsLeft = Math.max(maxBallsWin - this.state.balls, 0);
      this.state.matchFinished=true;
      this.state.winnerText=`${this.state.battingTeam} won by ${wktsLeft} wickets (${ballsLeft} balls left)`;
      this.pushHighlight(this.state.winnerText,"result"); this.finalizeMatchRecord();
      this.showPopup("Match Finished: "+this.state.winnerText,"success");
    } else if(this.state.inningNumber>1 && legal && this.state.balls>=maxBalls){
      this.state.matchFinished=true;
      const diff=(this.state.target||0)-this.state.runs-1;
      if(diff===0){
        this.state.winnerText=`Match Tied`;
      } else {
        this.state.winnerText=`${this.state.bowlingTeam} won by ${Math.max(diff,0)} runs`;
      }
      this.pushHighlight(this.state.winnerText,"result"); this.finalizeMatchRecord();
      this.showPopup("Match Finished: "+this.state.winnerText,"success");
    }
    this.clearChecks(); this.render();
  },
  editOverSummary(idx){ const row=this.state.overSummary[idx]; if(!row) return; const upd=prompt(`Edit Over ${row.overNo}`,row.timeline.join(" ")); if(upd===null) return; row.timeline=upd.split(" ").filter(Boolean); this.render(); },
  swapBatsman(renderNow=true){ this.state.striker=this.state.striker===1?2:1; if(renderNow) this.render(); },
  async retireBatsman(){ if(this.state.archived){ this.showPopup("Match is archived. Unarchive to edit.","warn"); return; } const current=this.state.striker===1?this.state.bat1:this.state.bat2; if(!current?.name||current.name==="-"){ this.showPopup("No striker available to retire.","warn"); return; } const other=this.state.striker===1?this.state.bat2.name:this.state.bat1.name; const dismissed=this.state.dismissedPlayers||[]; const candidates=(this.state.teams[this.state.battingTeam]||[]).filter(Boolean).filter(p=>p!==current.name && p!==other && !dismissed.includes(p)); if(!candidates.length){ this.showPopup("No replacement batsman available.","warn"); return; } const replacement=await this.openPicker(`Retire ${current.name}. Select replacement (${this.state.battingTeam})`, candidates); if(!replacement) return; if(!Array.isArray(this.state.battingScorecard)) this.state.battingScorecard=[]; this.upsertBattingRow(this.state.battingScorecard,{...current,out:false,retired:true,status:"Retired"}); this.ensurePlayerInTeam(this.state.battingTeam,replacement); if(this.state.striker===1){ this.state.bat1={name:replacement,r:0,b:0,f:0,s:0}; } else { this.state.bat2={name:replacement,r:0,b:0,f:0,s:0}; } this.state.dismissedPlayers.push(current.name); this.state.lastWicket=`${this.state.runs}/${this.state.wkts} (Retired)`; this.state.fallOfWickets.push(`${current.name} retired at ${this.overText(this.state.balls)}`); this.pushHighlight(`${current.name} retired`,"wicket"); this.state.partnershipRuns=0; this.state.partnershipBalls=0; this.hasLocalChanges=true; this.render(); },
  newOver(){ this.saveHistory(); this.state.over=[]; this.swapBatsman(false); this.promptNextBowler(); this.render(); },
  async switchInnings(){ if(this.state.archived){ this.showPopup("Match is archived. Unarchive to edit.","warn"); return; } if(!confirm("Switch innings and reset scoreboard?")) return; this.saveHistory(); if((this.state.inningNumber||1)===1){ this.state.firstInningsScore=Number(this.state.runs||0); this.state.firstInningsWkts=Number(this.state.wkts||0); this.state.target=this.state.firstInningsScore+1; } 
    // Save current batting scorecard
    const currentTeam = this.state.battingTeam;
    if(!Array.isArray(this.state.battingScorecard)) this.state.battingScorecard = [];
    if(this.state.bat1.name !== "-") this.upsertBattingRow(this.state.battingScorecard,{...this.state.bat1, out: false});
    if(this.state.bat2.name !== "-") this.upsertBattingRow(this.state.battingScorecard,{...this.state.bat2, out: false});
    if(!this.state.completedInnings) this.state.completedInnings = {};
    this.state.completedInnings[currentTeam] = this.currentBattingScorecard();
    if(!this.state.completedBowling) this.state.completedBowling = {};
    this.state.completedBowling[currentTeam] = {...this.state.bowlerStats};
    if(!this.state.inningsDetails) this.state.inningsDetails = {};
    this.state.inningsDetails[currentTeam] = this.currentInningsDetail(currentTeam);
    [this.state.battingTeam,this.state.bowlingTeam]=[this.state.bowlingTeam,this.state.battingTeam]; this.state.inningNumber=(this.state.inningNumber||1)+1; this.state.runs=0; this.state.wkts=0; this.state.balls=0; this.state.extras=0; this.state.over=[]; this.state.overSummary=[]; this.state.commentary=[]; this.state.partnershipRuns=0; this.state.partnershipBalls=0; this.state.lastWicket="-"; this.state.striker=1; this.state.matchFinished=false; this.state.winnerText=""; this.state.resultRecorded=false; this.state.dismissedPlayers=[]; this.state.bowlerStats={}; this.state.fallOfWickets=[]; this.state.lastOverBowler=""; this.state.bat1={name:"-",r:0,b:0,f:0,s:0}; this.state.bat2={name:"-",r:0,b:0,f:0,s:0}; this.state.bowler={name:"-",balls:0,m:0,r:0,w:0}; this.state.benchPlayers=[...(this.state.teams[this.state.battingTeam]||[])]; this.state.battingScorecard=[]; this.pushHighlight(`Innings Break. Target: ${this.state.target||'-'}`,"innings"); this.refreshTeamSelectors(); this.renderBench(); await this.promptInningOpeners(); this.render(); },
  undo(){
    if(!this.state.ballHistory || !this.state.ballHistory.length){
      this.showPopup("No ball to undo","warn");
      return;
    }
    const prev = this.state.ballHistory.pop();
    const currentEvents=Array.isArray(this.state.ballEvents)?this.state.ballEvents:[];
    const keep={
      teams:this.state.teams||{},
      teamInfo:this.state.teamInfo||{},
      completedMatches:this.state.completedMatches||[],
      tournamentStats:this.state.tournamentStats||{players:{}},
      pointsTable:this.state.pointsTable||{},
      mvpLog:this.state.mvpLog||[],
      league:this.state.league||{name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]},
      offlineQueue:this.state.offlineQueue||[],
      ballEvents:currentEvents.slice(0,-1)
    };
    this.state = { ...prev, ...keep, ballHistory:this.state.ballHistory };
    this.hasLocalChanges=true;
    this.ensureTeamData();
    this.refreshTeamSelectors();
    this.renderBench();
    this.persistUndoBackup();
    this.render();
  },
  undoSnapshot(){
    const copy=JSON.parse(JSON.stringify(this.state));
    delete copy.history;
    delete copy.ballHistory;
    delete copy.completedMatches;
    delete copy.tournamentStats;
    delete copy.mvpLog;
    delete copy.league;
    delete copy.teamCatalog;
    copy.ballEvents=(copy.ballEvents||[]).slice(-12).map(ev=>({id:ev.id,ball:ev.ball,label:ev.label,text:ev.text,score:ev.score}));
    return copy;
  },
  compactUndoSnapshot(snapshot){
    if(!snapshot || typeof snapshot!=="object") return snapshot;
    const copy=JSON.parse(JSON.stringify(snapshot));
    delete copy.history;
    delete copy.ballHistory;
    delete copy.completedMatches;
    delete copy.tournamentStats;
    delete copy.mvpLog;
    delete copy.league;
    delete copy.teamCatalog;
    copy.ballEvents=(copy.ballEvents||[]).slice(-8).map(ev=>({id:ev.id,ball:ev.ball,label:ev.label,text:ev.text,score:ev.score}));
    return copy;
  },
  persistUndoBackup(){
    try{
      const payload={
        matchTitle:this.state.matchTitle||"",
        battingTeam:this.state.battingTeam||"",
        bowlingTeam:this.state.bowlingTeam||"",
        liveStarted:!!this.state.liveStarted,
        ballHistory:(this.state.ballHistory||[]).slice(-15).map(s=>this.compactUndoSnapshot(s)),
        ballEvents:(this.state.ballEvents||[]).slice(-15).map(ev=>({id:ev.id,ball:ev.ball,label:ev.label,text:ev.text,score:ev.score}))
      };
      localStorage.setItem(UNDO_BACKUP_KEY,JSON.stringify(payload));
    }catch(e){
      try{
        const fallback={
          matchTitle:this.state.matchTitle||"",
          battingTeam:this.state.battingTeam||"",
          bowlingTeam:this.state.bowlingTeam||"",
          liveStarted:!!this.state.liveStarted,
          ballHistory:(this.state.ballHistory||[]).slice(-5).map(s=>this.compactUndoSnapshot(s)),
          ballEvents:(this.state.ballEvents||[]).slice(-5).map(ev=>({id:ev.id,ball:ev.ball,label:ev.label,text:ev.text,score:ev.score}))
        };
        localStorage.setItem(UNDO_BACKUP_KEY,JSON.stringify(fallback));
      }catch(_){
        try{ localStorage.removeItem(UNDO_BACKUP_KEY); }catch(__){}
        console.warn("Undo backup skipped: browser storage quota full");
      }
    }
  },
  restoreUndoBackup(){
    try{
      const raw=localStorage.getItem(UNDO_BACKUP_KEY);
      if(!raw) return;
      const saved=JSON.parse(raw);
      const sameMatch=(saved.matchTitle||"")===(this.state.matchTitle||"") && (saved.battingTeam||"")===(this.state.battingTeam||"") && (saved.bowlingTeam||"")===(this.state.bowlingTeam||"");
      if(!sameMatch || !this.state.liveStarted) return;
      if(Array.isArray(saved.ballHistory)) this.state.ballHistory=saved.ballHistory;
      if(Array.isArray(saved.ballEvents)) this.state.ballEvents=saved.ballEvents;
    }catch(e){ console.warn("Undo restore failed",e); }
  },
  clearUndoBackup(){
    this.state.ballHistory=[];
    this.state.ballEvents=[];
    try{ localStorage.removeItem(UNDO_BACKUP_KEY); }catch(e){}
  },
  cleanupLargeUndoBackup(){
    try{
      const raw=localStorage.getItem(UNDO_BACKUP_KEY);
      if(raw && raw.length>700000) localStorage.removeItem(UNDO_BACKUP_KEY);
    }catch(e){}
  },
  saveBallHistory(){
    this.hasLocalChanges=true;
    if(!this.state.ballHistory) this.state.ballHistory = [];
    const before=this.undoSnapshot();
    const id=Date.now()+"-"+Math.random().toString(16).slice(2);
    this.state.ballHistory.push(before);
    if(this.state.ballHistory.length > 60) this.state.ballHistory.shift();
    this.persistUndoBackup();
    return {id,before};
  },
  renderRecentBalls(){
    const el=document.getElementById("recentBallsList");
    if(!el) return;
    const events=Array.isArray(this.state.ballEvents)?this.state.ballEvents:[];
    if(!events.length){ el.innerHTML='<div class="muted">No balls yet</div>'; return; }
    el.innerHTML=events.map((ev,i)=>({ev,i})).slice(-10).reverse().map(({ev,i})=>`
      <div class="ball-edit-row">
        <div><b>${this.safeText(ev.ball||"-")} - ${this.safeText(ev.label||"-")}</b><div class="muted">${this.safeText(ev.score||"")} · ${this.safeText(ev.text||"")}</div></div>
        <button class="btn secondary" onclick="app.restoreBeforeBall(${i})">Edit</button>
      </div>`).join("");
  },
  restoreBeforeBall(index){
    const events=Array.isArray(this.state.ballEvents)?this.state.ballEvents:[];
    const ev=events[index];
    if(!ev?.before) return this.showPopup("Ball backup missing","warn");
    if(!confirm("Restore score to before this ball? Then enter the corrected ball again.")) return;
    const keep={
      teams:this.state.teams||{},
      teamInfo:this.state.teamInfo||{},
      completedMatches:this.state.completedMatches||[],
      tournamentStats:this.state.tournamentStats||{players:{}},
      pointsTable:this.state.pointsTable||{},
      mvpLog:this.state.mvpLog||[],
      league:this.state.league||{name:"",teams:[],overs:20,format:"single",playoffs:true,schedule:[]},
      offlineQueue:this.state.offlineQueue||[]
    };
    this.state={...ev.before,...keep,ballEvents:events.slice(0,index),ballHistory:(this.state.ballHistory||[]).slice(0,index)};
    this.hasLocalChanges=true;
    this.ensureTeamData();
    this.refreshTeamSelectors();
    this.renderBench();
    this.persistUndoBackup();
    this.render();
  },
  saveHistory(){ this.hasLocalChanges=true; this.state.history.push(JSON.parse(JSON.stringify(this.state))); if(this.state.history.length>60) this.state.history.shift(); },
  clearChecks(){ ["wide","noball","byes","legbyes","wicket"].forEach(id=>{ const el=document.getElementById(id); if(el) el.checked=false; }); this.setWicketType(""); },
  overText(b){ b=Number(b||0); return Math.floor(b/6)+"."+(b%6); },
  inningText(n){ if(n===1)return"1st"; if(n===2)return"2nd"; if(n===3)return"3rd"; return n+"th"; },
  updateResultPanel(){
    const panel=document.getElementById("resultPanel");
    if(!panel) return;
    const first=`${this.state.firstInningsScore??"-"}/${this.state.firstInningsWkts??"-"}`;
    const second=`${this.state.runs||0}/${this.state.wkts||0} (${this.overText(this.state.balls||0)})`;
    panel.classList.toggle("show",!!this.state.matchFinished);
    document.getElementById("resultWinner").innerText=this.state.winnerText||"-";
    document.getElementById("resultScoreline").innerText=`${this.state.matchTitle||"-"} | 1st: ${first} | 2nd: ${second}`;
    const superBtn=document.getElementById("superOverBtn");
    if(superBtn) superBtn.style.display=/tied/i.test(this.state.winnerText||"")?"":"none";
    const overlay=document.getElementById("resultOverlay");
    if(overlay) overlay.classList.toggle("show",!!this.state.matchFinished && !this.resultOverlayClosed);
    document.getElementById("resultOverlayWinner").innerText=this.state.winnerText||"-";
    document.getElementById("resultOverlayFirst").innerText=first;
    document.getElementById("resultOverlaySecond").innerText=second;
    document.getElementById("resultOverlayLine").innerText=this.state.matchTitle||"-";
    const superOverlayBtn=document.getElementById("superOverOverlayBtn");
    if(superOverlayBtn) superOverlayBtn.style.display=/tied/i.test(this.state.winnerText||"")?"":"none";
  },
  closeResultOverlay(){ this.resultOverlayClosed=true; const overlay=document.getElementById("resultOverlay"); if(overlay) overlay.classList.remove("show"); },
  syncUI(renderNow=true){ this.hasLocalChanges=true; this.state.battingTeam=document.getElementById("battingTeam").value; this.state.bowlingTeam=document.getElementById("bowlingTeam").value; const tossA=document.getElementById("tossLabelA"); const tossB=document.getElementById("tossLabelB"); if(tossA) tossA.innerText=this.state.battingTeam; if(tossB) tossB.innerText=this.state.bowlingTeam; this.state.matchTitle=`${this.state.battingTeam} vs ${this.state.bowlingTeam}`; this.state.tossWinner=document.getElementById("tossWinnerB").checked?"B":"A"; this.state.tossDecision=document.getElementById("tossDecision").value; const winnerTeam=this.state.tossWinner==="A"?this.state.battingTeam:this.state.bowlingTeam; const action=this.state.tossDecision==="bat"?"batting":"bowling"; this.state.tossText=`${winnerTeam} chose ${action}`; document.getElementById("matchTitle").value=this.state.matchTitle; this.state.totalOvers=Math.max(1,Number(document.getElementById("totalOvers").value||20)); this.state.followLink=(document.getElementById("followLinkInput")?.value||"").trim(); this.state.benchPlayers=[...(this.state.teams[this.state.battingTeam]||this.state.benchPlayers)]; this.renderBench(); this.updateMatchPreview(); if(renderNow) this.render(); },
  render(saveNow=true){ this.ensureTeamData(); document.getElementById("runs").innerText=this.state.runs; document.getElementById("wkts").innerText=this.state.wkts; document.getElementById("overs").innerText=this.overText(this.state.balls); document.getElementById("topTitle").innerText=this.state.matchTitle; document.getElementById("inningTitle").innerText=`${this.state.battingTeam}, ${this.inningText(this.state.inningNumber||1)} inning`; document.getElementById("inningsNo").innerText=this.state.inningNumber||1; const crr=this.state.balls>0?(this.state.runs/(this.state.balls/6)).toFixed(2):"0.00"; document.getElementById("crr").innerText=crr; let need="-",rrr="-"; if((this.state.inningNumber||1)>1&&this.state.target){ const maxBalls=(Number(this.state.totalOvers)||20)*6; const remRuns=Math.max(this.state.target-this.state.runs,0), remBalls=Math.max(maxBalls-this.state.balls,0); need=String(remRuns); rrr=remBalls>0?((remRuns*6)/remBalls).toFixed(2):"0.00"; } document.getElementById("firstInningsValue").innerText=this.state.firstInningsScore===null?"-":this.state.firstInningsScore; document.getElementById("targetValue").innerText=this.state.target||"-"; document.getElementById("needValue").innerText=need; document.getElementById("rrrValue").innerText=rrr; document.getElementById("partnership").innerText=`${this.state.partnershipRuns||0} (${this.state.partnershipBalls||0})`; document.getElementById("lastWicket").innerText=this.state.lastWicket||"-"; const bats=[{obj:this.state.bat1,p:"1"},{obj:this.state.bat2,p:"2"}]; bats.forEach((x,i)=>{const b=x.obj;document.getElementById(`bat${x.p}Name`).innerText=b.name;document.getElementById(`bat${x.p}r`).innerText=b.r;document.getElementById(`bat${x.p}b`).innerText=b.b;document.getElementById(`bat${x.p}f`).innerText=b.f;document.getElementById(`bat${x.p}s`).innerText=b.s;document.getElementById(`bat${x.p}sr`).innerText=b.b>0?((b.r/b.b)*100).toFixed(2):"0.00";document.getElementById(`strike${x.p}`).innerText=(i+1)===this.state.striker?"*":"";}); document.getElementById("bowlerName").innerText=this.state.bowler.name; document.getElementById("bowlO").innerText=this.overText(this.state.bowler.balls); document.getElementById("bowlR").innerText=this.state.bowler.r; document.getElementById("bowlW").innerText=this.state.bowler.w; document.getElementById("bowlER").innerText=this.state.bowler.balls>0?(this.state.bowler.r/(this.state.bowler.balls/6)).toFixed(2):"0.00"; document.getElementById("thisOver").innerHTML=(this.state.over||[]).length?this.state.over.map(x=>`<span class='chip'>${x}</span>`).join(""):'<span class="muted">No balls yet</span>'; document.getElementById("overSummaryList").innerHTML=(this.state.overSummary||[]).length?this.state.overSummary.map((o,idx)=>`<div class='item' onclick='app.editOverSummary(${idx})'>Over ${o.overNo}: ${o.timeline.join(" ")}</div>`).join(""):'<div class="muted">No overs completed yet</div>'; const bs=this.state.bowlerStats||{}; const bsKeys=Object.keys(bs); document.getElementById("bowlerStatsBody").innerHTML=bsKeys.length?bsKeys.map(name=>{ const s=bs[name]||{balls:0,runs:0,wkts:0}; const ov=this.overText(s.balls||0); const er=(s.balls||0)>0?((s.runs||0)/((s.balls||0)/6)).toFixed(2):"0.00"; return `<tr><td><b>${name}</b></td><td>${ov}</td><td>${s.runs||0}</td><td>${s.wkts||0}</td><td>${er}</td></tr>`; }).join(""):'<tr><td colspan="5">No bowler data</td></tr>'; const fow=this.state.fallOfWickets||[]; document.getElementById("fowList").innerHTML=fow.length?fow.map((x,i)=>`<div class='item'>${i+1}. ${x}</div>`).join(""):'<div class="muted">No wickets yet</div>'; const pts=this.state.pointsTable||{}; const ptKeys=Object.keys(pts); document.getElementById("pointsTableBody").innerHTML=ptKeys.length?ptKeys.map(team=>{ const s=pts[team]||{P:0,W:0,L:0,T:0,Pts:0}; return `<tr><td><b>${team}</b></td><td>${s.P||0}</td><td>${s.W||0}</td><td>${s.L||0}</td><td>${s.T||0}</td><td>${s.Pts||0}</td><td>${this.nrr(team)}</td></tr>`; }).join(""):'<tr><td colspan="7">No points data</td></tr>'; this.renderRecentBalls(); this.updateShareQr(); this.updateResultPanel(); const mvp=(this.state.mvpLog&&this.state.mvpLog[0])?this.state.mvpLog[0].mvp:"-"; document.getElementById("mvpMeta").innerText=`MVP: ${mvp}`; document.getElementById("tourneyMeta").innerText=`Completed Matches: ${(this.state.completedMatches||[]).length} | Archived: ${this.state.archived?"Yes":"No"}`; const switchBtn=document.getElementById("switchInningsBtn"); if(switchBtn) switchBtn.style.display = (this.state.inningNumber||1) > 1 ? "none" : ""; this.refreshTeamSelectors(); this.refreshPlayerDeskSelectors(); const benchInputEl=document.getElementById("benchInput"); if(benchInputEl) benchInputEl.value=(this.state.benchPlayers||[]).join(", "); if(saveNow) this.scheduleLiveSave(); },
  scheduleLiveSave(){
    clearTimeout(this._liveSaveTimer);
    this.setStatus("Realtime DB: saving...","");
    this._liveSaveTimer=setTimeout(()=>this.saveToFirebase(false),120);
  },
  async flushOfflineQueue(){ localStorage.removeItem("cricket_offline_queue"); },
  async saveToFirebase(force=false){
    if(!force && this._saveInFlight){
      this._saveAgain=true;
      return true;
    }
    this._saveInFlight=true;
    try{
      this.updateLiveControls();
      this.updateMatchPreview();
      if(!this.isHydrated && !force) return false;
      if(!this.hasLocalChanges && !force) return true;
      await this.flushOfflineQueue();
      const livePayload=buildLivePayload(this.state,{matchId:MATCH_ID,updatedBy:this.sessionId});
      const storePayload=buildStorePayload(this.state,{matchId:MATCH_ID,updatedBy:this.sessionId});
      this.persistMatchBackup(force);
      // Fast scoring changes go to Realtime Database. This keeps user panels low-latency and low-cost.
      await writeLiveMatch(MATCH_ID,livePayload);
      // Firestore is reserved for permanent structured data. Forced saves happen on setup,
      // teams/league edits, admin settings, and match completion/history writes.
      if(force) await saveMatchStore(MATCH_ID,storePayload);
      this.lastSync=Date.now();
      this.hasLocalChanges=false;
      this.setStatus(force?"Firestore + Realtime: saved":"Realtime DB: live saved","success");
      setTimeout(()=>this.setStatus("Firebase hybrid: ready",""),1200);
      return true;
    }catch(e){
      this.setStatus("Firebase Error","error");
      console.error(e);
      return false;
    }finally{
      this._saveInFlight=false;
      if(!force && this._saveAgain){
        this._saveAgain=false;
        this.scheduleLiveSave();
      }
    }
  },
  setStatus(m,t=""){const s=document.getElementById("saveStatus"); s.innerText=m; s.className="save-status "+t;},
  showPopup(message,type=""){ const p=document.getElementById("popup"); if(!p) return; p.className=`popup ${type}`; p.innerText=message; p.classList.add("show"); clearTimeout(this._popupTimer); this._popupTimer=setTimeout(()=>p.classList.remove("show"),2200); },
  showExtras(){ this.showPopup("Total Extras: "+this.state.extras); },
  showHistory(){ this.showPopup("Undo History: "+this.state.history.length+" moves"); }
};
window.app.init();


