const cfg = window.QUINIELA_CONFIG || {};
const sb = window.quinielaSupabase || null;
let matches = [];
let teams = [];
let state = { participants: [], predictions: {}, results: {} };
let currentParticipant = '';
let currentView = 'dashboard';
let predictionDateFilter = 'all';
let calendarDateFilter = 'all';
let comparisonFilter = 'all';
let resultsRealtimeChannel = null;
let resultsRefreshTimer = null;
let resultsRefreshInFlight = false;
let resultsRefreshQueued = false;

const $ = id => document.getElementById(id);
function toast(msg, type='ok', duration=3200){
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-in'));
  setTimeout(() => { t.classList.remove('toast-in'); setTimeout(() => t.remove(), 400); }, duration);
}
const qsa = s => [...document.querySelectorAll(s)];
const key = (pid, mid) => `${pid}_${mid}`;
const val = x => x === '' || x == null ? null : Number(x);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const flagHtml = t => {
  if(!t) return '<span class="flag-emoji">⚪</span>';
  if(t.flagUrl) return `<img class="flag-img" src="${esc(t.flagUrl)}" alt="${esc(t.code || t.name || 'flag')}">`;
  return `<span class="flag-emoji">${t.flag || '⚪'}</span>`;
};
const teamText = t => `${t?.name || 'Por definir'}`.trim();

