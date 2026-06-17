// Cliente Supabase para GitHub Pages
// Este archivo crea la conexión centralizada de la quiniela.

(function () {
  const cfg = window.QUINIELA_CONFIG || {};

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseAnonKey === 'PEGA_AQUI_TU_ANON_KEY') {
    window.quinielaSupabase = null;
    console.warn('Supabase no está configurado. La app funcionará en modo local.');
    return;
  }

  if (!window.supabase) {
    window.quinielaSupabase = null;
    console.error('La librería de Supabase no está cargada.');
    return;
  }

  window.quinielaSupabase = window.supabase.createClient(
    cfg.supabaseUrl,
    cfg.supabaseAnonKey
  );
})();
