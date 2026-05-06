import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const db = getFirestore(initializeApp(firebaseConfig));
const params = new URLSearchParams(location.search);
const MATCH_ID = (params.get("match") || "liveMatch1").trim();
const INDEX = Number(params.get("index") || 0);
const safe = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
const fileSafe = (v) => String(v || "match-scorecard").replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const overText = (balls) => `${Math.floor(Number(balls||0)/6)}.${Number(balls||0)%6}`;
const sr = (p) => p && p.b ? ((Number(p.r||0)/Number(p.b||0))*100).toFixed(2) : "0.00";

function battingTable(rows){
  return `<table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th><th>Status</th></tr></thead><tbody>${
    rows && rows.length ? rows.map(p=>`<tr><td><b>${safe(p.name||"-")}</b></td><td>${Number(p.r||0)}</td><td>${Number(p.b||0)}</td><td>${Number(p.f||0)}</td><td>${Number(p.s||0)}</td><td>${sr(p)}</td><td>${p.retired?"Retired":(p.out?"Out":"Not out")}</td></tr>`).join("") : `<tr><td colspan="7">No batting data</td></tr>`
  }</tbody></table>`;
}

function bowlingTable(stats){
  const entries = stats ? Object.entries(stats) : [];
  return `<table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>ER</th></tr></thead><tbody>${
    entries.length ? entries.map(([name,s])=>`<tr><td><b>${safe(name)}</b></td><td>${overText(s.balls||0)}</td><td>${Number(s.runs||0)}</td><td>${Number(s.wkts||0)}</td><td>${s.balls?((Number(s.runs||0)/(Number(s.balls||0)/6)).toFixed(2)):"0.00"}</td></tr>`).join("") : `<tr><td colspan="5">No bowling data</td></tr>`
  }</tbody></table>`;
}

function inningsSection(team, detail, fallbackBatting, fallbackBowling){
  const score = detail ? `${detail.runs}/${detail.wkts} (${detail.overs || overText(detail.balls)})` : "-";
  const batting = detail?.battingScorecard || fallbackBatting || [];
  const bowling = detail?.bowlerStats || fallbackBowling || {};
  const fow = detail?.fallOfWickets || [];
  return `<h2>${safe(team)} - ${safe(score)}</h2>
    ${battingTable(batting)}
    <div class="grid">
      <div><h2>Bowling</h2>${bowlingTable(bowling)}</div>
      <div><h2>Fall of Wickets</h2><div class="commentary">${fow.length ? fow.map((x,i)=>`${i+1}. ${safe(x)}`).join("<br>") : "No wickets"}</div></div>
    </div>`;
}

async function render(){
  const snap = await getDoc(doc(db, "matches", MATCH_ID));
  const data = snap.exists() ? snap.data() : {};
  const match = Array.isArray(data.completedMatches) ? data.completedMatches[INDEX] : null;
  if(!match){
    document.getElementById("content").innerHTML = "Match not found.";
    return;
  }
  const details = match.inningsDetails || {};
  const detailTeams = Object.keys(details);
  const titleTeams = match.title && match.title.includes(" vs ") ? match.title.split(" vs ").map(x => x.replace(" - Super Over", "")) : [];
  const firstTeam = detailTeams[0] || titleTeams[0] || match.bowlingTeam || "Team 1";
  const secondTeam = detailTeams[1] || titleTeams.find(t => t !== firstTeam) || match.battingTeam || "Team 2";
  const reportTitle = [match.leagueName, match.leagueStage || (match.leagueMatchNo ? `Match ${match.leagueMatchNo}` : ""), match.title || "Match Scorecard"].filter(Boolean).join(" - ");
  document.title = `${fileSafe(reportTitle)}-scorecard`;
  document.getElementById("content").innerHTML = `
    <div class="top">
      <div>
        <h1>${safe(reportTitle)}</h1>
        <div class="muted">Match ID: ${safe(MATCH_ID)} | ${match.playedAt ? new Date(match.playedAt).toLocaleString() : ""}</div>
        <div class="muted">${match.venue ? `Venue: ${safe(match.venue)} | ` : ""}${match.scheduledAt ? `Scheduled: ${safe(match.scheduledAt)} | ` : ""}${match.leagueMatchNo ? `Match No: ${safe(match.leagueMatchNo)}` : ""}</div>
        <div class="result">${safe(match.winnerText || "Result pending")}</div>
      </div>
      <div class="muted">${safe(match.leagueName || "Generated scorecard")}</div>
    </div>
    <div class="scoreline">
      <div class="scorebox"><div class="muted">${safe(firstTeam)}</div><b>${safe(match.firstInnings || "-")}</b></div>
      <div class="scorebox"><div class="muted">${safe(secondTeam)}</div><b>${safe(match.secondInnings || "-")}</b></div>
    </div>
    <h2>Match Info</h2>
    <table><tbody>
      <tr><th>Winner</th><td>${safe(match.winnerText || "-")}</td></tr>
      <tr><th>League</th><td>${safe(match.leagueName || "-")}</td></tr>
      <tr><th>Stage</th><td>${safe(match.leagueStage || match.leagueRound || "-")}</td></tr>
      <tr><th>Venue</th><td>${safe(match.venue || "-")}</td></tr>
      <tr><th>Toss</th><td>${safe(match.tossText || "-")}</td></tr>
      <tr><th>Target</th><td>${safe(match.target || "-")}</td></tr>
    </tbody></table>
    ${inningsSection(firstTeam, details[firstTeam], match.completedInnings?.[firstTeam], match.completedBowling?.[firstTeam])}
    <hr class="innings-separator">
    <div class="innings-label">Second Team Score</div>
    ${inningsSection(secondTeam, details[secondTeam], match.completedInnings?.[secondTeam], match.completedBowling?.[secondTeam])}
  `;
}

render().catch(err => {
  document.getElementById("content").innerHTML = `Unable to load scorecard: ${safe(err.message)}`;
});