const hasScore = r => r && r.h != null && r.a != null && !Number.isNaN(r.h) && !Number.isNaN(r.a);
const resultFor = m => state.results[m.id];
const groupLetters = () => [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
const groupMatches = g => matches.filter(m => Number(m.stageId) === 1 && m.group === g).sort((a,b)=>a.matchNumber-b.matchNumber);
const groupTeams = g => teams.filter(t => t.group === g).sort((a,b)=>a.name.localeCompare(b.name));


function parseCRDate(value){
  const [d,m,y] = String(value || '').split('/').map(Number);
  return d && m && y ? new Date(Date.UTC(y,m-1,d)) : new Date(0);
}
function todayCR(){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Costa_Rica', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${map.day}/${map.month}/${map.year}`;
}
function predictionDates(){
  return [...new Set(matches.map(m=>m.dateCR).filter(Boolean))]
    .sort((a,b)=>parseCRDate(a)-parseCRDate(b));
}
function formatDateLabel(value){
  const dt = parseCRDate(value);
  if(!dt.getTime()) return value;
  return new Intl.DateTimeFormat('es-CR', {
    timeZone:'UTC', weekday:'short', day:'2-digit', month:'short'
  }).format(dt).replace('.', '');
}
function syncVisiblePredictionInputsToState(){
  if(!currentParticipant) return;
  qsa('input[data-type="pred"]').forEach(i => {
    const k = key(currentParticipant, i.dataset.mid);
    state.predictions[k] = state.predictions[k] || {};
    state.predictions[k][i.dataset.side] = val(i.value);
  });
}
function predictionDateToolbar(){
  const dates = predictionDates();
  const today = todayCR();
  const hasToday = dates.includes(today);
  const options = [
    `<option value="all" ${predictionDateFilter==='all'?'selected':''}>Todos los partidos</option>`,
    ...dates.map(d=>`<option value="${esc(d)}" ${predictionDateFilter===d?'selected':''}>${esc(formatDateLabel(d))} · ${esc(d)}</option>`)
  ].join('');
  return `<div class="prediction-filter card">
    <div class="prediction-filter__title"><span>📅</span><div><small>Navegar por fecha</small><b>${predictionDateFilter==='all'?'Todos los partidos':esc(formatDateLabel(predictionDateFilter))}</b></div></div>
    <select id="predictionDateSelect" aria-label="Filtrar pronósticos por fecha">${options}</select>
    <button type="button" class="filter-today ${hasToday?'':'is-disabled'}" id="predictionToday" ${hasToday?'':'disabled'}>Hoy</button>
    <button type="button" class="filter-all" id="predictionAll">Ver todos</button>
  </div>`;
}

function store(){ localStorage.setItem('quiniela2026_v5', JSON.stringify(state)); }
function loadLocal(){ state = JSON.parse(localStorage.getItem('quiniela2026_v5') || JSON.stringify(state)); }

function stageES(s){
  return ({'Group Stage':'Fase de grupos','Round of 32':'Dieciseisavos','Round of 16':'Octavos de final','Quarterfinals':'Cuartos de final','Semifinals':'Semifinales','Third Place Playoff':'Tercer lugar','Final':'Final'})[s] || s;
}

function initWelcomeModal(){
  const modal  = $('welcomeModal');
  const iframe = $('wmIframe');
  if(!modal || !iframe) return;

  const VIDEO_ID = 'oXigiOdAS4Q';
  const SRC = `https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&mute=1&rel=0&loop=1&playlist=${VIDEO_ID}&playsinline=1`;

  function openModal(){
    iframe.src = SRC;
    modal.classList.remove('wm-hidden');
    document.addEventListener('keydown', onEsc);
  }
  function closeModal(){
    iframe.src = '';
    modal.classList.add('wm-hidden');
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e){ if(e.key === 'Escape') closeModal(); }

  $('wmClose').onclick    = closeModal;
  $('wmEnter').onclick    = closeModal;
  $('wmBackdrop').onclick = closeModal;

  const btn = $('btnWakaWaka');
  if(btn) btn.onclick = openModal;
}

async function init(){
  matches = await fetch('data/matches.json').then(r=>r.json());
  teams = await fetch('data/teams.json').then(r=>r.json());
  matches.sort((a,b)=>Number(a.matchNumber)-Number(b.matchNumber));

  if(sb) await loadRemote(); else loadLocal();
  currentParticipant = state.participants[0]?.id || '';
  bindNav();
  renderAll();
  if(sb) setupLiveResults();
  initWelcomeModal();
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

async function refreshResultsFromSupabase(reason='manual'){
  if(!sb) return;
  if(resultsRefreshInFlight){
    resultsRefreshQueued = true;
    return;
  }

  resultsRefreshInFlight = true;
  try{
    const { data, error } = await sb.from('results').select('*');
    if(error) throw error;

    const nextResults = {};
    (data || []).forEach(x => {
      nextResults[x.match_id] = { h:x.home_goals, a:x.away_goals };
    });
    state.results = nextResults;

    if(currentView === 'predictions'){
      // No re-renderizar pronósticos: borraría los inputs que el usuario está completando.
      // Solo actualiza el hero y los badges de puntos de cada fila visible.
      renderHero();
      const seen = new Set();
      qsa('input[data-type="pred"]').forEach(input => {
        const mid = input.dataset.mid;
        if(seen.has(mid)) return;
        seen.add(mid);
        const row = input.closest('.prediction-row');
        if(!row) return;
        const m = matches.find(x => String(x.id) === String(mid));
        if(!m) return;
        const panel = row.querySelector('.points-panel');
        if(panel) panel.outerHTML = predictionPointsBadge(m);
      });
    } else {
      renderAll();
    }
    console.info(`[Resultados] Actualizados desde Supabase (${reason}).`);
  }catch(error){
    console.error('[Resultados] No se pudieron refrescar:', error);
  }finally{
    resultsRefreshInFlight = false;
    if(resultsRefreshQueued){
      resultsRefreshQueued = false;
      setTimeout(() => refreshResultsFromSupabase('queued'), 250);
    }
  }
}

function setupLiveResults(){
  if(!sb || resultsRealtimeChannel) return;

  resultsRealtimeChannel = sb
    .channel('quiniela-results-live')
    .on(
      'postgres_changes',
      { event:'*', schema:'public', table:'results' },
      () => refreshResultsFromSupabase('realtime')
    )
    .subscribe((status, error) => {
      if(error) console.error('[Realtime] Error de suscripción:', error);
      else console.info(`[Realtime] Estado: ${status}`);
    });

  // Respaldo: refresca cada 60 segundos cuando la pestaña está visible.
  resultsRefreshTimer = window.setInterval(() => {
    if(document.visibilityState === 'visible'){
      refreshResultsFromSupabase('interval');
    }
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible'){
      refreshResultsFromSupabase('visibility');
    }
  });

  window.addEventListener('beforeunload', () => {
    if(resultsRefreshTimer) window.clearInterval(resultsRefreshTimer);
    if(resultsRealtimeChannel) sb.removeChannel(resultsRealtimeChannel);
  }, { once:true });
}

function renderView(viewId){
  renderHero();
  if(viewId==='dashboard')        renderDashboard();
  else if(viewId==='calendar')    renderCalendar();
  else if(viewId==='predictions') renderPredictions();
  else if(viewId==='groups')      renderGroups();
  else if(viewId==='knockout')    renderKnockout();
  else if(viewId==='myworld')     renderMyWorld();
  else if(viewId==='ranking')     renderRanking();
  else if(viewId==='comparison')  renderComparison();
  else if(viewId==='admin')       renderAdmin();
}
function bindNav(){
  qsa('.nav button[data-view]').forEach(btn => btn.onclick = () => {
    qsa('.nav button[data-view],.view').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    $(currentView).classList.add('active');
    updateTopSaveButton();
    renderView(currentView);
  });
  const topSave = $('topSavePredictions');
  if(topSave){ topSave.onclick = () => savePredictions(); }
  updateTopSaveButton();
}
function updateTopSaveButton(){
  const topSave = $('topSavePredictions');
  if(!topSave) return;
  topSave.style.display = currentView === 'predictions' ? 'inline-flex' : 'none';
}

function baseStanding(team){
  return { code:team.code, name:team.name, flag:team.flag, flagUrl:team.flagUrl, group:team.group, pj:0, g:0, e:0, p:0, gf:0, gc:0, dg:0, pts:0, h2hPts:0, h2hDg:0, h2hGf:0 };
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
  // Criterios FIFA 2026 para mejores terceros: pts → dg → gf → victorias → nombre
  return groupLetters().map(g => ({...standingsForGroup(g)[2], sourceGroup:g}))
    .filter(t => t && t.code)
    .sort((a,b)=> b.pts-a.pts || b.dg-a.dg || b.gf-a.gf || b.g-a.g || a.name.localeCompare(b.name));
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
  if(!t) return {name:'Por definir', code:'TBD', flag:'⚪', flagUrl:'', group:'', slot};
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
  thirds.sort((a,b)=> b.pts-a.pts || b.dg-a.dg || b.gf-a.gf || b.g-a.g || a.name.localeCompare(b.name));
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
const THIRDS_TABLE={
  "ABCDEFGH":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"D",L:"E"},
  "ABCDEFGI":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"E",L:"I"},
  "ABCDEFGJ":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"E",L:"J"},
  "ABCDEFGK":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"E",L:"K"},
  "ABCDEFGL":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"E"},
  "ABCDEFHI":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"F",K:"D",L:"I"},
  "ABCDEFHJ":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"D",L:"E"},
  "ABCDEFHK":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"F",K:"D",L:"K"},
  "ABCDEFHL":{A:"H",B:"F",D:"B",E:"C",G:"A",I:"D",K:"L",L:"E"},
  "ABCDEFIJ":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"F",K:"E",L:"I"},
  "ABCDEFIK":{A:"C",B:"E",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABCDEFIL":{A:"C",B:"E",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABCDEFJK":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"F",K:"E",L:"K"},
  "ABCDEFJL":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"E"},
  "ABCDEFKL":{A:"C",B:"E",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABCDEGHI":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"E",L:"I"},
  "ABCDEGHJ":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"E",L:"J"},
  "ABCDEGHK":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"E",L:"K"},
  "ABCDEGHL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"E"},
  "ABCDEGIJ":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"D",K:"I",L:"J"},
  "ABCDEGIK":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ABCDEGIL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ABCDEGJK":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"D",K:"J",L:"K"},
  "ABCDEGJL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"J"},
  "ABCDEGKL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDEHIJ":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"D",K:"E",L:"I"},
  "ABCDEHIK":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ABCDEHIL":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ABCDEHJK":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"D",K:"E",L:"K"},
  "ABCDEHJL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"D",K:"L",L:"E"},
  "ABCDEHKL":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDEIJK":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ABCDEIJL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ABCDEIKL":{A:"E",B:"I",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDEJKL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDFGHI":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"D",L:"I"},
  "ABCDFGHJ":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"D",L:"J"},
  "ABCDFGHK":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"D",L:"K"},
  "ABCDFGHL":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"H"},
  "ABCDFGIJ":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"I",L:"J"},
  "ABCDFGIK":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABCDFGIL":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABCDFGJK":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"J",L:"K"},
  "ABCDFGJL":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"J"},
  "ABCDFGKL":{A:"C",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABCDFHIJ":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"D",L:"I"},
  "ABCDFHIK":{A:"H",B:"F",D:"B",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ABCDFHIL":{A:"H",B:"F",D:"B",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ABCDFHJK":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"D",L:"K"},
  "ABCDFHJL":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"H"},
  "ABCDFHKL":{A:"H",B:"F",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDFIJK":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABCDFIJL":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABCDFIKL":{A:"C",B:"I",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABCDFJKL":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABCDGHIJ":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"I",L:"J"},
  "ABCDGHIK":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ABCDGHIL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ABCDGHJK":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"J",L:"K"},
  "ABCDGHJL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"J"},
  "ABCDGHKL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDGIJK":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"G",K:"I",L:"K"},
  "ABCDGIJL":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"I"},
  "ABCDGIKL":{A:"I",B:"G",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDGJKL":{A:"C",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"K"},
  "ABCDHIJK":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ABCDHIJL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ABCDHIKL":{A:"H",B:"I",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDHJKL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCDIJKL":{A:"I",B:"J",D:"B",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ABCEFGHI":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"E",L:"I"},
  "ABCEFGHJ":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"E",L:"J"},
  "ABCEFGHK":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"E",L:"K"},
  "ABCEFGHL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"E"},
  "ABCEFGIJ":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"F",K:"I",L:"J"},
  "ABCEFGIK":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ABCEFGIL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ABCEFGJK":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"F",K:"J",L:"K"},
  "ABCEFGJL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"J"},
  "ABCEFGKL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCEFHIJ":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"E",L:"I"},
  "ABCEFHIK":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ABCEFHIL":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ABCEFHJK":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"E",L:"K"},
  "ABCEFHJL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"L",L:"E"},
  "ABCEFHKL":{A:"H",B:"E",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCEFIJK":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ABCEFIJL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ABCEFIKL":{A:"E",B:"I",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCEFJKL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCEGHIJ":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"G",K:"E",L:"I"},
  "ABCEGHIK":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"H",K:"I",L:"K"},
  "ABCEGHIL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"H",K:"L",L:"I"},
  "ABCEGHJK":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"G",K:"E",L:"K"},
  "ABCEGHJL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"G",K:"L",L:"E"},
  "ABCEGHKL":{A:"E",B:"G",D:"B",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ABCEGIJK":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"G",K:"I",L:"K"},
  "ABCEGIJL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"G",K:"L",L:"I"},
  "ABCEGIKL":{A:"E",B:"G",D:"B",E:"A",G:"I",I:"C",K:"L",L:"K"},
  "ABCEGJKL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"G",K:"L",L:"K"},
  "ABCEHIJK":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"H",K:"I",L:"K"},
  "ABCEHIJL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"H",K:"L",L:"I"},
  "ABCEHIKL":{A:"E",B:"I",D:"B",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ABCEHJKL":{A:"E",B:"J",D:"B",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ABCEIJKL":{A:"E",B:"J",D:"B",E:"A",G:"I",I:"C",K:"L",L:"K"},
  "ABCFGHIJ":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"I",L:"J"},
  "ABCFGHIK":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ABCFGHIL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ABCFGHJK":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"J",L:"K"},
  "ABCFGHJL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"J"},
  "ABCFGHKL":{A:"H",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCFGIJK":{A:"C",B:"J",D:"B",E:"F",G:"A",I:"G",K:"I",L:"K"},
  "ABCFGIJL":{A:"C",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"I"},
  "ABCFGIKL":{A:"I",B:"G",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCFGJKL":{A:"C",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"K"},
  "ABCFHIJK":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ABCFHIJL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ABCFHIKL":{A:"H",B:"I",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCFHJKL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCFIJKL":{A:"I",B:"J",D:"B",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ABCGHIJK":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"G",K:"I",L:"K"},
  "ABCGHIJL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"G",K:"L",L:"I"},
  "ABCGHIKL":{A:"I",B:"G",D:"B",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ABCGHJKL":{A:"H",B:"J",D:"B",E:"C",G:"A",I:"G",K:"L",L:"K"},
  "ABCGIJKL":{A:"I",B:"J",D:"B",E:"C",G:"A",I:"G",K:"L",L:"K"},
  "ABCHIJKL":{A:"I",B:"J",D:"B",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ABDEFGHI":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"E",L:"I"},
  "ABDEFGHJ":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"E",L:"J"},
  "ABDEFGHK":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"E",L:"K"},
  "ABDEFGHL":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"E"},
  "ABDEFGIJ":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"F",K:"I",L:"J"},
  "ABDEFGIK":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABDEFGIL":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABDEFGJK":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"F",K:"J",L:"K"},
  "ABDEFGJL":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"J"},
  "ABDEFGKL":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDEFHIJ":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"F",K:"E",L:"I"},
  "ABDEFHIK":{A:"H",B:"E",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABDEFHIL":{A:"H",B:"E",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABDEFHJK":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"F",K:"E",L:"K"},
  "ABDEFHJL":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"E"},
  "ABDEFHKL":{A:"H",B:"E",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDEFIJK":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABDEFIJL":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABDEFIKL":{A:"E",B:"I",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDEFJKL":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDEGHIJ":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"G",K:"E",L:"I"},
  "ABDEGHIK":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"H",K:"I",L:"K"},
  "ABDEGHIL":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"H",K:"L",L:"I"},
  "ABDEGHJK":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"G",K:"E",L:"K"},
  "ABDEGHJL":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"E"},
  "ABDEGHKL":{A:"E",B:"G",D:"B",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ABDEGIJK":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"G",K:"I",L:"K"},
  "ABDEGIJL":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"I"},
  "ABDEGIKL":{A:"E",B:"G",D:"B",E:"A",G:"I",I:"D",K:"L",L:"K"},
  "ABDEGJKL":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"K"},
  "ABDEHIJK":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"H",K:"I",L:"K"},
  "ABDEHIJL":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"H",K:"L",L:"I"},
  "ABDEHIKL":{A:"E",B:"I",D:"B",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ABDEHJKL":{A:"E",B:"J",D:"B",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ABDEIJKL":{A:"E",B:"J",D:"B",E:"A",G:"I",I:"D",K:"L",L:"K"},
  "ABDFGHIJ":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"I",L:"J"},
  "ABDFGHIK":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABDFGHIL":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABDFGHJK":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"J",L:"K"},
  "ABDFGHJL":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"J"},
  "ABDFGHKL":{A:"H",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDFGIJK":{A:"F",B:"J",D:"B",E:"D",G:"A",I:"G",K:"I",L:"K"},
  "ABDFGIJL":{A:"F",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"I"},
  "ABDFGIKL":{A:"I",B:"G",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDFGJKL":{A:"F",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"K"},
  "ABDFHIJK":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ABDFHIJL":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ABDFHIKL":{A:"H",B:"I",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDFHJKL":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDFIJKL":{A:"I",B:"J",D:"B",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ABDGHIJK":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"G",K:"I",L:"K"},
  "ABDGHIJL":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"I"},
  "ABDGHIKL":{A:"I",B:"G",D:"B",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ABDGHJKL":{A:"H",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"K"},
  "ABDGIJKL":{A:"I",B:"J",D:"B",E:"D",G:"A",I:"G",K:"L",L:"K"},
  "ABDHIJKL":{A:"I",B:"J",D:"B",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ABEFGHIJ":{A:"H",B:"J",D:"B",E:"F",G:"A",I:"G",K:"E",L:"I"},
  "ABEFGHIK":{A:"E",B:"G",D:"B",E:"F",G:"A",I:"H",K:"I",L:"K"},
  "ABEFGHIL":{A:"E",B:"G",D:"B",E:"F",G:"A",I:"H",K:"L",L:"I"},
  "ABEFGHJK":{A:"H",B:"J",D:"B",E:"F",G:"A",I:"G",K:"E",L:"K"},
  "ABEFGHJL":{A:"H",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"E"},
  "ABEFGHKL":{A:"E",B:"G",D:"B",E:"F",G:"A",I:"H",K:"L",L:"K"},
  "ABEFGIJK":{A:"E",B:"J",D:"B",E:"F",G:"A",I:"G",K:"I",L:"K"},
  "ABEFGIJL":{A:"E",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"I"},
  "ABEFGIKL":{A:"E",B:"G",D:"B",E:"A",G:"I",I:"F",K:"L",L:"K"},
  "ABEFGJKL":{A:"E",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"K"},
  "ABEFHIJK":{A:"E",B:"J",D:"B",E:"F",G:"A",I:"H",K:"I",L:"K"},
  "ABEFHIJL":{A:"E",B:"J",D:"B",E:"F",G:"A",I:"H",K:"L",L:"I"},
  "ABEFHIKL":{A:"E",B:"I",D:"B",E:"F",G:"A",I:"H",K:"L",L:"K"},
  "ABEFHJKL":{A:"E",B:"J",D:"B",E:"F",G:"A",I:"H",K:"L",L:"K"},
  "ABEFIJKL":{A:"E",B:"J",D:"B",E:"A",G:"I",I:"F",K:"L",L:"K"},
  "ABEGHIJK":{A:"E",B:"J",D:"B",E:"A",G:"H",I:"G",K:"I",L:"K"},
  "ABEGHIJL":{A:"E",B:"J",D:"B",E:"A",G:"H",I:"G",K:"L",L:"I"},
  "ABEGHIKL":{A:"E",B:"G",D:"B",E:"A",G:"I",I:"H",K:"L",L:"K"},
  "ABEGHJKL":{A:"E",B:"J",D:"B",E:"A",G:"H",I:"G",K:"L",L:"K"},
  "ABEGIJKL":{A:"E",B:"J",D:"B",E:"A",G:"I",I:"G",K:"L",L:"K"},
  "ABEHIJKL":{A:"E",B:"J",D:"B",E:"A",G:"I",I:"H",K:"L",L:"K"},
  "ABFGHIJK":{A:"H",B:"J",D:"B",E:"F",G:"A",I:"G",K:"I",L:"K"},
  "ABFGHIJL":{A:"H",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"I"},
  "ABFGHIKL":{A:"H",B:"G",D:"B",E:"A",G:"I",I:"F",K:"L",L:"K"},
  "ABFGHJKL":{A:"H",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"K"},
  "ABFGIJKL":{A:"I",B:"J",D:"B",E:"F",G:"A",I:"G",K:"L",L:"K"},
  "ABFHIJKL":{A:"H",B:"J",D:"B",E:"A",G:"I",I:"F",K:"L",L:"K"},
  "ABGHIJKL":{A:"H",B:"J",D:"B",E:"A",G:"I",I:"G",K:"L",L:"K"},
  "ACDEFGHI":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"F",K:"D",L:"I"},
  "ACDEFGHJ":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"D",L:"E"},
  "ACDEFGHK":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"F",K:"D",L:"K"},
  "ACDEFGHL":{A:"H",B:"G",D:"F",E:"C",G:"A",I:"D",K:"L",L:"E"},
  "ACDEFGIJ":{A:"C",B:"G",D:"J",E:"D",G:"A",I:"F",K:"E",L:"I"},
  "ACDEFGIK":{A:"C",B:"G",D:"E",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ACDEFGIL":{A:"C",B:"G",D:"E",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ACDEFGJK":{A:"C",B:"G",D:"J",E:"D",G:"A",I:"F",K:"E",L:"K"},
  "ACDEFGJL":{A:"C",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"E"},
  "ACDEFGKL":{A:"C",B:"G",D:"E",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ACDEFHIJ":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"F",K:"D",L:"I"},
  "ACDEFHIK":{A:"H",B:"E",D:"F",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ACDEFHIL":{A:"H",B:"E",D:"F",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ACDEFHJK":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"F",K:"D",L:"K"},
  "ACDEFHJL":{A:"H",B:"J",D:"F",E:"C",G:"A",I:"D",K:"L",L:"E"},
  "ACDEFHKL":{A:"H",B:"E",D:"F",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDEFIJK":{A:"C",B:"J",D:"E",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ACDEFIJL":{A:"C",B:"J",D:"E",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ACDEFIKL":{A:"C",B:"E",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ACDEFJKL":{A:"C",B:"J",D:"E",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ACDEGHIJ":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"D",K:"E",L:"I"},
  "ACDEGHIK":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ACDEGHIL":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ACDEGHJK":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"D",K:"E",L:"K"},
  "ACDEGHJL":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"D",K:"L",L:"E"},
  "ACDEGHKL":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDEGIJK":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ACDEGIJL":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ACDEGIKL":{A:"E",B:"G",D:"I",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDEGJKL":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDEHIJK":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ACDEHIJL":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ACDEHIKL":{A:"H",B:"E",D:"I",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDEHJKL":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDEIJKL":{A:"E",B:"J",D:"I",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDFGHIJ":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"D",L:"I"},
  "ACDFGHIK":{A:"H",B:"G",D:"F",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ACDFGHIL":{A:"H",B:"G",D:"F",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ACDFGHJK":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"D",L:"K"},
  "ACDFGHJL":{A:"C",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"H"},
  "ACDFGHKL":{A:"H",B:"G",D:"F",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDFGIJK":{A:"C",B:"G",D:"J",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ACDFGIJL":{A:"C",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ACDFGIKL":{A:"C",B:"G",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ACDFGJKL":{A:"C",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ACDFHIJK":{A:"H",B:"J",D:"F",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ACDFHIJL":{A:"H",B:"J",D:"F",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ACDFHIKL":{A:"H",B:"F",D:"I",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDFHJKL":{A:"H",B:"J",D:"F",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDFIJKL":{A:"C",B:"J",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ACDGHIJK":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"D",K:"I",L:"K"},
  "ACDGHIJL":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"D",K:"L",L:"I"},
  "ACDGHIKL":{A:"H",B:"G",D:"I",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDGHJKL":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDGIJKL":{A:"I",B:"G",D:"J",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACDHIJKL":{A:"H",B:"J",D:"I",E:"C",G:"A",I:"D",K:"L",L:"K"},
  "ACEFGHIJ":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"E",L:"I"},
  "ACEFGHIK":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ACEFGHIL":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ACEFGHJK":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"E",L:"K"},
  "ACEFGHJL":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"L",L:"E"},
  "ACEFGHKL":{A:"H",B:"G",D:"E",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACEFGIJK":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ACEFGIJL":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ACEFGIKL":{A:"E",B:"G",D:"I",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACEFGJKL":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACEFHIJK":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ACEFHIJL":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ACEFHIKL":{A:"H",B:"E",D:"I",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACEFHJKL":{A:"H",B:"J",D:"E",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACEFIJKL":{A:"E",B:"J",D:"I",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACEGHIJK":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"H",K:"I",L:"K"},
  "ACEGHIJL":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"H",K:"L",L:"I"},
  "ACEGHIKL":{A:"E",B:"G",D:"I",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ACEGHJKL":{A:"E",B:"G",D:"J",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ACEGIJKL":{A:"E",B:"J",D:"I",E:"C",G:"A",I:"G",K:"L",L:"K"},
  "ACEHIJKL":{A:"E",B:"J",D:"I",E:"C",G:"A",I:"H",K:"L",L:"K"},
  "ACFGHIJK":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"I",L:"K"},
  "ACFGHIJL":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"L",L:"I"},
  "ACFGHIKL":{A:"H",B:"G",D:"I",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACFGHJKL":{A:"H",B:"G",D:"J",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACFGIJKL":{A:"I",B:"G",D:"J",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACFHIJKL":{A:"H",B:"J",D:"I",E:"C",G:"A",I:"F",K:"L",L:"K"},
  "ACGHIJKL":{A:"H",B:"J",D:"I",E:"C",G:"A",I:"G",K:"L",L:"K"},
  "ADEFGHIJ":{A:"H",B:"G",D:"J",E:"D",G:"A",I:"F",K:"E",L:"I"},
  "ADEFGHIK":{A:"H",B:"G",D:"E",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ADEFGHIL":{A:"H",B:"G",D:"E",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ADEFGHJK":{A:"H",B:"G",D:"J",E:"D",G:"A",I:"F",K:"E",L:"K"},
  "ADEFGHJL":{A:"H",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"E"},
  "ADEFGHKL":{A:"H",B:"G",D:"E",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADEFGIJK":{A:"E",B:"G",D:"J",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ADEFGIJL":{A:"E",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ADEFGIKL":{A:"E",B:"G",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADEFGJKL":{A:"E",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADEFHIJK":{A:"H",B:"J",D:"E",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ADEFHIJL":{A:"H",B:"J",D:"E",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ADEFHIKL":{A:"H",B:"E",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADEFHJKL":{A:"H",B:"J",D:"E",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADEFIJKL":{A:"E",B:"J",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADEGHIJK":{A:"E",B:"G",D:"J",E:"D",G:"A",I:"H",K:"I",L:"K"},
  "ADEGHIJL":{A:"E",B:"G",D:"J",E:"D",G:"A",I:"H",K:"L",L:"I"},
  "ADEGHIKL":{A:"E",B:"G",D:"I",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ADEGHJKL":{A:"E",B:"G",D:"J",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ADEGIJKL":{A:"E",B:"J",D:"I",E:"D",G:"A",I:"G",K:"L",L:"K"},
  "ADEHIJKL":{A:"E",B:"J",D:"I",E:"D",G:"A",I:"H",K:"L",L:"K"},
  "ADFGHIJK":{A:"H",B:"G",D:"J",E:"D",G:"A",I:"F",K:"I",L:"K"},
  "ADFGHIJL":{A:"H",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"I"},
  "ADFGHIKL":{A:"H",B:"G",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADFGHJKL":{A:"H",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADFGIJKL":{A:"I",B:"G",D:"J",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADFHIJKL":{A:"H",B:"J",D:"I",E:"D",G:"A",I:"F",K:"L",L:"K"},
  "ADGHIJKL":{A:"H",B:"J",D:"I",E:"D",G:"A",I:"G",K:"L",L:"K"},
  "AEFGHIJK":{A:"E",B:"G",D:"J",E:"F",G:"A",I:"H",K:"I",L:"K"},
  "AEFGHIJL":{A:"E",B:"G",D:"J",E:"F",G:"A",I:"H",K:"L",L:"I"},
  "AEFGHIKL":{A:"E",B:"G",D:"I",E:"F",G:"A",I:"H",K:"L",L:"K"},
  "AEFGHJKL":{A:"E",B:"G",D:"J",E:"F",G:"A",I:"H",K:"L",L:"K"},
  "AEFGIJKL":{A:"E",B:"J",D:"I",E:"F",G:"A",I:"G",K:"L",L:"K"},
  "AEFHIJKL":{A:"E",B:"J",D:"I",E:"F",G:"A",I:"H",K:"L",L:"K"},
  "AEGHIJKL":{A:"E",B:"J",D:"I",E:"A",G:"H",I:"G",K:"L",L:"K"},
  "AFGHIJKL":{A:"H",B:"J",D:"I",E:"F",G:"A",I:"G",K:"L",L:"K"},
  "BCDEFGHI":{A:"C",B:"G",D:"B",E:"D",G:"H",I:"F",K:"E",L:"I"},
  "BCDEFGHJ":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"D",L:"E"},
  "BCDEFGHK":{A:"C",B:"G",D:"B",E:"D",G:"H",I:"F",K:"E",L:"K"},
  "BCDEFGHL":{A:"C",B:"G",D:"B",E:"D",G:"H",I:"F",K:"L",L:"E"},
  "BCDEFGIJ":{A:"C",B:"G",D:"B",E:"D",G:"J",I:"F",K:"E",L:"I"},
  "BCDEFGIK":{A:"C",B:"G",D:"B",E:"D",G:"E",I:"F",K:"I",L:"K"},
  "BCDEFGIL":{A:"C",B:"G",D:"B",E:"D",G:"E",I:"F",K:"L",L:"I"},
  "BCDEFGJK":{A:"C",B:"G",D:"B",E:"D",G:"J",I:"F",K:"E",L:"K"},
  "BCDEFGJL":{A:"C",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"E"},
  "BCDEFGKL":{A:"C",B:"G",D:"B",E:"D",G:"E",I:"F",K:"L",L:"K"},
  "BCDEFHIJ":{A:"C",B:"J",D:"B",E:"D",G:"H",I:"F",K:"E",L:"I"},
  "BCDEFHIK":{A:"C",B:"E",D:"B",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "BCDEFHIL":{A:"C",B:"E",D:"B",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "BCDEFHJK":{A:"C",B:"J",D:"B",E:"D",G:"H",I:"F",K:"E",L:"K"},
  "BCDEFHJL":{A:"C",B:"J",D:"B",E:"D",G:"H",I:"F",K:"L",L:"E"},
  "BCDEFHKL":{A:"C",B:"E",D:"B",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "BCDEFIJK":{A:"C",B:"J",D:"B",E:"D",G:"E",I:"F",K:"I",L:"K"},
  "BCDEFIJL":{A:"C",B:"J",D:"B",E:"D",G:"E",I:"F",K:"L",L:"I"},
  "BCDEFIKL":{A:"C",B:"E",D:"B",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "BCDEFJKL":{A:"C",B:"J",D:"B",E:"D",G:"E",I:"F",K:"L",L:"K"},
  "BCDEGHIJ":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"D",K:"E",L:"I"},
  "BCDEGHIK":{A:"E",B:"G",D:"B",E:"C",G:"H",I:"D",K:"I",L:"K"},
  "BCDEGHIL":{A:"E",B:"G",D:"B",E:"C",G:"H",I:"D",K:"L",L:"I"},
  "BCDEGHJK":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"D",K:"E",L:"K"},
  "BCDEGHJL":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"D",K:"L",L:"E"},
  "BCDEGHKL":{A:"E",B:"G",D:"B",E:"C",G:"H",I:"D",K:"L",L:"K"},
  "BCDEGIJK":{A:"E",B:"G",D:"B",E:"C",G:"J",I:"D",K:"I",L:"K"},
  "BCDEGIJL":{A:"E",B:"G",D:"B",E:"C",G:"J",I:"D",K:"L",L:"I"},
  "BCDEGIKL":{A:"E",B:"G",D:"B",E:"C",G:"I",I:"D",K:"L",L:"K"},
  "BCDEGJKL":{A:"E",B:"G",D:"B",E:"C",G:"J",I:"D",K:"L",L:"K"},
  "BCDEHIJK":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"D",K:"I",L:"K"},
  "BCDEHIJL":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"D",K:"L",L:"I"},
  "BCDEHIKL":{A:"E",B:"I",D:"B",E:"C",G:"H",I:"D",K:"L",L:"K"},
  "BCDEHJKL":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"D",K:"L",L:"K"},
  "BCDEIJKL":{A:"E",B:"J",D:"B",E:"C",G:"I",I:"D",K:"L",L:"K"},
  "BCDFGHIJ":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"D",L:"I"},
  "BCDFGHIK":{A:"C",B:"G",D:"B",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "BCDFGHIL":{A:"C",B:"G",D:"B",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "BCDFGHJK":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"D",L:"K"},
  "BCDFGHJL":{A:"C",B:"G",D:"B",E:"D",G:"H",I:"F",K:"L",L:"J"},
  "BCDFGHKL":{A:"C",B:"G",D:"B",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "BCDFGIJK":{A:"C",B:"G",D:"B",E:"D",G:"J",I:"F",K:"I",L:"K"},
  "BCDFGIJL":{A:"C",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"I"},
  "BCDFGIKL":{A:"C",B:"G",D:"B",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "BCDFGJKL":{A:"C",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "BCDFHIJK":{A:"C",B:"J",D:"B",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "BCDFHIJL":{A:"C",B:"J",D:"B",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "BCDFHIKL":{A:"C",B:"I",D:"B",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "BCDFHJKL":{A:"C",B:"J",D:"B",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "BCDFIJKL":{A:"C",B:"J",D:"B",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "BCDGHIJK":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"D",K:"I",L:"K"},
  "BCDGHIJL":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"D",K:"L",L:"I"},
  "BCDGHIKL":{A:"H",B:"G",D:"B",E:"C",G:"I",I:"D",K:"L",L:"K"},
  "BCDGHJKL":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"D",K:"L",L:"K"},
  "BCDGIJKL":{A:"I",B:"G",D:"B",E:"C",G:"J",I:"D",K:"L",L:"K"},
  "BCDHIJKL":{A:"H",B:"J",D:"B",E:"C",G:"I",I:"D",K:"L",L:"K"},
  "BCEFGHIJ":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"E",L:"I"},
  "BCEFGHIK":{A:"E",B:"G",D:"B",E:"C",G:"H",I:"F",K:"I",L:"K"},
  "BCEFGHIL":{A:"E",B:"G",D:"B",E:"C",G:"H",I:"F",K:"L",L:"I"},
  "BCEFGHJK":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"E",L:"K"},
  "BCEFGHJL":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"L",L:"E"},
  "BCEFGHKL":{A:"E",B:"G",D:"B",E:"C",G:"H",I:"F",K:"L",L:"K"},
  "BCEFGIJK":{A:"E",B:"G",D:"B",E:"C",G:"J",I:"F",K:"I",L:"K"},
  "BCEFGIJL":{A:"E",B:"G",D:"B",E:"C",G:"J",I:"F",K:"L",L:"I"},
  "BCEFGIKL":{A:"E",B:"G",D:"B",E:"C",G:"I",I:"F",K:"L",L:"K"},
  "BCEFGJKL":{A:"E",B:"G",D:"B",E:"C",G:"J",I:"F",K:"L",L:"K"},
  "BCEFHIJK":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"F",K:"I",L:"K"},
  "BCEFHIJL":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"F",K:"L",L:"I"},
  "BCEFHIKL":{A:"E",B:"I",D:"B",E:"C",G:"H",I:"F",K:"L",L:"K"},
  "BCEFHJKL":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"F",K:"L",L:"K"},
  "BCEFIJKL":{A:"E",B:"J",D:"B",E:"C",G:"I",I:"F",K:"L",L:"K"},
  "BCEGHIJK":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"G",K:"I",L:"K"},
  "BCEGHIJL":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"G",K:"L",L:"I"},
  "BCEGHIKL":{A:"E",B:"G",D:"B",E:"C",G:"I",I:"H",K:"L",L:"K"},
  "BCEGHJKL":{A:"E",B:"J",D:"B",E:"C",G:"H",I:"G",K:"L",L:"K"},
  "BCEGIJKL":{A:"E",B:"J",D:"B",E:"C",G:"I",I:"G",K:"L",L:"K"},
  "BCEHIJKL":{A:"E",B:"J",D:"B",E:"C",G:"I",I:"H",K:"L",L:"K"},
  "BCFGHIJK":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"I",L:"K"},
  "BCFGHIJL":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"L",L:"I"},
  "BCFGHIKL":{A:"H",B:"G",D:"B",E:"C",G:"I",I:"F",K:"L",L:"K"},
  "BCFGHJKL":{A:"H",B:"G",D:"B",E:"C",G:"J",I:"F",K:"L",L:"K"},
  "BCFGIJKL":{A:"I",B:"G",D:"B",E:"C",G:"J",I:"F",K:"L",L:"K"},
  "BCFHIJKL":{A:"H",B:"J",D:"B",E:"C",G:"I",I:"F",K:"L",L:"K"},
  "BCGHIJKL":{A:"H",B:"J",D:"B",E:"C",G:"I",I:"G",K:"L",L:"K"},
  "BDEFGHIJ":{A:"H",B:"G",D:"B",E:"D",G:"J",I:"F",K:"E",L:"I"},
  "BDEFGHIK":{A:"E",B:"G",D:"B",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "BDEFGHIL":{A:"E",B:"G",D:"B",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "BDEFGHJK":{A:"H",B:"G",D:"B",E:"D",G:"J",I:"F",K:"E",L:"K"},
  "BDEFGHJL":{A:"H",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"E"},
  "BDEFGHKL":{A:"E",B:"G",D:"B",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "BDEFGIJK":{A:"E",B:"G",D:"B",E:"D",G:"J",I:"F",K:"I",L:"K"},
  "BDEFGIJL":{A:"E",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"I"},
  "BDEFGIKL":{A:"E",B:"G",D:"B",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "BDEFGJKL":{A:"E",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "BDEFHIJK":{A:"E",B:"J",D:"B",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "BDEFHIJL":{A:"E",B:"J",D:"B",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "BDEFHIKL":{A:"E",B:"I",D:"B",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "BDEFHJKL":{A:"E",B:"J",D:"B",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "BDEFIJKL":{A:"E",B:"J",D:"B",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "BDEGHIJK":{A:"E",B:"J",D:"B",E:"D",G:"H",I:"G",K:"I",L:"K"},
  "BDEGHIJL":{A:"E",B:"J",D:"B",E:"D",G:"H",I:"G",K:"L",L:"I"},
  "BDEGHIKL":{A:"E",B:"G",D:"B",E:"D",G:"I",I:"H",K:"L",L:"K"},
  "BDEGHJKL":{A:"E",B:"J",D:"B",E:"D",G:"H",I:"G",K:"L",L:"K"},
  "BDEGIJKL":{A:"E",B:"J",D:"B",E:"D",G:"I",I:"G",K:"L",L:"K"},
  "BDEHIJKL":{A:"E",B:"J",D:"B",E:"D",G:"I",I:"H",K:"L",L:"K"},
  "BDFGHIJK":{A:"H",B:"G",D:"B",E:"D",G:"J",I:"F",K:"I",L:"K"},
  "BDFGHIJL":{A:"H",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"I"},
  "BDFGHIKL":{A:"H",B:"G",D:"B",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "BDFGHJKL":{A:"H",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "BDFGIJKL":{A:"I",B:"G",D:"B",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "BDFHIJKL":{A:"H",B:"J",D:"B",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "BDGHIJKL":{A:"H",B:"J",D:"B",E:"D",G:"I",I:"G",K:"L",L:"K"},
  "BEFGHIJK":{A:"E",B:"J",D:"B",E:"F",G:"H",I:"G",K:"I",L:"K"},
  "BEFGHIJL":{A:"E",B:"J",D:"B",E:"F",G:"H",I:"G",K:"L",L:"I"},
  "BEFGHIKL":{A:"E",B:"G",D:"B",E:"F",G:"I",I:"H",K:"L",L:"K"},
  "BEFGHJKL":{A:"E",B:"J",D:"B",E:"F",G:"H",I:"G",K:"L",L:"K"},
  "BEFGIJKL":{A:"E",B:"J",D:"B",E:"F",G:"I",I:"G",K:"L",L:"K"},
  "BEFHIJKL":{A:"E",B:"J",D:"B",E:"F",G:"I",I:"H",K:"L",L:"K"},
  "BEGHIJKL":{A:"E",B:"J",D:"I",E:"B",G:"H",I:"G",K:"L",L:"K"},
  "BFGHIJKL":{A:"H",B:"J",D:"B",E:"F",G:"I",I:"G",K:"L",L:"K"},
  "CDEFGHIJ":{A:"C",B:"G",D:"J",E:"D",G:"H",I:"F",K:"E",L:"I"},
  "CDEFGHIK":{A:"C",B:"G",D:"E",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "CDEFGHIL":{A:"C",B:"G",D:"E",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "CDEFGHJK":{A:"C",B:"G",D:"J",E:"D",G:"H",I:"F",K:"E",L:"K"},
  "CDEFGHJL":{A:"C",B:"G",D:"J",E:"D",G:"H",I:"F",K:"L",L:"E"},
  "CDEFGHKL":{A:"C",B:"G",D:"E",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "CDEFGIJK":{A:"C",B:"G",D:"E",E:"D",G:"J",I:"F",K:"I",L:"K"},
  "CDEFGIJL":{A:"C",B:"G",D:"E",E:"D",G:"J",I:"F",K:"L",L:"I"},
  "CDEFGIKL":{A:"C",B:"G",D:"E",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "CDEFGJKL":{A:"C",B:"G",D:"E",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "CDEFHIJK":{A:"C",B:"J",D:"E",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "CDEFHIJL":{A:"C",B:"J",D:"E",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "CDEFHIKL":{A:"C",B:"E",D:"I",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "CDEFHJKL":{A:"C",B:"J",D:"E",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "CDEFIJKL":{A:"C",B:"J",D:"E",E:"D",G:"I",I:"F",K:"L",L:"K"},
  "CDEGHIJK":{A:"E",B:"G",D:"J",E:"C",G:"H",I:"D",K:"I",L:"K"},
  "CDEGHIJL":{A:"E",B:"G",D:"J",E:"C",G:"H",I:"D",K:"L",L:"I"},
  "CDEGHIKL":{A:"E",B:"G",D:"I",E:"C",G:"H",I:"D",K:"L",L:"K"},
  "CDEGHJKL":{A:"E",B:"G",D:"J",E:"C",G:"H",I:"D",K:"L",L:"K"},
  "CDEGIJKL":{A:"E",B:"G",D:"I",E:"C",G:"J",I:"D",K:"L",L:"K"},
  "CDEHIJKL":{A:"E",B:"J",D:"I",E:"C",G:"H",I:"D",K:"L",L:"K"},
  "CDFGHIJK":{A:"C",B:"G",D:"J",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "CDFGHIJL":{A:"C",B:"G",D:"J",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "CDFGHIKL":{A:"C",B:"G",D:"I",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "CDFGHJKL":{A:"C",B:"G",D:"J",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "CDFGIJKL":{A:"C",B:"G",D:"I",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "CDFHIJKL":{A:"C",B:"J",D:"I",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "CDGHIJKL":{A:"H",B:"G",D:"I",E:"C",G:"J",I:"D",K:"L",L:"K"},
  "CEFGHIJK":{A:"E",B:"G",D:"J",E:"C",G:"H",I:"F",K:"I",L:"K"},
  "CEFGHIJL":{A:"E",B:"G",D:"J",E:"C",G:"H",I:"F",K:"L",L:"I"},
  "CEFGHIKL":{A:"E",B:"G",D:"I",E:"C",G:"H",I:"F",K:"L",L:"K"},
  "CEFGHJKL":{A:"E",B:"G",D:"J",E:"C",G:"H",I:"F",K:"L",L:"K"},
  "CEFGIJKL":{A:"E",B:"G",D:"I",E:"C",G:"J",I:"F",K:"L",L:"K"},
  "CEFHIJKL":{A:"E",B:"J",D:"I",E:"C",G:"H",I:"F",K:"L",L:"K"},
  "CEGHIJKL":{A:"E",B:"J",D:"I",E:"C",G:"H",I:"G",K:"L",L:"K"},
  "CFGHIJKL":{A:"H",B:"G",D:"I",E:"C",G:"J",I:"F",K:"L",L:"K"},
  "DEFGHIJK":{A:"E",B:"G",D:"J",E:"D",G:"H",I:"F",K:"I",L:"K"},
  "DEFGHIJL":{A:"E",B:"G",D:"J",E:"D",G:"H",I:"F",K:"L",L:"I"},
  "DEFGHIKL":{A:"E",B:"G",D:"I",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "DEFGHJKL":{A:"E",B:"G",D:"J",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "DEFGIJKL":{A:"E",B:"G",D:"I",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "DEFHIJKL":{A:"E",B:"J",D:"I",E:"D",G:"H",I:"F",K:"L",L:"K"},
  "DEGHIJKL":{A:"E",B:"J",D:"I",E:"D",G:"H",I:"G",K:"L",L:"K"},
  "DFGHIJKL":{A:"H",B:"G",D:"I",E:"D",G:"J",I:"F",K:"L",L:"K"},
  "EFGHIJKL":{A:"E",B:"J",D:"I",E:"F",G:"H",I:"G",K:"L",L:"K"}
};
function round32Assignments(customResults=null){
  const {positions} = groupPositionMap(customResults);
  const slots = {};
  // Build combination key from best 8 thirds' source groups
  const best8 = thirdPlaceRanking(customResults).slice(0,8);
  const qualifiedGroups = best8.map(t => t.sourceGroup).sort().join('');
  const tableRow = THIRDS_TABLE[qualifiedGroups] || null;
  const r32 = matches.filter(m=>Number(m.stageId)===2).sort((a,b)=>a.matchNumber-b.matchNumber);
  // Greedy fallback tracker (used when table not available yet)
  const usedThirds = new Set();
  r32.forEach(m => {
    const parts = String(m.label || '').split(/\s+vs\s+/i);
    ['home','away'].forEach((side, idx) => {
      const raw = (parts[idx] || '').trim();
      let team = null;
      if(/^3[A-L]+$/.test(raw.replace(/\s+/g,''))){
        if(tableRow){
          // Official Annex C lookup: find group winner letter from the other slot
          const otherRaw = (parts[1 - idx] || '').trim();
          const wm = otherRaw.match(/^1([A-L])$/);
          if(wm){
            const assignedGroup = tableRow[wm[1]];
            const key = `3${assignedGroup}`;
            team = positions[key] ? cloneTeam(positions[key], key) : cloneTeam(null, raw);
          }
        }
        if(!team){
          // Fallback: greedy best available from eligible groups
          for(const cand of parseSlotCandidates(raw)){
            if(positions[cand] && !usedThirds.has(cand)){ team = positions[cand]; usedThirds.add(cand); break; }
          }
          if(!team) team = cloneTeam(null, raw);
        }
      } else {
        team = positions[raw] ? cloneTeam(positions[raw], raw) : cloneTeam(null, raw);
      }
      slots[`${m.id}_${side}`] = team;
    });
  });
  return slots;
}
function winnerOfMatch(matchId, customResults=null, memo={}){
  const id = Number(matchId);
  if(memo[id]) return memo[id];
  memo.__stack = memo.__stack || new Set();
  if(memo.__stack.has(id)) return cloneTeam(null, `W${id}`);
  memo.__stack.add(id);
  const m = matches.find(x=>Number(x.id)===id || Number(x.matchNumber)===id);
  if(!m){ memo.__stack.delete(id); return cloneTeam(null, `W${id}`); }
  const resolvedTeams = resolvedTeamsForMatch(m, customResults, memo);
  const res = (customResults || state.results)[m.id];
  let winner;
  if(hasScore(res)){
    if(res.h > res.a) winner = {...resolvedTeams.home, slot:`W${m.matchNumber}`};
    else if(res.a > res.h) winner = {...resolvedTeams.away, slot:`W${m.matchNumber}`};
    else winner = cloneTeam(null, `W${m.matchNumber}`);
  } else {
    winner = cloneTeam(null, `W${m.matchNumber}`);
  }
  memo.__stack.delete(id);
  memo[id] = winner;
  return winner;
}
function loserOfMatch(matchId, customResults=null, memo={}){
  const id = Number(matchId);
  memo.__stack = memo.__stack || new Set();
  if(memo.__stack.has(id)) return cloneTeam(null, `RU${id}`);
  memo.__stack.add(id);
  const m = matches.find(x=>Number(x.id)===id || Number(x.matchNumber)===id);
  if(!m){ memo.__stack.delete(id); return cloneTeam(null, `RU${id}`); }
  const resolvedTeams = resolvedTeamsForMatch(m, customResults, memo);
  const res = (customResults || state.results)[m.id];
  let loser = cloneTeam(null, `RU${m.matchNumber}`);
  if(hasScore(res)){
    if(res.h > res.a) loser = {...resolvedTeams.away, slot:`RU${m.matchNumber}`};
    else if(res.a > res.h) loser = {...resolvedTeams.home, slot:`RU${m.matchNumber}`};
  }
  memo.__stack.delete(id);
  return loser;
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
  const exact = home && away ? 1 : 0;
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
    <div class="section-head"><div><p class="eyebrow">Panel general · V5.5.7</p><h2>Dashboard avanzado</h2></div><span class="status-chip">${sb ? 'Modo grupo · Supabase' : 'Modo local'}</span></div>
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
  const rows = rankingRows().slice(0,6);
  if(!rows.length) return `<p class="muted">Aún no hay participantes.</p>`;
  return `<div class="mini-list">${rows.map((r,i)=>`<div><b>${['🥇','🥈','🥉'][i] || '#'+(i+1)} ${esc(r.name)}</b><span>${r.pts} pts</span></div>`).join('')}</div>`;
}

function teamLine(t){ return `<span class="team-line">${flagHtml(t)}<b>${esc(t.name)}</b><small>${esc(t.code)}</small></span>`; }
function matchCard(m){
  const r = state.results[m.id];
  const t = resolvedTeamsForMatch(m);
  return `<article class="match-card">
    <div class="match-top"><span>#${m.matchNumber}</span><span>${stageES(m.stage)}</span></div>
    <div class="teams-vs"><div>${flagHtml(t.home)}<b>${esc(t.home.name)}</b></div><span>VS</span><div>${flagHtml(t.away)}<b>${esc(t.away.name)}</b></div></div>
    <div class="match-meta"><span>🗓️ ${m.dateCR}</span><span>🕒 ${m.timeCR} CR</span><span>🏟️ ${esc(m.venue)}</span><span>📍 ${esc(m.city)}</span></div>
    <div class="result ${hasScore(r)?'done':'pending'}">${hasScore(r) ? `${r.h} - ${r.a}` : '⏳ Pendiente'}</div>
  </article>`;
}
function calendarDates(){
  return [...new Set(matches.map(m=>m.dateCR).filter(Boolean))].sort((a,b)=>parseCRDate(a)-parseCRDate(b));
}
function calendarToolbar(){
  const dates = calendarDates();
  const today = todayCR();
  const hasToday = dates.includes(today);
  const options = [
    `<option value="all" ${calendarDateFilter==='all'?'selected':''}>Todos los partidos</option>`,
    ...dates.map(d=>`<option value="${esc(d)}" ${calendarDateFilter===d?'selected':''}>${esc(formatDateLabel(d))} · ${esc(d)}</option>`)
  ].join('');
  return `<div class="prediction-filter card cal-filter">
    <div class="prediction-filter__title"><span>📅</span><div><small>Filtrar por fecha</small><b>${calendarDateFilter==='all'?'Todos los partidos':esc(formatDateLabel(calendarDateFilter))}</b></div></div>
    <select id="calendarDateSelect">${options}</select>
    <button type="button" class="filter-today ${hasToday?'':'is-disabled'}" id="calendarToday" ${hasToday?'':'disabled'}>Hoy</button>
    <button type="button" class="filter-all" id="calendarAll">Ver todos</button>
    <button type="button" class="copy-preds-btn" id="copyCalendarDay">📋 Copiar día</button>
  </div>`;
}
function copyCalendarDay(){
  const f = calendarDateFilter;
  const src = f === 'all' ? todayCR() : f;
  const day = matches.filter(m=>m.dateCR===src).sort((a,b)=>a.matchNumber-b.matchNumber);
  if(!day.length){ toast('No hay partidos para copiar.','err'); return; }
  const label = formatDateLabel(src);
  const lines = [`⚽ Partidos · ${label}`, ''];
  day.forEach(m=>{
    const t = resolvedTeamsForMatch(m);
    const r = state.results[m.id];
    const hf = teamFlagEmoji(t.home), af = teamFlagEmoji(t.away);
    const score = hasScore(r) ? `${r.h} - ${r.a}` : m.timeCR+' CR';
    lines.push(`#${m.matchNumber} · ${hf} ${t.home.name}  ${score}  ${t.away.name} ${af}`);
  });
  navigator.clipboard.writeText(lines.join('\n'))
    .then(()=>toast('Partidos copiados al portapapeles 📋'))
    .catch(()=>toast('No se pudo copiar.','err'));
}
function renderCalendar(){
  const groups = groupLetters();
  const koStages = [
    {id:2,label:'Dieciseisavos de final'},{id:3,label:'Octavos de final'},
    {id:4,label:'Cuartos de final'},{id:5,label:'Semifinales'},
    {id:6,label:'Tercer lugar'},{id:7,label:'Final'},
  ];

  let content;
  if(calendarDateFilter !== 'all'){
    const day = matches.filter(m=>m.dateCR===calendarDateFilter).sort((a,b)=>a.matchNumber-b.matchNumber);
    content = day.length
      ? `<div class="prediction-date-summary"><b>${day.length}</b> partido${day.length!==1?'s':''} el ${esc(calendarDateFilter)}</div>
         <div class="match-grid">${day.map(matchCard).join('')}</div>`
      : `<p class="muted" style="padding:20px 4px">No hay partidos en esta fecha.</p>`;
  } else {
    const koCards = koStages.map(s=>{
      const ms = matches.filter(m=>Number(m.stageId)===s.id).sort((a,b)=>a.matchNumber-b.matchNumber);
      return ms.length ? `<div class="card"><div class="group-title"><h3>${s.label}</h3><span>${ms.length} partido${ms.length>1?'s':''}</span></div><div class="match-grid">${ms.map(matchCard).join('')}</div></div>` : '';
    }).join('');
    content = `
      ${groups.map(g=>`<div class="card"><div class="group-title"><h3>Grupo ${g}</h3><span>${groupMatches(g).length} partidos</span></div><div class="match-grid">${groupMatches(g).map(matchCard).join('')}</div></div>`).join('')}
      <div class="section-head" style="margin-top:20px"><div><p class="eyebrow">Fase final</p><h2>Eliminatorias</h2></div></div>
      ${koCards}`;
  }

  $('calendar').innerHTML = `
    <div class="section-head"><div><p class="eyebrow">Todos los horarios en Costa Rica</p><h2>Calendario</h2></div><span class="status-chip">${matches.length} partidos</span></div>
    ${calendarToolbar()}
    ${content}`;

  $('calendarDateSelect').onchange = e=>{ calendarDateFilter=e.target.value; renderCalendar(); };
  $('calendarToday').onclick = ()=>{ if($('calendarToday').disabled) return; calendarDateFilter=todayCR(); renderCalendar(); };
  $('calendarAll').onclick = ()=>{ calendarDateFilter='all'; renderCalendar(); };
  $('copyCalendarDay').onclick = copyCalendarDay;
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
  return `<div class="player-picker"><span>Jugador</span><select id="${id}">${state.participants.map(p=>`<option value="${p.id}" ${p.id===currentParticipant?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>`;
}
function predictionPointsBadge(m){
  const pred = state.predictions[key(currentParticipant,m.id)];
  const res = state.results[m.id];
  const s = scoreBreakdown(pred,res);
  const detail = hasScore(res) ? `${s.total}/4 pts · G:${s.winner} Local:${s.home} Visita:${s.away} Exacto:${s.exact}` : 'Pendiente de resultado oficial';
  const cls = !hasScore(res) ? 'pending' : (s.total >= 4 ? 'perfect' : (s.total > 0 ? 'scored' : 'zero'));
  return `<div class="points-panel ${cls}"><span>Puntos</span><b>${hasScore(res) ? s.total : '—'}</b><small>${detail}</small></div>`;
}
function inputMatchRow(m,type){
  const pid = currentParticipant;
  const v = type === 'real' ? state.results[m.id] || {} : state.predictions[key(pid,m.id)] || {};
  const points = type === 'pred' ? predictionPointsBadge(m) : '';
  // Para eliminatorias: resolver los equipos reales según resultados ya cargados
  const teams = resolvedTeamsForMatch(m);
  return `<article class="input-row ${type === 'pred' ? 'prediction-row' : ''}">
    <div class="match-index"><b>#${m.matchNumber}</b><small>${m.dateCR} · ${m.timeCR} CR</small></div>
    <label>${flagHtml(teams.home)} ${esc(teams.home.name)}<input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="h" value="${v.h ?? ''}"></label>
    <span class="vs-small">-</span>
    <label>${flagHtml(teams.away)} ${esc(teams.away.name)}<input type="number" min="0" inputmode="numeric" data-type="${type}" data-mid="${m.id}" data-side="a" value="${v.a ?? ''}"></label>
    ${points}
  </article>`;
}
function predictionProgress(pid){
  const total = matches.length;
  const done = matches.filter(m => hasScore(state.predictions[key(pid,m.id)])).length;
  return {done,total,pct: total ? Math.round(done/total*100) : 0};
}
// Convierte código FIFA → emoji de bandera vía ISO 3166-1 alpha-2
function teamFlagEmoji(t){
  const FIFA_TO_ISO2 = {
    MEX:'MX', RSA:'ZA', KOR:'KR', CZE:'CZ', CAN:'CA', BIH:'BA', QAT:'QA',
    SUI:'CH', BRA:'BR', MAR:'MA', HAI:'HT', SCO:'GB', USA:'US', PAR:'PY',
    AUS:'AU', TUR:'TR', GER:'DE', CUR:'CW', CIV:'CI', ECU:'EC', NED:'NL',
    JPN:'JP', SWE:'SE', TUN:'TN', BEL:'BE', EGY:'EG', IRN:'IR', NZL:'NZ',
    ESP:'ES', CPV:'CV', KSA:'SA', URU:'UY', FRA:'FR', SEN:'SN', IRQ:'IQ',
    NOR:'NO', ARG:'AR', ALG:'DZ', AUT:'AT', JOR:'JO', POR:'PT', COD:'CD',
    UZB:'UZ', COL:'CO', ENG:'GB', CRO:'HR', GHA:'GH', PAN:'PA',
  };
  const iso2 = FIFA_TO_ISO2[t?.code || ''];
  if(!iso2) return '';
  // Regional Indicator: offset = 0x1F1E6 - 65
  return [...iso2.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)).join('');
}

function copyPredictionsToClipboard(){
  const pid = currentParticipant;
  const pName = state.participants.find(p=>p.id===pid)?.name || 'Jugador';
  const filtered = predictionDateFilter === 'all'
    ? matches.filter(m => hasScore(state.predictions[key(pid, m.id)]))
    : matches.filter(m => m.dateCR === predictionDateFilter);
  if(!filtered.length){ toast('No hay partidos para copiar.','err'); return; }
  const dateLabel = predictionDateFilter === 'all'
    ? 'todos los partidos'
    : formatDateLabel(predictionDateFilter);
  const lines = [`🎯 Pronósticos de ${pName} · ${dateLabel}`, ''];
  filtered.forEach(m => {
    const t = resolvedTeamsForMatch(m);
    const pred = state.predictions[key(pid, m.id)];
    const homeFlag = teamFlagEmoji(t.home);
    const awayFlag = teamFlagEmoji(t.away);
    const score = hasScore(pred) ? `${pred.h} - ${pred.a}` : '? - ?';
    lines.push(`#${m.matchNumber} · ${homeFlag} ${t.home.name}  ${score}  ${t.away.name} ${awayFlag}`);
  });
  navigator.clipboard.writeText(lines.join('\n'))
    .then(()  => toast('Pronósticos copiados al portapapeles 📋'))
    .catch(()  => toast('No se pudo copiar.','err'));
}

function renderPredictions(){
  if(!state.participants.length){ $('predictions').innerHTML = `<div class="card empty"><h2>Primero agrega participantes</h2><p class="muted">Ve a Admin y crea al menos un participante.</p></div>`; return; }
  const p = predictionProgress(currentParticipant);
  const filteredMatches = predictionDateFilter === 'all'
    ? matches
    : matches.filter(m => m.dateCR === predictionDateFilter);
  $('predictions').innerHTML = `<div class="section-head predictions-head"><div><p class="eyebrow">Ordenado por número de partido</p><h2>Mis Pronósticos</h2><p class="muted">Selecciona el jugador, filtra por fecha, completa marcadores y guarda desde el botón superior.</p></div>${participantOptions('participantSelect')}</div>
    ${predictionDateToolbar()}
    <div class="card progress-card"><div class="progress-head"><b>${p.done}/${p.total} completados</b><span>${p.pct}%</span></div><div class="progress"><i style="width:${p.pct}%"></i></div></div>
    <div class="prediction-date-summary"><b>${filteredMatches.length}</b> partido${filteredMatches.length===1?'':'s'} ${predictionDateFilter==='all'?'en total':`el ${esc(predictionDateFilter)}`}<button type="button" id="copyPredictions" class="copy-preds-btn">📋 Copiar pronósticos</button></div>
    <div class="card input-list predictions-list">${filteredMatches.length ? filteredMatches.map(m=>inputMatchRow(m,'pred')).join('') : '<div class="empty"><h3>No hay partidos en esta fecha</h3><p class="muted">Selecciona otra fecha o vuelve a ver todos.</p></div>'}</div>
    <button type="button" class="primary fixed-action" id="savePredictions">💾 Guardar pronósticos</button>`;
  $('participantSelect').onchange = e => { syncVisiblePredictionInputsToState(); currentParticipant = e.target.value; renderPredictions(); };
  $('predictionDateSelect').onchange = e => { syncVisiblePredictionInputsToState(); predictionDateFilter = e.target.value; renderPredictions(); };
  $('predictionToday').onclick = () => { if($('predictionToday').disabled) return; syncVisiblePredictionInputsToState(); predictionDateFilter = todayCR(); renderPredictions(); };
  $('predictionAll').onclick = () => { syncVisiblePredictionInputsToState(); predictionDateFilter = 'all'; renderPredictions(); };
  $('savePredictions').onclick = savePredictions;
  $('copyPredictions').onclick = copyPredictionsToClipboard;
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

async function callScoreApi(mode){
  if(!sb) return toast('La sincronización requiere Supabase configurado.', 'err');
  const pin = $('adminPin')?.value || sessionStorage.getItem('adminPin') || prompt('PIN administrador');
  if(!pin) return;
  sessionStorage.setItem('adminPin', pin);
  const forceManual = Boolean($('forceManualSync')?.checked);
  if(mode === 'apply'){
    const warning = forceManual
      ? 'Esto sobrescribirá también resultados marcados como corrección manual. ¿Continuar?'
      : 'Se actualizarán únicamente partidos terminados y sin corrección manual. ¿Continuar?';
    if(!confirm(warning)) return;
  }
  const output = $('syncApiOutput');
  const buttons = [$('testScoreApi'), $('applyScoreApi')].filter(Boolean);
  buttons.forEach(b=>b.disabled=true);
  if(output) output.textContent = mode === 'preview' ? 'Consultando API y validando 104 partidos…' : 'Sincronizando resultados…';
  try{
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    if(!base) throw new Error('Falta supabaseUrl en config.js');
    const headers = {'Content-Type':'application/json'};
    if(cfg.supabaseAnonKey){
      headers.apikey = cfg.supabaseAnonKey;
      headers.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
    }
    const response = await fetch(`${base}/functions/v1/sync-worldcup-results`, {
      method:'POST', headers,
      body:JSON.stringify({mode, adminPin:pin, forceManual})
    });
    const text = await response.text();
    let data;
    try{ data = JSON.parse(text); } catch{ data = {ok:false, error:text || `HTTP ${response.status}`}; }
    if(output) output.textContent = JSON.stringify(data, null, 2);
    if(!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if(mode === 'apply'){
      await loadRemote();
      toast(data.note || 'Sincronización completada ✓');
      renderAll();
    }
  }catch(error){
    const message = error?.message || String(error);
    if(output && !output.textContent.includes(message)) output.textContent += `

ERROR: ${message}`;
    toast(`Error: ${message}`, 'err', 5000);
  }finally{
    buttons.forEach(b=>b.disabled=false);
  }
}

function renderAdmin(){
  $('admin').innerHTML = `<div class="section-head"><div><p class="eyebrow">Administración</p><h2>Panel Admin</h2></div></div>
    <div class="grid two"><div class="card"><h3>Participantes</h3><div class="admin-line"><input id="playerName" placeholder="Nombre del participante"><button id="addPlayer" class="primary">Agregar</button></div><div class="mini-list">${state.participants.map(p=>`<div><b>${esc(p.name)}</b><button class="danger" data-del="${p.id}">Eliminar</button></div>`).join('') || '<p class="muted">Sin participantes.</p>'}</div></div>
    <div class="card"><h3>Exportar</h3><button id="exportExcel" class="primary">Exportar Excel</button></div></div>
    <div class="card api-sync-card">
      <div class="section-head compact"><div><p class="eyebrow">Fuente automática</p><h3>Marcadores WorldCup26 API</h3></div><span class="status-chip">Prueba antes de aplicar</span></div>
      <p class="muted">La vista previa consulta <code>/get/games</code>, valida los IDs 1–104 y compara los equipos. No modifica datos. Aplicar solo guarda partidos terminados.</p>
      <div class="api-sync-actions">
        <button id="testScoreApi" class="secondary">🔎 Probar API</button>
        <button id="applyScoreApi" class="primary">↻ Sincronizar resultados</button>
        <label class="force-sync"><input id="forceManualSync" type="checkbox"> Sobrescribir correcciones manuales</label>
      </div>
      <pre id="syncApiOutput" class="sync-output">Todavía no se ha ejecutado una prueba.</pre>
    </div>
    <div class="card"><h3>Resultados oficiales</h3><p class="muted">Ordenados por número de partido. Los cambios manuales quedan protegidos frente a la API.</p><input id="adminPin" class="pin" placeholder="PIN administrador" type="password" value="${sessionStorage.getItem('adminPin')||''}"> <div class="input-list">${matches.map(m=>inputMatchRow(m,'real')).join('')}</div><button class="primary fixed-action" id="saveResults">Guardar resultados</button></div>`;
  $('addPlayer').onclick = addParticipant;
  $('saveResults').onclick = saveResults;
  $('exportExcel').onclick = exportExcel;
  $('testScoreApi').onclick = () => callScoreApi('preview');
  $('applyScoreApi').onclick = () => callScoreApi('apply');
  qsa('[data-del]').forEach(b=>b.onclick=()=>delParticipant(b.dataset.del));
}
async function addParticipant(){
  const name = $('playerName').value.trim(); if(!name) return;
  if(sb){ const {data,error}=await sb.from('participants').insert({name}).select().single(); if(error) return toast(error.message,'err'); state.participants.push({id:data.id,name:data.name}); }
  else { state.participants.push({id:crypto.randomUUID(),name}); store(); }
  currentParticipant = state.participants.at(-1).id; renderAll();
}
async function delParticipant(id){
  if(!confirm('¿Eliminar participante y sus pronósticos?')) return;
  if(sb){
    const admin_pin = $('adminPin')?.value || sessionStorage.getItem('adminPin') || prompt('PIN administrador'); if(!admin_pin) return;
    sessionStorage.setItem('adminPin', admin_pin);
    const {error} = await sb.rpc('admin_delete_participant', {admin_pin, participant:id}); if(error) return toast(error.message,'err'); await loadRemote();
  } else {
    state.participants = state.participants.filter(p=>p.id!==id);
    Object.keys(state.predictions).forEach(k=>{ if(k.startsWith(id+'_')) delete state.predictions[k]; }); store();
  }
  currentParticipant = state.participants[0]?.id || ''; renderAll();
}
async function savePredictions(){
  const pid = currentParticipant; if(!pid) return toast('Selecciona un participante.','err');
  qsa('input[data-type="pred"]').forEach(i => { const k=key(pid,i.dataset.mid); state.predictions[k]=state.predictions[k]||{}; state.predictions[k][i.dataset.side]=val(i.value); });
  if(sb){
    const rows = matches.map(m=>({participant_id:pid, match_id:m.id, home_goals:state.predictions[key(pid,m.id)]?.h, away_goals:state.predictions[key(pid,m.id)]?.a, updated_at:new Date().toISOString()}));
    const {error}=await sb.from('predictions').upsert(rows,{onConflict:'participant_id,match_id'}); if(error) return toast(error.message,'err');
  } else store();
  toast('Pronósticos guardados ✓');
  // Actualiza solo la barra de progreso — NO re-renderiza los inputs para no perder los valores
  const p = predictionProgress(pid);
  const card = document.querySelector('#predictions .progress-card');
  if(card) card.innerHTML = `<div class="progress-head"><b>${p.done}/${p.total} completados</b><span>${p.pct}%</span></div><div class="progress"><i style="width:${p.pct}%"></i></div>`;
}
async function saveResults(){
  qsa('input[data-type="real"]').forEach(i => { state.results[i.dataset.mid]=state.results[i.dataset.mid]||{}; state.results[i.dataset.mid][i.dataset.side]=val(i.value); });
  if(sb){
    const admin_pin = $('adminPin')?.value || sessionStorage.getItem('adminPin') || prompt('PIN administrador'); if(!admin_pin) return;
    sessionStorage.setItem('adminPin', admin_pin);
    const payload = Object.entries(state.results).map(([mid,r])=>({match_id:Number(mid), home_goals:r.h, away_goals:r.a}));
    const {error}=await sb.rpc('admin_upsert_results', {admin_pin, payload}); if(error) return toast(error.message,'err'); await loadRemote();
  } else store();
  toast('Resultados guardados ✓'); renderAll();
}
function exportExcel(){
  const wb = XLSX.utils.book_new();

  // Hoja 1: Participantes
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.participants), 'Participantes');

  // Hoja 2: Partidos
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matches.map(m=>{const t=resolvedTeamsForMatch(m);return {No:m.matchNumber, Fase:stageES(m.stage), Grupo:m.group||'', Fecha:m.dateCR, HoraCR:m.timeCR, Local:t.home.name, Visitante:t.away.name, RealLocal:state.results[m.id]?.h??'', RealVisitante:state.results[m.id]?.a??''};})), 'Partidos');

  // Hoja 3: Grupos
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groupLetters().flatMap(g=>standingsForGroup(g).map((r,i)=>({Grupo:g, Pos:i+1, Equipo:r.name, PJ:r.pj, G:r.g, E:r.e, P:r.p, GF:r.gf, GC:r.gc, DG:r.dg, PTS:r.pts})))), 'Grupos');

  // Hoja 4: Ranking
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rankingRows().map((r,i)=>({Pos:i+1, Jugador:state.participants.find(p=>p.id===r.id)?.name||r.id, Puntos:r.pts, Exactos:r.exact, Ganadores:r.winner, Pronosticados:r.predicted}))), 'Ranking');

  // Hoja 5: Comparativa — pronósticos y puntos por partido y jugador
  const parts = state.participants;
  const compRows = matches.map(m => {
    const res = state.results[m.id];
    const teams = resolvedTeamsForMatch(m);
    const row = {
      '#': m.matchNumber,
      Fase: stageES(m.stage),
      Grupo: m.group || '',
      Fecha: m.dateCR,
      Local: teams.home.name,
      Visitante: teams.away.name,
      Resultado: hasScore(res) ? `${res.h}-${res.a}` : '',
    };
    parts.forEach(p => {
      const pred = state.predictions[key(p.id, m.id)];
      const predStr = hasScore(pred) ? `${pred.h}-${pred.a}` : '';
      const s = scoreBreakdown(pred, res);
      row[`${p.name}_Pronóstico`] = predStr;
      row[`${p.name}_Pts`] = hasScore(pred) && hasScore(res) ? s.total : '';
    });
    return row;
  });
  // Fila de totales al final
  const totals = { '#':'', Fase:'TOTAL', Grupo:'', Fecha:'', Local:'', Visitante:'', Resultado:'' };
  parts.forEach(p => {
    totals[`${p.name}_Pronóstico`] = '';
    totals[`${p.name}_Pts`] = rankingRows().find(r=>r.id===p.id)?.pts ?? '';
  });
  compRows.push(totals);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compRows), 'Comparativa');

  XLSX.writeFile(wb, 'quiniela_mundial_2026.xlsx');
}
function comparisonFilteredMatches(){
  if(comparisonFilter === 'all')      return matches;
  if(comparisonFilter === 'group')    return matches.filter(m => Number(m.stageId) === 1);
  if(comparisonFilter === 'knockout') return matches.filter(m => Number(m.stageId) > 1);
  return matches.filter(m => Number(m.stageId) === 1 && m.group === comparisonFilter);
}
function renderComparison(){
  if(!state.participants.length){
    $('comparison').innerHTML = `<div class="card empty"><h2>Tabla comparativa</h2><p class="muted">Agrega participantes en Admin para ver los pronósticos comparados.</p></div>`;
    return;
  }
  const fms = comparisonFilteredMatches();
  const totals = state.participants.map(p =>
    fms.reduce((s,m) => s + scoreBreakdown(state.predictions[key(p.id,m.id)], state.results[m.id]).total, 0)
  );
  const filterDefs = [
    {id:'all', label:'Todos'},
    {id:'group', label:'Fase grupos'},
    {id:'knockout', label:'Eliminatorias'},
    ...groupLetters().map(g => ({id:g, label:`Grp ${g}`}))
  ];
  const filterBar = `<div class="cmp-filter-bar">${filterDefs.map(f =>
    `<button type="button" class="cmp-filter-btn${comparisonFilter===f.id?' active':''}" data-cmpfilter="${f.id}">${esc(f.label)}</button>`
  ).join('')}</div>`;

  const thead = `<thead><tr>
    <th class="cmp-th-match">Partido</th>
    <th class="cmp-th-real">Resultado</th>
    ${state.participants.map(p=>`<th class="cmp-th-pred">${esc(p.name)}</th>`).join('')}
  </tr></thead>`;

  const tbody = `<tbody>${fms.map(m => {
    const res = state.results[m.id];
    const scored = hasScore(res);
    const t = resolvedTeamsForMatch(m);
    const cells = state.participants.map(p => {
      const pred = state.predictions[key(p.id, m.id)];
      const s = scoreBreakdown(pred, res);
      if(!hasScore(pred))   return `<td class="cmp-cell cmp-nopred"><span class="cmp-dash">—</span></td>`;
      if(!scored)           return `<td class="cmp-cell cmp-wait"><b>${pred.h}-${pred.a}</b></td>`;
      if(s.total >= 4)      return `<td class="cmp-cell cmp-perfect"><b>${pred.h}-${pred.a}</b><small>4pts</small></td>`;
      if(s.winner > 0)      return `<td class="cmp-cell cmp-scored"><b>${pred.h}-${pred.a}</b><small>${s.total}pt${s.total!==1?'s':''}</small></td>`;
      if(s.total > 0)       return `<td class="cmp-cell cmp-partial"><b>${pred.h}-${pred.a}</b><small>${s.total}pt${s.total!==1?'s':''}</small></td>`;
      return                       `<td class="cmp-cell cmp-zero"><b>${pred.h}-${pred.a}</b><small>0pts</small></td>`;
    }).join('');
    return `<tr>
      <td class="cmp-match-cell">
        <span class="cmp-num">#${m.matchNumber}</span>
        <span class="cmp-teams-line">${flagHtml(t.home)}<b>${esc(t.home.name)}</b><i class="cmp-vs">vs</i>${flagHtml(t.away)}<b>${esc(t.away.name)}</b></span>
        <span class="cmp-meta">${m.dateCR} · ${esc(m.group ? 'Grp '+m.group : stageES(m.stage))}</span>
      </td>
      <td class="cmp-real-cell${scored?' cmp-real-done':''}">
        ${scored ? `<b>${res.h} - ${res.a}</b>` : '<span class="cmp-dash">—</span>'}
      </td>
      ${cells}
    </tr>`;
  }).join('')}</tbody>`;

  const tfoot = `<tfoot><tr class="cmp-totals">
    <td class="cmp-match-cell"><span class="cmp-num">TOTAL</span><span class="cmp-teams-line" style="font-size:.8rem;color:var(--muted)">Puntos acumulados (partidos visibles)</span></td>
    <td class="cmp-real-cell"></td>
    ${totals.map(t=>`<td class="cmp-cell cmp-total"><b>${t}</b><small>pts</small></td>`).join('')}
  </tr></tfoot>`;

  const legend = `<div class="cmp-legend">
    <span><i class="cl cl-perfect"></i>Exacto (4pts)</span>
    <span><i class="cl cl-scored"></i>Ganador (1–3pts)</span>
    <span><i class="cl cl-partial"></i>Parcial sin ganador</span>
    <span><i class="cl cl-zero"></i>Error (0pts)</span>
    <span><i class="cl cl-wait"></i>Sin resultado</span>
    <span><i class="cl cl-nopred"></i>Sin pronóstico</span>
  </div>`;

  $('comparison').innerHTML = `
    <div class="section-head">
      <div><p class="eyebrow">Partido a partido · todos los jugadores</p><h2>Comparativa</h2></div>
      <span class="status-chip">${fms.length} partidos · ${state.participants.length} jugadores</span>
    </div>
    ${legend}
    ${filterBar}
    <div class="card cmp-card">
      <div class="cmp-wrap">
        <table class="cmp-table">${thead}${tbody}${tfoot}</table>
      </div>
    </div>`;
  qsa('[data-cmpfilter]').forEach(b => b.onclick = () => { comparisonFilter = b.dataset.cmpfilter; renderComparison(); });
}
function renderAll(){ renderHero(); renderDashboard(); renderCalendar(); renderGroups(); renderKnockout(); renderPredictions(); renderMyWorld(); renderRanking(); renderComparison(); renderAdmin(); updateTopSaveButton(); }
init();
