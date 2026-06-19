const cfg = window.QUINIELA_CONFIG || {};
let matches = [], teams = [], sb = null;
let state = { participants: [], predictions: {}, results: {} };

const $ = id => document.getElementById(id);
const qsa = s => [...document.querySelectorAll(s)];
const key = (pid, mid) => `${pid}_${mid}`;
const val = x => x === '' || x == null ? null : Number(x);

function store() { localStorage.setItem('quiniela2026', JSON.stringify(state)); }
function loadLocal() { state = JSON.parse(localStorage.getItem('quiniela2026') || JSON.stringify(state)); }
function esc(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

async function init() {
  matches = await fetch('data/matches.json').then(r => r.json());
  teams = await fetch('data/teams.json').then(r => r.json());

  if (window.quinielaSupabase) {
    sb = window.quinielaSupabase;
    $('modeStatus').textContent = 'Modo grupo activo · datos centralizados';
    await loadRemote();
  } else {
    $('modeStatus').textContent = 'Modo local · datos guardados en este navegador';
    loadLocal();
  }

  renderAll();
}

async function loadRemote() {
  const [p, pr, re] = await Promise.all([
    sb.from('participants').select('*').order('created_at'),
    sb.from('predictions').select('*'),
    sb.from('results').select('*')
  ]);

  state.participants = (p.data || []).map(x => ({ id: x.id, name: x.name }));
  state.predictions = {};
  (pr.data || []).forEach(x => state.predictions[key(x.participant_id, x.match_id)] = { h: x.home_goals, a: x.away_goals });
  state.results = {};
  (re.data || []).forEach(x => state.results[x.match_id] = { h: x.home_goals, a: x.away_goals });
}

function stageES(s) {
  return {
    'Group Stage': 'Fase de grupos',
    'Round of 32': 'Dieciseisavos',
    'Round of 16': 'Octavos de final',
    'Quarterfinals': 'Cuartos de final',
    'Semifinals': 'Semifinales',
    'Third Place Playoff': 'Tercer lugar',
    'Final': 'Final'
  }[s] || s;
}

function resultFor(m) { return state.results[m.id]; }
function hasScore(r) { return r && r.h != null && r.a != null; }
function resultLabel(m) { const r = resultFor(m); return hasScore(r) ? `${r.h} - ${r.a}` : 'Pendiente'; }
function statusClass(m) { return hasScore(resultFor(m)) ? 'final' : 'pending'; }

function renderFixture() {
  const groups = [...new Set(teams.map(t => t.group))].sort();
  $('groups').innerHTML = groups.map(g => {
    const gt = teams.filter(t => t.group === g);
    const gm = matches.filter(m => m.stageId === 1 && m.group === g);
    return `
      <div class="card groupCard">
        <div class="groupHead"><h3>Grupo ${g}</h3><span>⚽</span></div>
        <div class="teams">${gt.map(teamChip).join('')}</div>
        <div class="calendarRows">${gm.map(calendarRow).join('')}</div>
      </div>`;
  }).join('');

  const ko = matches.filter(m => m.stageId > 1);
  const stages = [...new Set(ko.map(m => m.stage))];
  $('knockout').innerHTML = stages.map(s => `
    <div class="card groupCard">
      <div class="groupHead"><h3>${stageES(s)}</h3><span>🏆</span></div>
      <div class="calendarRows">${ko.filter(m => m.stage === s).map(calendarRow).join('')}</div>
    </div>`).join('');
}

function teamChip(t) {
  return `<div class="chip"><span>${t.flag}</span><span>${esc(t.name)}</span><b>${esc(t.code)}</b></div>`;
}

function calendarRow(m) {
  const r = resultFor(m);
  return `
    <article class="gameRow calendarGame">
      <div class="gameNo">#${m.matchNumber}</div>
      <div class="gameDate">${m.dateCR}<small>${m.timeCR} CR</small></div>
      <div class="gameTeams">
        <strong>${m.home.flag} ${esc(m.home.name)}</strong>
        <span>vs</span>
        <strong>${m.away.flag} ${esc(m.away.name)}</strong>
      </div>
      <div class="gameVenue">${esc(m.venue)}<small>${esc(m.city)}</small></div>
      <div class="resultPill ${statusClass(m)}">${hasScore(r) ? esc(resultLabel(m)) : '⏳ Pendiente'}</div>
    </article>`;
}

function inputRow(m, type) {
  const selected = $('playerSelect')?.value;
  const v = type === 'real' ? state.results[m.id] : state.predictions[key(selected, m.id)] || {};
  const label = type === 'real' ? 'Resultado oficial' : 'Tu pronóstico';
  return `
    <article class="gameRow inputGame">
      <div class="gameNo">#${m.matchNumber}</div>
      <div class="gameDate">${m.dateCR}<small>${m.timeCR} CR</small></div>
      <div class="inputTeams">
        <label><span>${m.home.flag} ${esc(m.home.name)}</span><input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="h" value="${v?.h ?? ''}"></label>
        <div class="vsBox">${label}</div>
        <label><span>${m.away.flag} ${esc(m.away.name)}</span><input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="a" value="${v?.a ?? ''}"></label>
      </div>
      <div class="gameVenue">${esc(m.venue)}<small>${esc(m.city)}</small></div>
    </article>`;
}

async function addParticipant() {
  const name = $('playerName').value.trim();
  if (!name) return;

  if (sb) {
    const { data, error } = await sb.from('participants').insert({ name }).select().single();
    if (error) return alert(error.message);
    state.participants.push({ id: data.id, name: data.name });
  } else {
    state.participants.push({ id: crypto.randomUUID(), name });
    store();
  }

  $('playerName').value = '';
  renderAll();
}

async function delParticipant(id) {
  if (!confirm('¿Eliminar participante? Esta acción también elimina sus pronósticos.')) return;

  if (sb) {
    const admin_pin = $('adminPin')?.value || prompt('PIN administrador');
    if (!admin_pin) return;
    const { error } = await sb.rpc('admin_delete_participant', { admin_pin, participant: id });
    if (error) return alert(error.message);
    await loadRemote();
    renderAll();
    return;
  }

  state.participants = state.participants.filter(p => p.id !== id);
  Object.keys(state.predictions).forEach(k => { if (k.startsWith(id + '_')) delete state.predictions[k]; });
  store();
  renderAll();
}

function renderPlayers() {
  const html = state.participants.map(p => `
    <div class="row">
      <b>${esc(p.name)}</b>
      <button class="danger" onclick="delParticipant('${p.id}')">Eliminar</button>
    </div>`).join('') || '<p class="note">No hay participantes todavía.</p>';

  $('playersList').innerHTML = html;
  const opts = state.participants.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('playerSelect').innerHTML = opts;
}

function orderedInputList(type) {
  const title = type === 'real' ? 'Resultados oficiales · orden por número de partido' : 'Mis pronósticos · orden por número de partido';
  const ordered = [...matches].sort((a, b) => Number(a.matchNumber) - Number(b.matchNumber));
  return `<div class="card slimCard"><div class="slimHead">${title}</div>${ordered.map(m => inputRow(m, type)).join('')}</div>`;
}

function renderPredictions() {
  if (!state.participants.length) {
    $('predictionsList').innerHTML = '<div class="card emptyState"><h3>Agrega participantes</h3><p class="note">Primero crea al menos un participante para poder capturar pronósticos.</p></div>';
    return;
  }
  $('predictionsList').innerHTML = orderedInputList('pred');
}

function renderResults() {
  $('resultsList').innerHTML = orderedInputList('real');
}

function score(pred, res) {
  if (!pred || !res || pred.h == null || pred.a == null || res.h == null || res.a == null) return 0;
  let pts = 0;
  if (Math.sign(pred.h - pred.a) === Math.sign(res.h - res.a)) pts++;
  if (pred.h === res.h) pts++;
  if (pred.a === res.a) pts++;
  if (pred.h === res.h && pred.a === res.a) pts++;
  return pts;
}

function scoreBreakdown(pred, res) {
  if (!pred || !res || pred.h == null || pred.a == null || res.h == null || res.a == null) return { winner:0, home:0, away:0, exact:0, total:0 };
  const winner = Math.sign(pred.h - pred.a) === Math.sign(res.h - res.a) ? 1 : 0;
  const home = pred.h === res.h ? 1 : 0;
  const away = pred.a === res.a ? 1 : 0;
  const exact = pred.h === res.h && pred.a === res.a ? 1 : 0;
  return { winner, home, away, exact, total: winner + home + away + exact };
}

function rankingRows() {
  return state.participants.map(p => {
    let pts = 0, exact = 0, withPoints = 0, predicted = 0;
    matches.forEach(m => {
      const pred = state.predictions[key(p.id, m.id)];
      const res = state.results[m.id];
      if (pred && pred.h != null && pred.a != null) predicted++;
      const s = scoreBreakdown(pred, res);
      pts += s.total;
      if (s.total) withPoints++;
      if (s.exact) exact++;
    });
    return { name: p.name, pts, exact, withPoints, predicted };
  }).sort((a,b) => b.pts - a.pts || b.exact - a.exact || b.withPoints - a.withPoints);
}

function renderRanking() {
  const rows = rankingRows();
  const finished = Object.values(state.results).filter(hasScore).length;
  const leader = rows[0];
  $('rankingCards').innerHTML = `
    <div class="stat"><span>Líder</span><strong>${leader ? esc(leader.name) : '-'}</strong></div>
    <div class="stat"><span>Puntos líder</span><strong>${leader ? leader.pts : 0}</strong></div>
    <div class="stat"><span>Partidos con resultado</span><strong>${finished} / ${matches.length}</strong></div>
    <div class="stat"><span>Participantes</span><strong>${state.participants.length}</strong></div>`;

  $('rankingTable').innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Participante</th><th>Puntos</th><th>Exactos</th><th>Partidos con puntos</th><th>Pronósticos</th></tr></thead>
      <tbody>${rows.map((r,i) => `<tr><td>${i+1}</td><td><b>${esc(r.name)}</b></td><td>${r.pts}</td><td>${r.exact}</td><td>${r.withPoints}</td><td>${r.predicted}</td></tr>`).join('')}</tbody>
    </table>`;
}

async function savePredictions() {
  const pid = $('playerSelect').value;
  if (!pid) return alert('Selecciona un participante.');

  qsa('input[data-type="pred"]').forEach(i => {
    const k = key(pid, i.dataset.mid);
    state.predictions[k] = state.predictions[k] || {};
    state.predictions[k][i.dataset.side] = val(i.value);
  });

  if (sb) {
    const rows = matches.map(m => ({
      participant_id: pid,
      match_id: m.id,
      home_goals: state.predictions[key(pid, m.id)]?.h,
      away_goals: state.predictions[key(pid, m.id)]?.a,
      updated_at: new Date().toISOString()
    }));
    const { error } = await sb.from('predictions').upsert(rows, { onConflict: 'participant_id,match_id' });
    if (error) return alert(error.message);
  } else {
    store();
  }

  alert('Pronósticos guardados');
  renderRanking();
}

async function saveResults() {
  qsa('input[data-type="real"]').forEach(i => {
    state.results[i.dataset.mid] = state.results[i.dataset.mid] || {};
    state.results[i.dataset.mid][i.dataset.side] = val(i.value);
  });

  if (sb) {
    const admin_pin = $('adminPin')?.value || prompt('PIN administrador');
    if (!admin_pin) return;
    const payload = Object.entries(state.results).map(([mid, r]) => ({ match_id: Number(mid), home_goals: r.h, away_goals: r.a }));
    const { error } = await sb.rpc('admin_upsert_results', { admin_pin, payload });
    if (error) return alert(error.message);
    await loadRemote();
  } else {
    store();
  }

  alert('Resultados guardados');
  renderAll();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  dl(blob, 'quiniela_mundial_2026.json');
}
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
function importJson(ev) { const f = ev.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { state = JSON.parse(r.result); store(); renderAll(); }; r.readAsText(f); }

function exportExcel() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.participants), 'Participantes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matches.map(m => ({
    No: m.matchNumber, Etapa: stageES(m.stage), Fecha: m.dateCR, HoraCR: m.timeCR,
    Local: m.home.name, Visitante: m.away.name, Estadio: m.venue, Ciudad: m.city,
    RealLocal: state.results[m.id]?.h ?? '', RealVisitante: state.results[m.id]?.a ?? ''
  }))), 'Partidos');
  const preds = [];
  state.participants.forEach(p => matches.forEach(m => preds.push({
    Participante: p.name, Partido: m.matchNumber, Local: m.home.name, Visitante: m.away.name,
    PronLocal: state.predictions[key(p.id, m.id)]?.h ?? '', PronVisitante: state.predictions[key(p.id, m.id)]?.a ?? '',
    Puntos: score(state.predictions[key(p.id, m.id)], state.results[m.id])
  })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(preds), 'Pronosticos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rankingRows()), 'Ranking');
  XLSX.writeFile(wb, 'quiniela_mundial_2026.xlsx');
}

function renderAll() {
  renderFixture();
  renderPlayers();
  renderPredictions();
  renderResults();
  renderRanking();
}

qsa('.tabs button').forEach(b => b.onclick = () => {
  qsa('.tabs button,.view').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $(b.dataset.view).classList.add('active');
  if (b.dataset.view === 'ranking') renderRanking();
});

$('addPlayer').onclick = addParticipant;
$('savePredictions').onclick = savePredictions;
$('saveResults').onclick = saveResults;
$('exportJson').onclick = exportJson;
$('importJson').onchange = importJson;
$('exportExcel').onclick = exportExcel;
$('playerSelect').onchange = renderPredictions;

init();
