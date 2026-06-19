const cfg = window.QUINIELA_CONFIG || {};
const sb = window.quinielaSupabase || null;
let matches = [];
let teams = [];
let state = { participants: [], predictions: {}, results: {} };
let currentParticipant = '';

const $ = id => document.getElementById(id);
const qsa = s => [...document.querySelectorAll(s)];
const key = (pid, mid) => `${pid}_${mid}`;
const val = x => x === '' || x == null ? null : Number(x);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const flagHtml = t => {
  if(!t) return '<span class="flag-emoji">⚪</span>';
  if(t.flagUrl) return `<img class="flag-img" src="${esc(t.flagUrl)}" alt="${esc(t.code || t.name || 'flag')}">`;
  return `<span class="flag-emoji">${t.flag || '⚪'}</span>`;
};
const teamText = t => `${t?.flag || ''} ${t?.name || 'Por definir'}`.trim();

const hasScore = r => r && r.h != null && r.a != null && !Number.isNaN(r.h) && !Number.isNaN(r.a);
const resultFor = m => state.results[m.id];
const groupLetters = () => [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
const groupMatches = g => matches.filter(m => Number(m.stageId) === 1 && m.group === g).sort((a,b)=>a.matchNumber-b.matchNumber);
const groupTeams = g => teams.filter(t => t.group === g).sort((a,b)=>a.name.localeCompare(b.name));

function store(){ localStorage.setItem('quiniela2026_v5', JSON.stringify(state)); }
function loadLocal(){ state = JSON.parse(localStorage.getItem('quiniela2026_v5') || JSON.stringify(state)); }

function stageES(s){
  return ({'Group Stage':'Fase de grupos','Round of 32':'Dieciseisavos','Round of 16':'Octavos de final','Quarterfinals':'Cuartos de final','Semifinals':'Semifinales','Third Place Playoff':'Tercer lugar','Final':'Final'})[s] || s;
}

async function init(){
  matches = await fetch('data/matches.json').then(r=>r.json());
  teams = await fetch('data/teams.json').then(r=>r.json());
  matches.sort((a,b)=>Number(a.matchNumber)-Number(b.matchNumber));

  if(sb) await loadRemote(); else loadLocal();
  currentParticipant = state.participants[0]?.id || '';
  bindNav();
  renderAll();
}

async function loadRemote(){
  const [p, pr, re] = await Promise.all([
    sb.from('participants').select('*').order('created_at'),
    sb.from('predictions').select('*'),
    sb.from('results').select('*')
  ]);
  state.participants = (p.data || []).map(x=>({id:x.id, name:x.name}));
  state.predictions = {};
  (pr.data || []).forEach(x => state.predictions[key(x.participant_id, x.match_id)] = {h:x.home_goals, a:x.away_goals});
  state.results = {};
  (re.data || []).forEach(x => state.results[x.match_id] = {h:x.home_goals, a:x.away_goals});
}

function bindNav(){
  qsa('.nav button').forEach(btn => btn.onclick = () => {
    qsa('.nav button,.view').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.view).classList.add('active');
    renderAll();
  });
}

