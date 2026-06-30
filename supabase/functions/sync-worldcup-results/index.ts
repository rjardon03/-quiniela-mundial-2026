import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body, null, 2),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
);

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const TEAM_ALIASES: Record<string, string> = {
  "mexico": "MEX", "south africa": "RSA", "korea republic": "KOR", "south korea": "KOR",
  "czechia": "CZE", "czech republic": "CZE", "canada": "CAN",
  "bosnia and herzegovina": "BIH", "bosnia herzegovina": "BIH", "qatar": "QAT",
  "switzerland": "SUI", "brazil": "BRA", "morocco": "MAR", "haiti": "HAI",
  "scotland": "SCO", "usa": "USA", "united states": "USA", "united states of america": "USA",
  "paraguay": "PAR", "australia": "AUS", "turkiye": "TUR", "turkey": "TUR",
  "germany": "GER", "curacao": "CUW", "ivory coast": "CIV", "cote d ivoire": "CIV",
  "ecuador": "ECU", "netherlands": "NED", "japan": "JPN", "sweden": "SWE",
  "tunisia": "TUN", "belgium": "BEL", "egypt": "EGY", "iran": "IRN", "ir iran": "IRN",
  "new zealand": "NZL", "spain": "ESP", "cape verde": "CPV", "cape verde islands": "CPV", "cabo verde": "CPV",
  "saudi arabia": "KSA", "uruguay": "URU", "france": "FRA", "senegal": "SEN",
  "iraq": "IRQ", "norway": "NOR", "argentina": "ARG", "algeria": "ALG",
  "austria": "AUT", "jordan": "JOR", "portugal": "POR", "dr congo": "COD",
  "congo dr": "COD", "democratic republic of the congo": "COD", "uzbekistan": "UZB",
  "colombia": "COL", "england": "ENG", "croatia": "CRO", "ghana": "GHA", "panama": "PAN",
};

const teamCode = (name: unknown) => TEAM_ALIASES[normalize(name)] ?? null;
const canonicalCode = (value: unknown) => {
  const code = String(value ?? "").trim().toUpperCase();
  if (code === "CUR") return "CUW";
  if (code === "URY") return "URU";
  return code;
};

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const finishedStatuses = new Set(["FINISHED"]);

