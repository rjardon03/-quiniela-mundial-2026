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
  return { code:team.code, name:team.name, flag:team.flag, group:team.group, pj:0, g:0, e:0, p:0, gf:0, gc:0, dg:0, pts:0, h2hPts:0, h2hDg:0, h2hGf:0 };
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
  return `<div class="stat-card"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>`:''}</div>`;
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
function renderDashboard(){
  const finished = Object.values(state.results).filter(hasScore).length;
  const groupFinished = matches.filter(m=>m.stageId===1 && hasScore(state.results[m.id])).length;
  const leader = rankingRows()[0];
  $('dashboard').innerHTML = `
    <div class="section-head"><div><p class="eyebrow">Panel general</p><h2>Dashboard</h2></div><span class="status-chip">${sb ? 'Modo grupo · Supabase' : 'Modo local'}</span></div>
    <div class="kpi-grid">
      ${stat('Participantes', state.participants.length, 'Jugadores inscritos')}
      ${stat('Partidos jugados', finished, `${matches.length - finished} pendientes`)}
      ${stat('Fase de grupos', `${groupFinished}/72`, 'Resultados cargados')}
      ${stat('Líder actual', leader ? esc(leader.name) : '—', leader ? `${leader.pts} puntos` : 'Sin ranking')}
    </div>
    <div class="grid two">
      <div class="card"><h3>Clasificados actuales</h3>${renderQualifiedSummary()}</div>
      <div class="card"><h3>Top ranking</h3>${renderMiniRanking()}</div>
    </div>`;
}
function renderMiniRanking(){
  const rows = rankingRows().slice(0,5);
  if(!rows.length) return `<p class="muted">Aún no hay participantes.</p>`;
  return `<div class="mini-list">${rows.map((r,i)=>`<div><b>${['🥇','🥈','🥉'][i] || '#'+(i+1)} ${esc(r.name)}</b><span>${r.pts} pts</span></div>`).join('')}</div>`;
}

function teamLine(t){ return `<span class="team-line"><span class="flag">${t.flag}</span><b>${esc(t.name)}</b><small>${esc(t.code)}</small></span>`; }
function matchCard(m){
  const r = state.results[m.id];
  return `<article class="match-card">
    <div class="match-top"><span>#${m.matchNumber}</span><span>${stageES(m.stage)}</span></div>
    <div class="teams-vs"><div>${m.home.flag}<b>${esc(m.home.name)}</b></div><span>VS</span><div>${m.away.flag}<b>${esc(m.away.name)}</b></div></div>
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
    <div><h4>Clasificación directa</h4><p>${direct.map(t=>`${t.flag} ${esc(t.code)}`).join(' · ')}</p></div>
    <div><h4>Mejores terceros actuales</h4><p>${best.map(t=>`${t.flag} ${esc(t.code)} (${t.sourceGroup})`).join(' · ') || '—'}</p></div>
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
  const direct = [];
  groupLetters().forEach(g => { const rows = standingsForGroup(g); direct.push(`${g}1 ${rows[0].flag} ${rows[0].code}`); direct.push(`${g}2 ${rows[1].flag} ${rows[1].code}`); });
  const thirds = thirdPlaceRanking().slice(0,8).map(t=>`3${t.sourceGroup} ${t.flag} ${t.code}`);
  $('knockout').innerHTML = `<div class="section-head"><div><p class="eyebrow">Base eliminatoria</p><h2>Clasificados a dieciseisavos</h2></div></div>
    <div class="card"><h3>32 clasificados actuales</h3><div class="slots">${[...direct,...thirds].map(x=>`<span>${x}</span>`).join('')}</div><p class="muted">La llave específica se conectará en V5.2 con el patrón oficial de cruces.</p></div>`;
}
function participantOptions(id='participantSelect'){
  return `<select id="${id}">${state.participants.map(p=>`<option value="${p.id}" ${p.id===currentParticipant?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`;
}
function inputMatchRow(m,type){
  const pid = currentParticipant;
  const v = type === 'real' ? state.results[m.id] || {} : state.predictions[key(pid,m.id)] || {};
  return `<article class="input-row">
    <div><b>#${m.matchNumber}</b><small>${m.dateCR} · ${m.timeCR} CR</small></div>
    <label>${m.home.flag} ${esc(m.home.name)}<input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="h" value="${v.h ?? ''}"></label>
    <span class="vs-small">-</span>
    <label>${m.away.flag} ${esc(m.away.name)}<input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="a" value="${v.a ?? ''}"></label>
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
function renderMyWorld(){
  if(!state.participants.length){ $('myworld').innerHTML = `<div class="card"><h2>Mi Mundial</h2><p class="muted">Agrega participantes para simular con sus pronósticos.</p></div>`; return; }
  const custom = {};
  matches.filter(m=>m.stageId===1).forEach(m => {
    const pred = state.predictions[key(currentParticipant,m.id)];
    if(hasScore(pred)) custom[m.id] = {...pred};
  });
  const groups = groupLetters().map(g => `<div class="card"><div class="group-title"><h3>Grupo ${g} proyectado</h3></div><div class="table-wrap"><table class="standings-table"><thead><tr><th>Pos</th><th>Equipo</th><th>PTS</th><th>DG</th><th>GF</th></tr></thead><tbody>${standingsForGroup(g, custom).map((r,i)=>`<tr><td>${i+1}</td><td>${teamLine(r)}</td><td><b>${r.pts}</b></td><td>${r.dg>0?'+'+r.dg:r.dg}</td><td>${r.gf}</td></tr>`).join('')}</tbody></table></div></div>`).join('');
  $('myworld').innerHTML = `<div class="section-head"><div><p class="eyebrow">Simulación con pronósticos</p><h2>Mi Mundial</h2></div>${participantOptions('simParticipantSelect')}</div><div class="group-grid">${groups}</div>`;
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
  XLSX.writeFile(wb, 'quiniela_mundial_2026_v51.xlsx');
}
function renderAll(){ renderHero(); renderDashboard(); renderCalendar(); renderGroups(); renderKnockout(); renderPredictions(); renderMyWorld(); renderRanking(); renderAdmin(); }
init();