function baseStanding(team){
  return { code:team.code, name:team.name, flag:team.flag, flagUrl:team.flagUrl || '', group:team.group, pj:0, g:0, e:0, p:0, gf:0, gc:0, dg:0, pts:0, h2hPts:0, h2hDg:0, h2hGf:0 };
}
function applyResult(row, gf, gc){
  row.pj++; row.gf += gf; row.gc += gc; row.dg = row.gf - row.gc;
  if(gf > gc){ row.g++; row.pts += 3; }
  else if(gf === gc){ row.e++; row.pts += 1; }
  else row.p++;
}
function computeHeadToHead(block, playedMatches){
  block.forEach(r => { r.h2hPts = 0; r.h2hDg = 0; r.h2hGf = 0; });
  const codes = new Set(block.map(r=>r.code));
  playedMatches.forEach(m => {
    const r = resultFor(m);
    if(!hasScore(r) || !codes.has(m.home.code) || !codes.has(m.away.code)) return;
    const home = block.find(x=>x.code === m.home.code);
    const away = block.find(x=>x.code === m.away.code);
    home.h2hGf += r.h; home.h2hDg += r.h - r.a;
    away.h2hGf += r.a; away.h2hDg += r.a - r.h;
    if(r.h > r.a) home.h2hPts += 3;
    else if(r.h < r.a) away.h2hPts += 3;
    else { home.h2hPts++; away.h2hPts++; }
  });
}
function sortStandings(rows, playedMatches){
  rows.sort((a,b)=> b.pts-a.pts || b.dg-a.dg || b.gf-a.gf || a.name.localeCompare(b.name));
  const out = [];
  for(let i=0;i<rows.length;){
    let j=i+1;
    while(j<rows.length && rows[j].pts===rows[i].pts && rows[j].dg===rows[i].dg && rows[j].gf===rows[i].gf) j++;
    const block = rows.slice(i,j);
    if(block.length > 1){
      computeHeadToHead(block, playedMatches);
      block.sort((a,b)=> b.h2hPts-a.h2hPts || b.h2hDg-a.h2hDg || b.h2hGf-a.h2hGf || a.name.localeCompare(b.name));
    }
    out.push(...block); i=j;
  }
  return out;
}
function standingsForGroup(g, customResults=null){
  const oldResults = state.results;
  if(customResults) state.results = customResults;
  const rows = Object.fromEntries(groupTeams(g).map(t => [t.code, baseStanding(t)]));
  const gm = groupMatches(g);
  gm.forEach(m => {
    const r = resultFor(m);
    if(!hasScore(r) || !rows[m.home.code] || !rows[m.away.code]) return;
    applyResult(rows[m.home.code], r.h, r.a);
    applyResult(rows[m.away.code], r.a, r.h);
  });
  const sorted = sortStandings(Object.values(rows), gm);
  if(customResults) state.results = oldResults;
  return sorted;
}
function thirdPlaceRanking(){
  return groupLetters().map(g => ({...standingsForGroup(g)[2], sourceGroup:g}))
    .sort((a,b)=> b.pts-a.pts || b.dg-a.dg || b.gf-a.gf || a.name.localeCompare(b.name));
}
function qualifierMap(){
  const map = {};
  groupLetters().forEach(g => {
    const rows = standingsForGroup(g);
    rows.forEach((r,i)=>{ map[`${g}_${r.code}`] = i < 2 ? 'direct' : 'out'; });
  });
  thirdPlaceRanking().slice(0,8).forEach(r => map[`${r.sourceGroup}_${r.code}`] = 'third');
  return map;
}

