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
let pdfFileName = "match-scorecard.pdf";

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

function manOfMatch(match){
  const stored = match?.mvp || match?.manOfMatch || match?.playerOfMatch;
  if(stored) return { name: String(stored), note: "official pick" };
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
  const details = match?.inningsDetails && typeof match.inningsDetails === "object" ? Object.values(match.inningsDetails) : [];
  if(details.length){
    details.forEach(d => {
      (Array.isArray(d?.battingScorecard) ? d.battingScorecard : []).forEach(addBat);
      addBowl(d?.bowlerStats);
    });
  } else {
    Object.values(match?.completedInnings || {}).forEach(rows => (Array.isArray(rows) ? rows : []).forEach(addBat));
    if(Array.isArray(match?.battingScorecard)) match.battingScorecard.forEach(addBat);
    Object.values(match?.completedBowling || {}).forEach(addBowl);
    addBowl(match?.bowlerStats);
  }
  const best = Object.values(players).sort((a,b) => b.score - a.score || b.runs - a.runs || b.wkts - a.wkts)[0];
  if(!best) return null;
  const parts = [];
  if(best.runs) parts.push(`${best.runs} runs`);
  if(best.wkts) parts.push(`${best.wkts} wkts`);
  return { name: best.name, note: parts.join(", ") || "best impact" };
}

window.downloadScorecardPdf = async function(){
  const btn = document.getElementById("downloadPdfBtn");
  const content = document.getElementById("content");
  const jsPDF = window.jspdf?.jsPDF;
  if(!content || !window.html2canvas || !jsPDF){
    window.print();
    return;
  }
  const oldText = btn ? btn.innerText : "";
  try{
    if(btn){
      btn.disabled = true;
      btn.innerText = "Preparing...";
    }
    document.body.classList.add("downloading-pdf");
    await new Promise(resolve => requestAnimationFrame(resolve));
    const canvas = await window.html2canvas(content, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: content.scrollWidth
    });
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 8;
    const maxWidth = pageWidth - (margin * 2);
    const maxHeight = pageHeight - (margin * 2);
    const widthRatio = maxWidth / canvas.width;
    const heightRatio = maxHeight / canvas.height;
    const ratio = Math.min(widthRatio, heightRatio);
    const imgWidth = canvas.width * ratio;
    const imgHeight = canvas.height * ratio;
    const imgData = canvas.toDataURL("image/jpeg", 0.98);
    const x = (pageWidth - imgWidth) / 2;
    const y = margin;
    pdf.addImage(imgData, "JPEG", x, y, imgWidth, imgHeight);
    pdf.save(pdfFileName);
  }catch(err){
    console.error(err);
    window.print();
  }finally{
    document.body.classList.remove("downloading-pdf");
    if(btn){
      btn.disabled = false;
      btn.innerText = oldText || "Download PDF";
    }
  }
};

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
  const mom = manOfMatch(match);
  pdfFileName = `${fileSafe(reportTitle)}-scorecard.pdf`;
  document.title = pdfFileName.replace(/\.pdf$/i, "");
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
    ${mom ? `<div class="mom-box"><span>Man of the Match</span><b>${safe(mom.name)}</b><small>${safe(mom.note)}</small></div>` : ""}
    <h2>Match Info</h2>
    <table class="match-info-table">
      <thead><tr><th>Winner</th><th>League</th><th>Stage</th><th>Venue</th><th>Toss</th><th>Target</th></tr></thead>
      <tbody><tr>
        <td>${safe(match.winnerText || "-")}</td>
        <td>${safe(match.leagueName || "-")}</td>
        <td>${safe(match.leagueStage || match.leagueRound || "-")}</td>
        <td>${safe(match.venue || "-")}</td>
        <td>${safe(match.tossText || "-")}</td>
        <td>${safe(match.target || "-")}</td>
      </tr></tbody>
    </table>
    ${inningsSection(firstTeam, details[firstTeam], match.completedInnings?.[firstTeam], match.completedBowling?.[firstTeam])}
    <hr class="innings-separator">
    <div class="innings-label">Second Team Score</div>
    ${inningsSection(secondTeam, details[secondTeam], match.completedInnings?.[secondTeam], match.completedBowling?.[secondTeam])}
  `;
}

render().catch(err => {
  document.getElementById("content").innerHTML = `Unable to load scorecard: ${safe(err.message)}`;
});


