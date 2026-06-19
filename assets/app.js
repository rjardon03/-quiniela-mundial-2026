const view=document.getElementById('view');
const screens={
calendar:`<div class='card'><h2>Calendario</h2><p>Partidos en hora Costa Rica.</p></div>`,
predictions:`<div class='card'><h2>Mis Pronósticos</h2><p>Ordenados por número de partido.</p></div>`,
groups:`<div class='card'><h2>Grupos FIFA</h2><table class='table'><tr><th>Pos</th><th>Equipo</th><th>PTS</th></tr></table></div>`,
myworld:`<div class='card'><h2>Mi Mundial</h2><p>Simulación basada en pronósticos.</p></div>`,
ranking:`<div class='card'><h2>Ranking</h2></div>`,
dashboard:`<div><div class='kpis'><div class='kpi'>Participantes</div><div class='kpi'>Partidos</div><div class='kpi'>Líder</div></div></div>`,
admin:`<div class='card'><h2>Administración</h2></div>`
};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view.innerHTML=screens[b.dataset.view]);
view.innerHTML=screens.dashboard;