function cloneTeam(t, slot=''){
  if(!t) return {name:'Por definir', code:'TBD', flag:'⚪', group:'', slot};
  return {name:t.name, code:t.code, flag:t.flag || '', flagUrl:t.flagUrl || '', group:t.group || t.sourceGroup || '', slot};
}
function groupPositionMap(customResults=null){
  const out = {};
  const thirds = [];
  groupLetters().forEach(g => {
    const rows = standingsForGroup(g, customResults);
    if(rows[0]) out[`1${g}`] = cloneTeam(rows[0], `1${g}`);
    if(rows[1]) out[`2${g}`] = cloneTeam(rows[1], `2${g}`);
    if(rows[2]) thirds.push({...cloneTeam(rows[2], `3${g}`), sourceGroup:g, pts:rows[2].pts, dg:rows[2].dg, gf:rows[2].gf});
  });
  thirds.sort((a,b)=> b.pts-a.pts || b.dg-a.dg || b.gf-a.gf || a.name.localeCompare(b.name));
  thirds.slice(0,8).forEach(t => out[`3${t.sourceGroup}`] = cloneTeam(t, `3${t.sourceGroup}`));
  return {positions:out, bestThirds:thirds};
}
function parseSlotCandidates(token){
  const clean = String(token || '').trim().replace(/\s+/g,'');
  const m = clean.match(/^([123])([A-L]+)$/);
  if(!m) return [];
  const pos = m[1];
  return [...m[2]].map(g => `${pos}${g}`);
}
function round32Assignments(customResults=null){
  const {positions} = groupPositionMap(customResults);
  const usedThirds = new Set();
  const slots = {};
  const r32 = matches.filter(m=>Number(m.stageId)===2).sort((a,b)=>a.matchNumber-b.matchNumber);
  r32.forEach(m => {
    const parts = String(m.label || '').split(/\s+vs\s+/i);
    ['home','away'].forEach((side, idx) => {
      const raw = (parts[idx] || '').trim();
      let team = null;
      if(/^3[A-L]+$/.test(raw.replace(/\s+/g,''))){
        for(const cand of parseSlotCandidates(raw)){
          if(positions[cand] && !usedThirds.has(cand)) { team = positions[cand]; usedThirds.add(cand); break; }
        }
        if(!team) team = cloneTeam(null, raw);
      } else {
        team = positions[raw] ? cloneTeam(positions[raw], raw) : cloneTeam(null, raw);
      }
      slots[`${m.id}_${side}`] = team;
    });
  });
  return slots;
}
function winnerOfMatch(matchId, customResults=null, memo={}){
  if(memo[matchId]) return memo[matchId];
  const m = matches.find(x=>Number(x.id)===Number(matchId));
  if(!m) return cloneTeam(null, `W${matchId}`);
  const teams = resolvedTeamsForMatch(m, customResults, memo);
  const res = (customResults || state.results)[m.id];
  if(hasScore(res)){
    if(res.h > res.a) return memo[matchId] = {...teams.home, slot:`W${m.matchNumber}`};
    if(res.a > res.h) return memo[matchId] = {...teams.away, slot:`W${m.matchNumber}`};
    return memo[matchId] = cloneTeam(null, `W${m.matchNumber}`);
  }
  return memo[matchId] = cloneTeam(null, `W${m.matchNumber}`);
}
function loserOfMatch(matchId, customResults=null, memo={}){
  const m = matches.find(x=>Number(x.id)===Number(matchId));
  if(!m) return cloneTeam(null, `RU${matchId}`);
  const teams = resolvedTeamsForMatch(m, customResults, memo);
  const res = (customResults || state.results)[m.id];
  if(hasScore(res)){
    if(res.h > res.a) return {...teams.away, slot:`RU${m.matchNumber}`};
    if(res.a > res.h) return {...teams.home, slot:`RU${m.matchNumber}`};
  }
  return cloneTeam(null, `RU${m.matchNumber}`);
}
function resolvedTeamsForMatch(m, customResults=null, memo={}){
  if(Number(m.stageId) === 1) return {home: cloneTeam(m.home), away: cloneTeam(m.away)};
  if(Number(m.stageId) === 2){
    const map = round32Assignments(customResults);
    return {home: map[`${m.id}_home`] || cloneTeam(null), away: map[`${m.id}_away`] || cloneTeam(null)};
  }
  const parts = String(m.label || '').split(/\s+vs\s+/i).map(x=>x.trim());
  function resolveToken(t){
    const w = t.match(/^W(\d+)$/i);
    const ru = t.match(/^RU(\d+)$/i);
    if(w) return winnerOfMatch(Number(w[1]), customResults, memo);
    if(ru) return loserOfMatch(Number(ru[1]), customResults, memo);
    return cloneTeam(null, t);
  }
  return {home: resolveToken(parts[0] || 'TBD'), away: resolveToken(parts[1] || 'TBD')};
}
function knockoutRounds(customResults=null){
  const stageOrder = [2,3,4,5,6,7];
  return stageOrder.map(stageId => ({
    stageId,
    title: stageES(matches.find(m=>Number(m.stageId)===stageId)?.stage || ''),
    games: matches.filter(m=>Number(m.stageId)===stageId).sort((a,b)=>a.matchNumber-b.matchNumber)
  })).filter(r=>r.games.length);
}
function renderTeamPill(t){
  const pending = !t || t.code === 'TBD';
  return `<div class="bracket-team ${pending?'pending':''}">${flagHtml(t)}<b>${esc(t?.name || 'Por definir')}</b><small>${esc(t?.slot || t?.code || 'TBD')}</small></div>`;
}
function renderBracket(customResults=null){
  const results = customResults || state.results;
  return `<div class="bracket-board">${knockoutRounds(customResults).map(round => `
    <section class="bracket-round stage-${round.stageId}">
      <h3>${round.title}</h3>
      ${round.games.map(m=>{
        const teams = resolvedTeamsForMatch(m, customResults);
        const r = results[m.id];
        return `<article class="bracket-match">
          <div class="bracket-meta"><span>#${m.matchNumber}</span><small>${m.dateCR} · ${m.timeCR} CR</small></div>
          ${renderTeamPill(teams.home)}
          <div class="bracket-score">${hasScore(r) ? `${r.h} - ${r.a}` : 'vs'}</div>
          ${renderTeamPill(teams.away)}
          <div class="bracket-venue">${esc(m.venue)} · ${esc(m.city)}</div>
        </article>`;
      }).join('')}
    </section>`).join('')}</div>`;
}

function scoreBreakdown(pred,res){
  if(!hasScore(pred) || !hasScore(res)) return {winner:0,home:0,away:0,exact:0,total:0};
  const winner = Math.sign(pred.h-pred.a) === Math.sign(res.h-res.a) ? 1 : 0;
  const home = pred.h === res.h ? 1 : 0;
  const away = pred.a === res.a ? 1 : 0;
  const exact = pred.h === res.h && pred.a === res.a ? 1 : 0;
  return {winner, home, away, exact, total:winner+home+away+exact};
}
function rankingRows(){
  return state.participants.map(p => {
    let pts=0, exact=0, winner=0, predicted=0;
    matches.forEach(m => {
      const pred = state.predictions[key(p.id,m.id)];
      const res = state.results[m.id];
      if(hasScore(pred)) predicted++;
      const s = scoreBreakdown(pred,res);
      pts += s.total; exact += s.exact; winner += s.winner;
    });
    const finished = Object.values(state.results).filter(hasScore).length;
    const accuracy = finished ? Math.round((winner / finished) * 100) : 0;
    return {id:p.id, name:p.name, pts, exact, winner, predicted, accuracy};
  }).sort((a,b)=> b.pts-a.pts || b.exact-a.exact || b.winner-a.winner || a.name.localeCompare(b.name));
}