async function fetchWithRetry(url: string, headers: Record<string, string>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return response;
      const text = await response.text();
      lastError = new Error(`football-data.org HTTP ${response.status}: ${text.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
  throw lastError;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Use POST." }, 405);

  const startedAt = new Date().toISOString();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const footballDataToken = Deno.env.get("FOOTBALL_DATA_TOKEN");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY." }, 500);
  }
  if (!footballDataToken) {
    return jsonResponse({ ok: false, error: "Falta el secreto FOOTBALL_DATA_TOKEN." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  const mode = body.mode === "apply" ? "apply" : "preview";
  const forceManual = body.forceManual === true;
  const adminPin = String(body.adminPin ?? "");
  const providedSecret = req.headers.get("x-sync-secret") ?? "";
  const cronSecret = Deno.env.get("SYNC_CRON_SECRET") ?? "";

  let authorized = Boolean(cronSecret && providedSecret && providedSecret === cronSecret);
  if (!authorized && adminPin) {
    const { data: pinRow, error: pinError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "admin_pin")
      .maybeSingle();
    if (pinError) return jsonResponse({ ok: false, error: "No se pudo validar el PIN.", detail: pinError.message }, 500);
    authorized = pinRow?.value === adminPin;
  }
  if (!authorized) return jsonResponse({ ok: false, error: "PIN o secreto de sincronización inválido." }, 401);

  const apiUrl = "https://api.football-data.org/v4/competitions/WC/matches";
  let upstreamStatus = 0;
  let payload: any;

  try {
    const upstream = await fetchWithRetry(apiUrl, {
      "Accept": "application/json",
      "X-Auth-Token": footballDataToken,
    });
    upstreamStatus = upstream.status;
    payload = await upstream.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await supabase.from("result_sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      mode,
      status: "network_error",
      details: { apiUrl, detail, provider: "football-data" },
    });
    return jsonResponse({ ok: false, error: "No se pudo conectar con football-data.org.", detail }, 502);
  }

  if (payload?.errorCode || payload?.message) {
    const apiErrors = { errorCode: payload?.errorCode ?? null, message: payload?.message ?? null };
    await supabase.from("result_sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      mode,
      status: "upstream_error",
      details: { apiUrl, upstreamStatus, apiErrors, provider: "football-data" },
    });
    return jsonResponse({ ok: false, error: "football-data.org devolvió errores.", apiErrors }, 502);
  }

  const fixtures = Array.isArray(payload?.matches) ? payload.matches : [];
  if (!fixtures.length) {
    await supabase.from("result_sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      mode,
      status: "invalid_payload",
      fetched_count: 0,
      details: { apiUrl, upstreamStatus, payloadMeta: { resultSet: payload?.resultSet, competition: payload?.competition } },
    });
    return jsonResponse({ ok: false, error: "football-data.org no devolvió los partidos del Mundial 2026.", payload }, 422);
  }

  const [{ data: catalog, error: catalogError }, { data: existing, error: resultsError }] = await Promise.all([
    supabase.from("match_catalog").select("*").order("match_id"),
    supabase.from("results").select("match_id,home_goals,away_goals,source,manual_override"),
  ]);
  if (catalogError || resultsError) {
    return jsonResponse({ ok: false, error: "No se pudo leer el catálogo local.", detail: catalogError?.message || resultsError?.message }, 500);
  }

  const resultById = new Map((existing ?? []).map((r: Record<string, unknown>) => [Number(r.match_id), r]));

  // ============================================================
  // AUTO-RESOLVE: actualiza match_catalog para rondas eliminatorias
  // cuando el API ya conoce los equipos pero el catalog tiene TBD.
  // Estrategia: mapeo posicional por fecha dentro de cada ronda.
  // ============================================================
  const API_STAGE_TO_LOCAL: Record<string, string> = {
    "LAST_32":        "Round of 32",
    "LAST_16":        "Round of 16",
    "QUARTER_FINALS": "Quarterfinals",
    "SEMI_FINALS":    "Semifinals",
    "THIRD_PLACE":    "Third Place Playoff",
    "FINAL":          "Final",
  };

  const catalogResolutions: { match_id: number; home_code: string; away_code: string }[] = [];

  for (const [apiStage, localStage] of Object.entries(API_STAGE_TO_LOCAL)) {
    // Fixtures del API con ambos equipos conocidos para esta ronda
    const apiKnown = fixtures
      .filter((f: any) => {
        const stage = String(f?.stage ?? "").toUpperCase();
        const hCode = canonicalCode(f?.homeTeam?.tla || teamCode(f?.homeTeam?.name));
        const aCode = canonicalCode(f?.awayTeam?.tla || teamCode(f?.awayTeam?.name));
        return stage === apiStage && hCode && aCode && hCode !== "TBD" && aCode !== "TBD";
      })
      .sort((a: any, b: any) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

    // Entradas del catalog para esta ronda que aún tienen TBD
    const localTBD = (catalog ?? [])
      .filter((m: any) => {
        const hc = canonicalCode(m.home_code);
        const ac = canonicalCode(m.away_code);
        return String(m.stage ?? "") === localStage && (hc === "TBD" || !hc || ac === "TBD" || !ac);
      })
      .sort((a: any, b: any) => new Date(a.kickoff_at ?? 0).getTime() - new Date(b.kickoff_at ?? 0).getTime());

    // Mapeo posicional (1er fixture API con equipos conocidos → 1er TBD local)
    const limit = Math.min(apiKnown.length, localTBD.length);
    for (let i = 0; i < limit; i++) {
      const apiF = apiKnown[i];
      const local = localTBD[i];
      const hCode = canonicalCode(apiF?.homeTeam?.tla || teamCode(apiF?.homeTeam?.name));
      const aCode = canonicalCode(apiF?.awayTeam?.tla || teamCode(apiF?.awayTeam?.name));
      if (hCode && aCode) {
        catalogResolutions.push({ match_id: Number(local.match_id), home_code: hCode, away_code: aCode });
      }
    }
  }

  // Escribir resoluciones al DB y parchear el catalog en memoria
  if (catalogResolutions.length > 0) {
    await supabase.from("match_catalog").upsert(catalogResolutions, { onConflict: "match_id" });
    for (const res of catalogResolutions) {
      const entry = (catalog ?? []).find((m: any) => Number(m.match_id) === res.match_id);
      if (entry) { entry.home_code = res.home_code; entry.away_code = res.away_code; }
    }
  }
  // ============================================================

  const localByPair = new Map<string, Record<string, unknown>>();
  const duplicateLocalPairs: string[] = [];

  for (const local of catalog ?? []) {
    const home = canonicalCode(local.home_code);
    const away = canonicalCode(local.away_code);
    if (!home || !away || home === "TBD" || away === "TBD") continue;
    const key = `${home}|${away}`;
    if (localByPair.has(key)) duplicateLocalPairs.push(key);
    else localByPair.set(key, local);
  }

  const mappedLocalIds = new Set<number>();
  const duplicateLocalIds: number[] = [];
  const remapped: Record<string, unknown>[] = [];
  const mismatches: Record<string, unknown>[] = [];
  const candidates: Record<string, unknown>[] = [];
  const preview: Record<string, unknown>[] = [];

  for (const item of fixtures) {
    const fixtureId = Number(item?.id);
    const statusShort = String(item?.status ?? "").toUpperCase();
    const finished = finishedStatuses.has(statusShort);
    const homeName = item?.homeTeam?.name;
    const awayName = item?.awayTeam?.name;
    const homeCode = canonicalCode(item?.homeTeam?.tla || teamCode(homeName));
    const awayCode = canonicalCode(item?.awayTeam?.tla || teamCode(awayName));

    // Duración y ganador oficial (para ET y penales en eliminatorias)
    const duration = String(item?.score?.duration ?? "REGULAR").toUpperCase();

    // Marcador del partido (goles reales, sin penales)
    // football-data.org v4 usa:
    //   score.regularTime  → goles en 90 min
    //   score.extraTime    → goles SOLO en prórroga (no acumulado)
    //   score.fullTime     → para PENALTY_SHOOTOUT contiene los tiros (no usar)
    // Para ET y penales: marcador real = regularTime + extraTime
    let homeGoals: number | null;
    let awayGoals: number | null;
    if (duration === "EXTRA_TIME" || duration === "PENALTY_SHOOTOUT") {
      const regHome = numberOrNull(item?.score?.regularTime?.home) ?? 0;
      const regAway = numberOrNull(item?.score?.regularTime?.away) ?? 0;
      const etHome  = numberOrNull(item?.score?.extraTime?.home)   ?? 0;
      const etAway  = numberOrNull(item?.score?.extraTime?.away)   ?? 0;
      homeGoals = regHome + etHome;
      awayGoals = regAway + etAway;
    } else {
      homeGoals = numberOrNull(item?.score?.fullTime?.home);
      awayGoals = numberOrNull(item?.score?.fullTime?.away);
    }
    const scoreWinner = String(item?.score?.winner ?? "").toUpperCase();
    // winner_side: "home" | "away" | null
    // Solo se asigna cuando el partido se definió por ET o penales (en 90 min el ganador ya es claro por goles)
    let winnerSide: string | null = null;
    if (duration === "EXTRA_TIME" || duration === "PENALTY_SHOOTOUT") {
      if (scoreWinner === "HOME_TEAM") winnerSide = "home";
      else if (scoreWinner === "AWAY_TEAM") winnerSide = "away";
    }
    const matchDuration = duration !== "REGULAR" ? duration : null;

    const pairKey = homeCode && awayCode ? `${homeCode}|${awayCode}` : "";
    const reversePairKey = homeCode && awayCode ? `${awayCode}|${homeCode}` : "";

    // Búsqueda bidireccional: primero home|away, luego away|home
    let local = pairKey ? localByPair.get(pairKey) : undefined;
    let homeAwaySwapped = false;
    if (!local && reversePairKey) {
      local = localByPair.get(reversePairKey);
      if (local) homeAwaySwapped = true;
    }

    const reasons: string[] = [];
    if (!homeCode) reasons.push(`equipo local no reconocido: ${String(homeName ?? "")}`);
    if (!awayCode) reasons.push(`equipo visitante no reconocido: ${String(awayName ?? "")}`);
    if (!local) reasons.push(`no se encontró partido local — par buscado: ${pairKey} / ${reversePairKey}`);

    if (!local) {
      mismatches.push({ fixtureId, homeName, awayName, homeCode, awayCode, pairKey, reversePairKey, reasons, date: item?.utcDate });
    }

    const localMatchId = local ? Number(local.match_id) : null;
    if (localMatchId !== null) {
      if (mappedLocalIds.has(localMatchId)) duplicateLocalIds.push(localMatchId);
      mappedLocalIds.add(localMatchId);
      remapped.push({ fixtureId, localMatchId, home: homeName, away: awayName, method: "team_pair" });
    }

    const current = localMatchId !== null ? resultById.get(localMatchId) : undefined;
    const manualOverride = current?.manual_override === true;
    const validFinishedScore = finished && homeGoals !== null && awayGoals !== null;
    const canApply = Boolean(local && localMatchId !== null && validFinishedScore && (!manualOverride || forceManual));

    const row = {
      fixtureId,
      localMatchId,
      finished,
      statusShort,
      duration: matchDuration,
      winnerSide,
      home: homeName,
      away: awayName,
      homeCode,
      awayCode,
      homeAwaySwapped,
      score: validFinishedScore ? `${homeGoals}-${awayGoals}` : null,
      manualOverride,
      action: canApply
        ? "ready"
        : manualOverride && !forceManual
          ? "skip_manual"
          : !local
            ? "blocked_unmapped"
            : "ignore_not_finished",
    };
    if (preview.length < 24 || validFinishedScore || !local) preview.push(row);

    if (canApply && localMatchId !== null) {
      // Si el par estaba invertido respecto al catálogo, invertir goles y winner_side
      const storedHomeGoals = homeAwaySwapped ? awayGoals : homeGoals;
      const storedAwayGoals = homeAwaySwapped ? homeGoals : awayGoals;
      const storedWinnerSide = homeAwaySwapped
        ? (winnerSide === "home" ? "away" : winnerSide === "away" ? "home" : null)
        : winnerSide;

      candidates.push({
        match_id: localMatchId,
        home_goals: storedHomeGoals,
        away_goals: storedAwayGoals,
        winner_side: storedWinnerSide,  // "home" | "away" | null — para ET y penales (ajustado si swap)
        match_duration: matchDuration, // "EXTRA_TIME" | "PENALTY_SHOOTOUT" | null
        source: "football-data",
        source_updated_at: new Date().toISOString(),
        external_status: statusShort,
        external_payload: {
          provider: "football-data",
          fixture_id: fixtureId,
          fixture_date: item?.utcDate,
          home_team_name: homeName,
          away_team_name: awayName,
          score: item?.score, // fullTime, extraTime, penalties, winner, duration
        },
        manual_override: false,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const missingLocalMatches = (catalog ?? [])
    .map((m: Record<string, unknown>) => Number(m.match_id))
    .filter((id: number) => !mappedLocalIds.has(id));
  const skippedManualCount = preview.filter((x) => x.action === "skip_manual").length;

  let appliedCount = 0;
  if (mode === "apply" && candidates.length) {
    const { data: applied, error: upsertError } = await supabase
      .from("results")
      .upsert(candidates, { onConflict: "match_id" })
      .select("match_id");
    if (upsertError) {
      await supabase.from("result_sync_runs").insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        mode,
        status: "database_error",
        fetched_count: fixtures.length,
        valid_count: candidates.length,
        mismatch_count: mismatches.length,
        details: { error: upsertError.message, provider: "football-data" },
      });
      return jsonResponse({ ok: false, error: "football-data.org respondió bien, pero falló la actualización en Supabase.", detail: upsertError.message }, 500);
    }
    appliedCount = applied?.length ?? candidates.length;
  }

  const summary = {
    provider: "football-data",
    fetched: fixtures.length,
    catalogResolved: catalogResolutions,
    catalogSize: catalog?.length ?? 0,
    apiRequestCount: payload?.resultSet?.count ?? fixtures.length,
    duplicateLocalPairs: [...new Set(duplicateLocalPairs)],
    duplicateLocalIds: [...new Set(duplicateLocalIds)].sort((a, b) => a - b),
    missingLocalMatches,
    remappedCount: remapped.length,
    mismatches,
    finishedReady: candidates.length,
    applied: appliedCount,
    skippedManual: skippedManualCount,
    forceManual,
    resultSet: payload?.resultSet ?? null,
  };

  await supabase.from("result_sync_runs").insert({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    mode,
    status: mismatches.length ? "completed_with_warnings" : "success",
    fetched_count: fixtures.length,
    valid_count: candidates.length,
    applied_count: appliedCount,
    skipped_manual_count: skippedManualCount,
    mismatch_count: mismatches.length,
    details: summary,
  });

  return jsonResponse({
    ok: true,
    mode,
    source: apiUrl,
    upstreamStatus,
    summary,
    preview,
    note: mode === "preview"
      ? "Vista previa: no se modificó ningún marcador."
      : `Sincronización aplicada: ${appliedCount} resultado(s) actualizado(s).`,
  });
});