function stat(label,value,sub=''){
  return `<div class="stat-card broadcast-stat"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>`:''}</div>`;
}
function renderHero(){
  const finished = Object.values(state.results).filter(hasScore).length;
  const leader = rankingRows()[0];
  $('heroStats').innerHTML = [
    stat('Participantes', state.participants.length),
    stat('Jugados', `${finished}/${matches.length}`),
    stat('Líder', leader ? esc(leader.name) : '—')
  ].join('');
}

function finishedMatches(){ return matches.filter(m => hasScore(state.results[m.id])); }
function predictionCompleteness(){
  const total = matches.length || 1;
  return state.participants.map(p => ({...p, done: matches.filter(m => hasScore(state.predictions[key(p.id,m.id)])).length, total}));
}
function statCard(label,value,sub='',tone=''){
  return `<div class="stat-card ${tone}"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>`:''}</div>`;
}
function barRow(label,value,max,sub=''){
  const pct = max ? Math.round((value/max)*100) : 0;
  return `<div class="bar-row"><div class="bar-row__top"><b>${label}</b><span>${value}${sub}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
}
function dashboardMetrics(){
  const finished = finishedMatches();
  const rows = rankingRows();
  const leader = rows[0];
  const totalPoints = rows.reduce((s,r)=>s+r.pts,0);
  const totalExact = rows.reduce((s,r)=>s+r.exact,0);
  const totalWinner = rows.reduce((s,r)=>s+r.winner,0);
  const possibleWinner = Math.max(1, finished.length * Math.max(1,state.participants.length));
  return {finished, rows, leader, totalPoints, totalExact, totalWinner, avg: rows.length ? (totalPoints/rows.length).toFixed(1) : '0.0', winnerPct: Math.round(totalWinner/possibleWinner*100)};
}
function renderAdvancedAnalytics(){
  const m = dashboardMetrics();
  const maxPts = Math.max(1, ...m.rows.map(r=>r.pts));
  const maxExact = Math.max(1, ...m.rows.map(r=>r.exact));
  const completion = predictionCompleteness();
  return `<div class="analytics-grid">
    <div class="card analytics-card"><h3>Distribución de puntos</h3>${m.rows.slice(0,10).map(r=>barRow(esc(r.name), r.pts, maxPts, ' pts')).join('') || '<p class="muted">Sin datos.</p>'}</div>
    <div class="card analytics-card"><h3>Marcadores exactos</h3>${m.rows.slice(0,10).map(r=>barRow(esc(r.name), r.exact, maxExact, ' exactos')).join('') || '<p class="muted">Sin datos.</p>'}</div>
    <div class="card analytics-card"><h3>Avance de pronósticos</h3>${completion.slice(0,10).map(r=>barRow(esc(r.name), r.done, r.total, `/${r.total}`)).join('') || '<p class="muted">Sin participantes.</p>'}</div>
    <div class="card analytics-card"><h3>Lectura rápida</h3>
      <div class="insight-list">
        <div><span>Promedio por participante</span><b>${m.avg} pts</b></div>
        <div><span>Acierto de ganador global</span><b>${m.winnerPct}%</b></div>
        <div><span>Exactos totales</span><b>${m.totalExact}</b></div>
        <div><span>Resultados cargados</span><b>${m.finished.length}/${matches.length}</b></div>
      </div>
    </div>
  </div>`;
}
function renderDashboard(){
  const m = dashboardMetrics();
  const groupFinished = matches.filter(x=>Number(x.stageId)===1 && hasScore(state.results[x.id])).length;
  const participantProgress = state.participants.length ? Math.round(predictionCompleteness().reduce((s,p)=>s+p.done,0)/(state.participants.length*matches.length)*100) : 0;
  $('dashboard').innerHTML = `
    <div class="section-head"><div><p class="eyebrow">Panel general · V5.4</p><h2>Dashboard avanzado</h2></div><span class="status-chip">${sb ? 'Modo grupo · Supabase' : 'Modo local'}</span></div>
    <div class="kpi-grid advanced">
      ${statCard('Participantes', state.participants.length, 'Jugadores inscritos', 'tone-cyan')}
      ${statCard('Partidos jugados', m.finished.length, `${matches.length - m.finished.length} pendientes`, 'tone-gold')}
      ${statCard('Fase de grupos', `${groupFinished}/72`, 'Resultados cargados', 'tone-lime')}
      ${statCard('Líder actual', m.leader ? esc(m.leader.name) : '—', m.leader ? `${m.leader.pts} puntos` : 'Sin ranking', 'tone-magenta')}
      ${statCard('Promedio', m.avg, 'Puntos por participante', 'tone-cyan')}
      ${statCard('Pronósticos', `${participantProgress}%`, 'Completitud global', 'tone-lime')}
    </div>
    <div class="grid two">
      <div class="card"><h3>Clasificados actuales</h3>${renderQualifiedSummary()}</div>
      <div class="card"><h3>Top ranking</h3>${renderMiniRanking()}</div>
    </div>
    ${renderAdvancedAnalytics()}`;
}
function renderMiniRanking(){
  const rows = rankingRows().slice(0,5);
  if(!rows.length) return `<p class="muted">Aún no hay participantes.</p>`;
  return `<div class="mini-list">${rows.map((r,i)=>`<div><b>${['🥇','🥈','🥉'][i] || '#'+(i+1)} ${esc(r.name)}</b><span>${r.pts} pts</span></div>`).join('')}</div>`;
}

function teamLine(t){ return `<span class="team-line">${flagHtml(t)}<b>${esc(t.name)}</b><small>${esc(t.code)}</small></span>`; }
function matchCard(m){
  const r = state.results[m.id];
  return `<article class="match-card">
    <div class="match-top"><span>#${m.matchNumber}</span><span>${stageES(m.stage)}</span></div>
    <div class="teams-vs"><div>${flagHtml(m.home)}<b>${esc(m.home.name)}</b></div><span>VS</span><div>${flagHtml(m.away)}<b>${esc(m.away.name)}</b></div></div>
    <div class="match-meta"><span>🗓️ ${m.dateCR}</span><span>🕒 ${m.timeCR} CR</span><span>🏟️ ${esc(m.venue)}</span><span>📍 ${esc(m.city)}</span></div>
    <div class="result ${hasScore(r)?'done':'pending'}">${hasScore(r) ? `${r.h} - ${r.a}` : '⏳ Pendiente'}</div>
  </article>`;
}
function renderCalendar(){
  const groups = groupLetters();
  $('calendar').innerHTML = `
    <div class="section-head"><div><p class="eyebrow">Todos los horarios en Costa Rica</p><h2>Calendario</h2></div></div>
    ${groups.map(g=>`<div class="card"><div class="group-title"><h3>Grupo ${g}</h3><span>${groupMatches(g).length} partidos</span></div><div class="match-grid">${groupMatches(g).map(matchCard).join('')}</div></div>`).join('')}`;
}
function statusBadge(type){
  if(type === 'direct') return `<span class="badge direct">Clasifica</span>`;
  if(type === 'third') return `<span class="badge third">Mejor 3º</span>`;
  return `<span class="badge out">Pendiente</span>`;
}
function renderGroupTable(g){
  const rows = standingsForGroup(g);
  const qmap = qualifierMap();
  return `<div class="card group-standings">
    <div class="group-title"><h3>Grupo ${g}</h3><span>Reglas FIFA</span></div>
    <div class="table-wrap"><table class="standings-table">
      <thead><tr><th>Pos</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>PTS</th><th>Estado</th></tr></thead>
      <tbody>${rows.map((r,i)=>{
        const st = qmap[`${g}_${r.code}`];
        return `<tr class="${st || 'out'}"><td>${i+1}</td><td>${teamLine(r)}</td><td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.p}</td><td>${r.gf}</td><td>${r.gc}</td><td>${r.dg>0?'+'+r.dg:r.dg}</td><td><b>${r.pts}</b></td><td>${statusBadge(st)}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
}
function renderQualifiedSummary(){
  const direct = [], thirds = thirdPlaceRanking();
  groupLetters().forEach(g => {
    const rows = standingsForGroup(g);
    direct.push({slot:`${g}1`, ...rows[0]}); direct.push({slot:`${g}2`, ...rows[1]});
  });
  const best = thirds.slice(0,8);
  return `<div class="qualified-summary">
    <div><h4>Clasificación directa</h4><p>${direct.map(t=>`${flagHtml(t)} ${esc(t.code)}`).join(' · ')}</p></div>
    <div><h4>Mejores terceros actuales</h4><p>${best.map(t=>`${flagHtml(t)} ${esc(t.code)} (${t.sourceGroup})`).join(' · ') || '—'}</p></div>
  </div>`;
}
function renderGroups(){
  $('groups').innerHTML = `
    <div class="section-head"><div><p class="eyebrow">Motor de grupos FIFA</p><h2>Posiciones y clasificados</h2></div></div>
    <div class="card rules"><h3>Criterios aplicados</h3><p>Puntos, diferencia de goles, goles anotados y enfrentamiento directo entre equipos empatados. Clasifican 1º y 2º de cada grupo, más los 8 mejores terceros.</p></div>
    ${renderQualifiedSummary()}
    <div class="group-grid">${groupLetters().map(renderGroupTable).join('')}</div>`;
}
function renderKnockout(){
  const {bestThirds} = groupPositionMap();
  $('knockout').innerHTML = `<div class="section-head"><div><p class="eyebrow">V5.2 · Bracket automático</p><h2>Eliminatorias</h2></div><span class="status-chip">Dieciseisavos a Final</span></div>
    <div class="grid two">
      <div class="card rules"><h3>Mejores terceros</h3><p>La llave asigna automáticamente los ocho mejores terceros disponibles a los cruces compatibles indicados en el calendario.</p><div class="thirds-strip">${bestThirds.map((t,i)=>`<span class="${i<8?'qualified':'not-qualified'}">${i+1}. ${flagHtml(t)} ${t.code} · G${t.sourceGroup} · ${t.pts} pts</span>`).join('')}</div></div>
      <div class="card rules"><h3>Motor de eliminatorias</h3><p>Los ganadores avanzan por etiquetas W/RU del calendario. Cuando cargues resultados oficiales de eliminatorias, el cuadro se actualizará automáticamente.</p></div>
    </div>
    ${renderBracket()}`;
}
function participantOptions(id='participantSelect'){
  return `<select id="${id}">${state.participants.map(p=>`<option value="${p.id}" ${p.id===currentParticipant?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`;
}
function inputMatchRow(m,type){
  const pid = currentParticipant;
  const v = type === 'real' ? state.results[m.id] || {} : state.predictions[key(pid,m.id)] || {};
  return `<article class="input-row">
    <div><b>#${m.matchNumber}</b><small>${m.dateCR} · ${m.timeCR} CR</small></div>
    <label>${flagHtml(m.home)} ${esc(m.home.name)}<input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="h" value="${v.h ?? ''}"></label>
    <span class="vs-small">-</span>
    <label>${flagHtml(m.away)} ${esc(m.away.name)}<input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="a" value="${v.a ?? ''}"></label>
  </article>`;
}
function predictionProgress(pid){
  const total = matches.length;
  const done = matches.filter(m => hasScore(state.predictions[key(pid,m.id)])).length;
  return {done,total,pct: total ? Math.round(done/total*100) : 0};
}
function renderPredictions(){
  if(!state.participants.length){ $('predictions').innerHTML = `<div class="card empty"><h2>Primero agrega participantes</h2><p class="muted">Ve a Admin y crea al menos un participante.</p></div>`; return; }
  const p = predictionProgress(currentParticipant);
  $('predictions').innerHTML = `<div class="section-head"><div><p class="eyebrow">Ordenado por número de partido</p><h2>Mis Pronósticos</h2></div>${participantOptions('participantSelect')}</div>
    <div class="card"><div class="progress-head"><b>${p.done}/${p.total} completados</b><span>${p.pct}%</span></div><div class="progress"><i style="width:${p.pct}%"></i></div></div>
    <div class="card input-list">${matches.map(m=>inputMatchRow(m,'pred')).join('')}</div>
    <button class="primary fixed-action" id="savePredictions">Guardar pronósticos</button>`;
  $('participantSelect').onchange = e => { currentParticipant = e.target.value; renderPredictions(); };
  $('savePredictions').onclick = savePredictions;
}

function customResultsForParticipant(pid){
  const custom = {};
  matches.forEach(m => {
    const pred = state.predictions[key(pid,m.id)];
    if(hasScore(pred)) custom[m.id] = {...pred};
  });
  return custom;
}
function simulationSummary(custom){
  const groupPred = matches.filter(m=>Number(m.stageId)===1 && hasScore(custom[m.id])).length;
  const koPred = matches.filter(m=>Number(m.stageId)>1 && hasScore(custom[m.id])).length;
  const final = matches.find(m=>Number(m.stageId)===7);
  const champion = final ? winnerOfMatch(final.id, custom, {}) : cloneTeam(null,'Campeón');
  const finalists = final ? resolvedTeamsForMatch(final, custom, {}) : {home:cloneTeam(null), away:cloneTeam(null)};
  return {groupPred, koPred, champion, finalists};
}
function renderSimulationHighlights(pid, custom){
  const s = simulationSummary(custom);
  return `<div class="simulation-hero card">
    <div><p class="eyebrow">Campeón proyectado</p><h2>${flagHtml(s.champion)} ${esc(s.champion.name)}</h2><p class="muted">Según los pronósticos registrados para este participante.</p></div>
    <div class="sim-final"><small>Final proyectada</small><b>${flagHtml(s.finalists.home)} ${esc(s.finalists.home.name)}</b><span>vs</span><b>${flagHtml(s.finalists.away)} ${esc(s.finalists.away.name)}</b></div>
    <div class="sim-kpis">
      ${statCard('Grupos simulados', `${s.groupPred}/72`, 'Partidos con pronóstico')}
      ${statCard('Eliminatorias', `${s.koPred}/32`, 'Partidos con pronóstico')}
    </div>
  </div>`;
}
function renderProjectedQualified(custom){
  const pos = groupPositionMap(custom);
  const firstSecond = [];
  groupLetters().forEach(g=>{ if(pos.positions[`1${g}`]) firstSecond.push(pos.positions[`1${g}`]); if(pos.positions[`2${g}`]) firstSecond.push(pos.positions[`2${g}`]); });
  return `<div class="card"><h3>Clasificados proyectados</h3><div class="qualified-summary projected">
    <div><h4>Primeros y segundos</h4><p>${firstSecond.map(t=>`${flagHtml(t)} ${esc(t.code)}`).join(' · ')}</p></div>
    <div><h4>Mejores terceros</h4><p>${pos.bestThirds.slice(0,8).map(t=>`${flagHtml(t)} ${esc(t.code)} (${t.sourceGroup})`).join(' · ')}</p></div>
  </div></div>`;
}
function renderMyWorld(){
  if(!state.participants.length){ $('myworld').innerHTML = `<div class="card"><h2>Mi Mundial</h2><p class="muted">Agrega participantes para simular con sus pronósticos.</p></div>`; return; }
  const custom = customResultsForParticipant(currentParticipant);
  const groups = groupLetters().map(g => `<div class="card"><div class="group-title"><h3>Grupo ${g} proyectado</h3><span>Simulación personalizada</span></div><div class="table-wrap"><table class="standings-table"><thead><tr><th>Pos</th><th>Equipo</th><th>PJ</th><th>PTS</th><th>DG</th><th>GF</th></tr></thead><tbody>${standingsForGroup(g, custom).map((r,i)=>`<tr class="${i<2?'direct':i===2?'third':'out'}"><td>${i+1}</td><td>${teamLine(r)}</td><td>${r.pj}</td><td><b>${r.pts}</b></td><td>${r.dg>0?'+'+r.dg:r.dg}</td><td>${r.gf}</td></tr>`).join('')}</tbody></table></div></div>`).join('');
  $('myworld').innerHTML = `<div class="section-head"><div><p class="eyebrow">V5.3 · Simulación personalizada</p><h2>Mi Mundial</h2></div>${participantOptions('simParticipantSelect')}</div>
    ${renderSimulationHighlights(currentParticipant, custom)}
    ${renderProjectedQualified(custom)}
    <div class="section-head"><div><p class="eyebrow">Grupos proyectados</p><h2>Posiciones según pronóstico</h2></div></div>
    <div class="group-grid">${groups}</div>
    <div class="section-head"><div><p class="eyebrow">Bracket proyectado</p><h2>Mi cuadro</h2></div><span class="status-chip">Se alimenta de tus marcadores</span></div>${renderBracket(custom)}`;
  $('simParticipantSelect').onchange = e => { currentParticipant = e.target.value; renderMyWorld(); };
}
function renderRanking(){
  const rows = rankingRows();
  $('ranking').innerHTML = `<div class="section-head"><div><p class="eyebrow">Tabla general</p><h2>Ranking</h2></div></div>
    <div class="podium">${rows.slice(0,3).map((r,i)=>`<div class="podium-card"><span>${['🥇','🥈','🥉'][i]}</span><b>${esc(r.name)}</b><strong>${r.pts} pts</strong><small>${r.exact} exactos · ${r.accuracy}%</small></div>`).join('')}</div>
    <div class="card table-wrap"><table><thead><tr><th>#</th><th>Participante</th><th>Pts</th><th>Exactos</th><th>Ganador</th><th>Pronósticos</th><th>% ganador</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.name)}</b></td><td>${r.pts}</td><td>${r.exact}</td><td>${r.winner}</td><td>${r.predicted}</td><td>${r.accuracy}%</td></tr>`).join('')}</tbody></table></div>`;
}
function renderAdmin(){
  $('admin').innerHTML = `<div class="section-head"><div><p class="eyebrow">Administración</p><h2>Panel Admin</h2></div></div>
    <div class="grid two"><div class="card"><h3>Participantes</h3><div class="admin-line"><input id="playerName" placeholder="Nombre del participante"><button id="addPlayer" class="primary">Agregar</button></div><div class="mini-list">${state.participants.map(p=>`<div><b>${esc(p.name)}</b><button class="danger" data-del="${p.id}">Eliminar</button></div>`).join('') || '<p class="muted">Sin participantes.</p>'}</div></div>
    <div class="card"><h3>Exportar</h3><button id="exportExcel" class="primary">Exportar Excel</button></div></div>
    <div class="card"><h3>Resultados oficiales</h3><p class="muted">Ordenados por número de partido. Estos resultados alimentan grupos, ranking y clasificados.</p><input id="adminPin" class="pin" placeholder="PIN administrador" type="password"> <div class="input-list">${matches.map(m=>inputMatchRow(m,'real')).join('')}</div><button class="primary fixed-action" id="saveResults">Guardar resultados</button></div>`;
  $('addPlayer').onclick = addParticipant;
  $('saveResults').onclick = saveResults;
  $('exportExcel').onclick = exportExcel;
  qsa('[data-del]').forEach(b=>b.onclick=()=>delParticipant(b.dataset.del));
}
async function addParticipant(){
  const name = $('playerName').value.trim(); if(!name) return;
  if(sb){ const {data,error}=await sb.from('participants').insert({name}).select().single(); if(error) return alert(error.message); state.participants.push({id:data.id,name:data.name}); }
  else { state.participants.push({id:crypto.randomUUID(),name}); store(); }
  currentParticipant = state.participants.at(-1).id; renderAll();
}
async function delParticipant(id){
  if(!confirm('¿Eliminar participante y sus pronósticos?')) return;
  if(sb){
    const admin_pin = $('adminPin')?.value || prompt('PIN administrador'); if(!admin_pin) return;
    const {error} = await sb.rpc('admin_delete_participant', {admin_pin, participant:id}); if(error) return alert(error.message); await loadRemote();
  } else {
    state.participants = state.participants.filter(p=>p.id!==id);
    Object.keys(state.predictions).forEach(k=>{ if(k.startsWith(id+'_')) delete state.predictions[k]; }); store();
  }
  currentParticipant = state.participants[0]?.id || ''; renderAll();
}
async function savePredictions(){
  const pid = currentParticipant; if(!pid) return alert('Selecciona un participante.');
  qsa('input[data-type="pred"]').forEach(i => { const k=key(pid,i.dataset.mid); state.predictions[k]=state.predictions[k]||{}; state.predictions[k][i.dataset.side]=val(i.value); });
  if(sb){
    const rows = matches.map(m=>({participant_id:pid, match_id:m.id, home_goals:state.predictions[key(pid,m.id)]?.h, away_goals:state.predictions[key(pid,m.id)]?.a, updated_at:new Date().toISOString()}));
    const {error}=await sb.from('predictions').upsert(rows,{onConflict:'participant_id,match_id'}); if(error) return alert(error.message);
  } else store();
  alert('Pronósticos guardados'); renderAll();
}
async function saveResults(){
  qsa('input[data-type="real"]').forEach(i => { state.results[i.dataset.mid]=state.results[i.dataset.mid]||{}; state.results[i.dataset.mid][i.dataset.side]=val(i.value); });
  if(sb){
    const admin_pin = $('adminPin')?.value || prompt('PIN administrador'); if(!admin_pin) return;
    const payload = Object.entries(state.results).map(([mid,r])=>({match_id:Number(mid), home_goals:r.h, away_goals:r.a}));
    const {error}=await sb.rpc('admin_upsert_results', {admin_pin, payload}); if(error) return alert(error.message); await loadRemote();
  } else store();
  alert('Resultados guardados'); renderAll();
}
function exportExcel(){
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.participants), 'Participantes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matches.map(m=>({No:m.matchNumber, Fase:stageES(m.stage), Grupo:m.group, Fecha:m.dateCR, HoraCR:m.timeCR, Local:m.home.name, Visitante:m.away.name, RealLocal:state.results[m.id]?.h ?? '', RealVisitante:state.results[m.id]?.a ?? ''}))), 'Partidos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groupLetters().flatMap(g=>standingsForGroup(g).map((r,i)=>({Grupo:g, Pos:i+1, Equipo:r.name, PJ:r.pj, G:r.g, E:r.e, P:r.p, GF:r.gf, GC:r.gc, DG:r.dg, PTS:r.pts})))), 'Grupos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rankingRows()), 'Ranking');
  XLSX.writeFile(wb, 'quiniela_mundial_2026_v55.xlsx');
}
function renderAll(){ renderHero(); renderDashboard(); renderCalendar(); renderGroups(); renderKnockout(); renderPredictions(); renderMyWorld(); renderRanking(); renderAdmin(); }
init();
