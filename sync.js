const fetch = require("node-fetch");
const { insertRun, insertRunsBatch, isSeen, markSeen, markSeenBatch, getCheckpoint, setCheckpoint } = require("./db");
const { storeRun } = require("./store");

const API_BASE         = "https://api.openfront.io";
const FETCH_TIMEOUT    = 20_000;
const TIME_OFFSET_SECS = 32;

// ── Concurrence : nombre de requêtes simultanées ───────────────────────────────


const CONCURRENCY_NORMAL  = 50;
const CONCURRENCY_HISTORY = 3; // fenêtres traitées en parallèle par batch (stable pour 2min windows)
const BATCH_DELAY_NORMAL  = 0;     // ms
const BATCH_DELAY_HISTORY = 10000; // ms - pause entre batches (10s)

const CHECKPOINT_EVERY = 200; // sauvegarde le checkpoint tous les 200 fenêtres (pour 2min windows)

const DELAY_429 = 10_000; // pause quand on reçoit un 429 (base 10s)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch avec retry automatique sur 429 ──────────────────────────────────────
async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        const wait = DELAY_429 * Math.pow(2, attempt); // backoff exponentiel: 10s, 20s, 40s
        console.warn(`[rate-limit] 429 — pause ${wait}ms (tentative ${attempt + 1})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      if (attempt === retries) throw e;
      await sleep(500); // backoff progressif
    }
  }
}

// ── Sémaphore : limite le nombre de Promises actives simultanément ─────────────
// Remplace le sleep() séquentiel par un vrai contrôle de concurrence.
// Jamais plus de `max` requêtes en vol en même temps.
function createSemaphore(max) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  }

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

// ── Cartes connues ─────────────────────────────────────────────────────────────
const MAP_NAMES = {
  Europe:                    "Europe",
  "Europe Classic":          "Europe Classic",
  World:                     "Monde",
  "World Rotated":           "World Rotated",
  Asia:                      "Asie",
  "East Asia":               "East Asia",
  Africa:                    "Afrique",
  Australia:                 "Australie",
  Iceland:                   "Islande",
  "North America":           "Amérique du Nord",
  "South America":           "Amérique du Sud",
  Japan:                     "Japon",
  Italy:                     "Italie",
  Italia:                    "Italia",
  Britannia:                 "Britannia",
  "Britannia Classic":       "Britannia Classic",
  Mars:                      "Mars",
  Pluto:                     "Pluto",
  Pangaea:                   "Pangée",
  "Bosphorus Straits":       "Bosphore",
  "Bering Strait":           "Détroit de Béring",
  "Strait of Gibraltar":     "Strait of Gibraltar",
  "Strait of Hormuz":        "Strait of Hormuz",
  "Black Sea":               "Black Sea",
  "Between Two Seas":        "Between Two Seas",
  Alps:                      "Alpes",
  Hawaii:                    "Hawaï",
  Arctic:                    "Arctique",
  "Nile Delta":              "Delta du Nil",
  "San Francisco":           "San Francisco",
  "New York City":           "New York City",
  Montreal:                  "Montreal",
  Passage:                   "Passage",
  "The Box":                 "The Box",
  "Traders Dream":           "Traders Dream",
  Yenisei:                   "Iénisseï",
  Baikal:                    "Baikal",
  "Amazon River":            "Amazon River",
  "Gulf of St. Lawrence":    "Gulf of St. Lawrence",
  "Gateway to the Atlantic": "Gateway to the Atlantic",
  "Falkland Islands":        "Falkland Islands",
  "Faroe Islands":           "Faroe Islands",
  "Four Islands":            "Four Islands",
  Lemnos:                    "Lemnos",
  Aegean:                    "Aegean",
  Halkidiki:                 "Halkidiki",
  Lisbon:                    "Lisbon",
  Mena:                      "Mena",
  Achiran:                   "Achiran",
  Svalmel:                   "Svalmel",
  Manicouagan:               "Manicouagan",
  Sierpinski:                "Sierpinski",
  Surrounded:                "Surrounded",
  "Two Lakes":               "Two Lakes",
  "Deglaciated Antarctica":  "Deglaciated Antarctica",
};
function normalizeName(n) { return MAP_NAMES[n] || n; }
function isNationsValid(n) { return n === "enabled" || n === "default" || n == null; }

// ── Appel liste de parties dans une fenêtre temporelle ────────────────────────
async function fetchGamesInWindow(start, end) {
  const url = `${API_BASE}/public/games?start=${start.toISOString()}&end=${end.toISOString()}`;
  const t0 = Date.now();
  const data = await fetchWithRetry(url);
  const t1 = Date.now();
  // console.log(`[timing] fetchGamesInWindow: ${t1-t0}ms`);
  if (!data) return [];
  const games = Array.isArray(data) ? data : (data.games || []);
  const filtered = games.filter(g =>
    (g.difficulty === "Easy" || g.difficulty === "Medium" || g.difficulty === "Hard") &&
    (g.numPlayers == null || g.numPlayers >= 10) &&
    (g.mode === "Free For All" || g.mode === "FFA" || g.mode == null) &&
    (g.type === "Public" || g.type == null)
  );
  // Log de statistiques de filtrage
  if (games.length > 0 && filtered.length !== games.length) {
    console.log(`[filter] ${filtered.length}/${games.length} games passent le filtre`);
  }
  return filtered;
}

async function fetchGameDetail(gameId) {
  const t0 = Date.now();
  const result = await fetchWithRetry(`${API_BASE}/public/game/${gameId}`);
  const t1 = Date.now();
  // console.log(`[timing] fetchGameDetail(${gameId.slice(0,8)}...): ${t1-t0}ms`);
  return result;
}

function calcDuration(detail) {
  if (detail.duration) {
    const d = detail.duration;
    return d > 100_000 ? Math.round(d / 1000) : d;
  }
  if (detail.start && detail.end) {
    const diff = detail.end - detail.start;
    return diff > 100_000 ? Math.round(diff / 1000) : diff;
  }
  return null;
}

function extractSpeedrun(raw) {
  const detail = raw.info;
  if (!detail) return null;
  const config = detail.config || {};

  // ── Règles speedrun ───────────────────────────────────────────
  if (config.gameType    !== "Public")       return null;
  if (config.gameMode    !== "Free For All") return null;
  if (config.gameMapSize !== "Normal")       return null;
  if (config.bots        !== 400)            return null;

  // Aucun publicGameModifier actif
  const mods = config.publicGameModifiers || {};
  if (mods.isCompact || mods.isRandomSpawn || mods.isCrowded || mods.isHardNations || mods.isAlliancesDisabled) return null;

  if (config.randomSpawn  !== false) return null;
  if (config.donateGold   !== false) return null;
  if (config.donateTroops !== false) return null;
  if (config.infiniteGold)           return null;
  if (config.infiniteTroops)         return null;
  if (config.instantBuild)           return null;
  if (config.startingGold  != null && config.startingGold  !== 0) return null;
  if (config.goldMultiplier != null && config.goldMultiplier !== 1) return null;
  // disabledUnits : peu importe


  const players = detail.players || [];
  const humanPlayers = players.filter(p => !p.isBot);
  if (humanPlayers.length < 10) return null;

  const winner = detail.winner;
  if (!winner || !Array.isArray(winner) || winner.length < 2) return null;

  const winnerPlayer = players.find(p => p.clientID === winner[1]);
  if (!winnerPlayer?.username || winnerPlayer.isBot) return null;

  let durationSecs = calcDuration(detail);
  if (!durationSecs || durationSecs < 60) return null;
  durationSecs = Math.max(0, durationSecs - TIME_OFFSET_SECS);

  const gameId = detail.gameID || detail.gameId || detail.id;
  if (!gameId) {
    console.warn(`[extract] Game sans ID ignoré`);
    return null;
  }

  return {
    game_id:    gameId,
    player:     winnerPlayer.username,
    map:        normalizeName(config.gameMap || "Inconnu"),
    duration_s: durationSecs,
    difficulty: config.difficulty || "Medium",
    bots:       400,
    won:        1,
    played_at:  detail.start
      ? new Date(detail.start > 1e10 ? detail.start : detail.start * 1000).toISOString()
      : new Date().toISOString(),
  };
}

// ── Traitement parallèle avec sémaphore ───────────────────────────────────────
// Remplace la boucle séquentielle for...of avec sleep().
// Lance jusqu'à `concurrency` requêtes simultanées — jamais plus.
// Les écritures DB sont batchées pour éviter de réécrire le JSON à chaque fois.
async function processGames(games, { concurrency = CONCURRENCY_NORMAL, batchDelay = BATCH_DELAY_NORMAL } = {}) {
  const unseen = games.filter(g => g.game && !isSeen(g.game));
  if (unseen.length === 0) return 0;

  // console.log(`[sync] ${unseen.length} parties → parallèle (max ${concurrency} simultané)`);
  const startTime = Date.now();

  const sem = createSemaphore(concurrency);
  const runsToInsert = [];
  const seenToMark = [];
  let newRuns = 0;
  let errors  = 0;

  const tasks = unseen.map(game => sem(async () => {
    const gameId = game.game;
    try {
      const raw = await fetchGameDetail(gameId);
      seenToMark.push(gameId); // collecter pour batch
      const run = extractSpeedrun(raw);
      if (run) {
        runsToInsert.push(run);
        storeRun(run, "ffa"); // écriture fichier séparé, pas de souci
        newRuns++;
        console.log(`[sync] ✅ ${run.player} — ${run.map} — ${Math.floor(run.duration_s / 60)}m${run.duration_s % 60}s`);
      }
    } catch (e) {
      errors++;
      console.warn(`[sync] ⚠️ ${gameId}: ${e.message}`);
      // Pas de markSeen en cas d'erreur → retentée au prochain cycle
      // On retire le gameId de seenToMark s'il y est
      const idx = seenToMark.indexOf(gameId);
      if (idx > -1) seenToMark.splice(idx, 1);
    }
  }));

  await Promise.allSettled(tasks);

  // Batch write à la fin (1 seule écriture JSON au lieu de N)
  if (runsToInsert.length > 0) {
    insertRunsBatch(runsToInsert);
  }
  if (seenToMark.length > 0) {
    markSeenBatch(seenToMark);
  }

  const duration = Date.now() - startTime;
  if (batchDelay > 0) await sleep(batchDelay);
  if (errors > 0) console.log(`[sync] ${errors} erreur(s) — seront retentées`);
  // console.log(`[sync] Traitement terminé en ${duration}ms — ${newRuns} runs`);

  return newRuns;
}

// ── Sync historique avec checkpoint (reprend où elle s'était arrêtée) ──────────
async function syncHistory() {
  const WINDOW_MS  = 2 * 60 * 1_000; // 2 minutes par fenêtre (couverture plus fine)
  const HISTORY_MS = 120 * 24 * 60 * 60 * 1_000; // ~4 mois jusqu'à décembre 2025
  const now    = Date.now();
  const oldest = now - HISTORY_MS;

  // Reprend depuis le checkpoint si existant, sinon part du présent
  const saved = getCheckpoint('history_oldest_reached');
  const resumeFrom = saved ? Math.max(parseInt(saved) - (WINDOW_MS * 5), oldest) : now;

  if (saved) {
    console.log(`[history] Reprise depuis ${new Date(resumeFrom).toISOString().slice(0,10)} (checkpoint trouvé)`);
  } else {
    console.log(`[history] Démarrage depuis aujourd'hui`);
  }

  // Génère les fenêtres depuis resumeFrom vers le passé
  const windows = [];
  for (let end = resumeFrom; end > oldest; end -= WINDOW_MS) {
    const start = Math.max(end - WINDOW_MS, oldest);
    windows.push({ start: new Date(start), end: new Date(end) });
  }

  console.log(`[history] ${windows.length} fenêtres restantes sur 360 jours`);
  console.log(`[history] Période: du ${new Date(oldest).toISOString().slice(0,10)} au ${new Date(resumeFrom).toISOString().slice(0,10)}`);
  if (windows.length === 0) {
    console.log(`[history] ✅ Historique déjà complet`);
    return 0;
  }

  let totalRuns = 0, done = 0;
  let oldestReached = resumeFrom;

  // Traitement par batch de CONCURRENCY_HISTORY fenêtres en parallèle.
  // On sauvegarde le checkpoint après chaque batch — si le serveur s'arrête,
  // on repart au début du dernier batch (quelques minutes de retard max).
  for (let i = 0; i < windows.length; i += CHECKPOINT_EVERY) {
    const batch = windows.slice(i, i + CHECKPOINT_EVERY);

    let batchSuccess = false;
    let retryCount = 0;
    const maxRetries = 3;

    while (!batchSuccess && retryCount < maxRetries) {
      let batchHasRateLimit = false;
      const batchResults = await Promise.allSettled(
        batch.map(async ({ start, end }) => {
          try {
            const games = await fetchGamesInWindow(start, end);
            if (games.length === 0) return { start, runs: 0 };
            const runs = await processGames(games, { concurrency: CONCURRENCY_HISTORY, batchDelay: 0 });
            return { start, runs };
          } catch (e) {
            if (e.message && e.message.includes('429')) {
              batchHasRateLimit = true;
            }
            throw e;
          }
        })
      );

      // Si rate limit détecté, attendre et réessayer
      if (batchHasRateLimit) {
        console.warn(`[history] ⚠️ Rate limit détecté - retry ${retryCount + 1}/${maxRetries}`);
        await sleep(60000); // Attendre 1 minute
        retryCount++;
        continue;
      }

      // Vérifier si toutes les fenêtres ont réussi
      let allSuccess = true;
      for (const r of batchResults) {
        if (r.status !== 'fulfilled') {
          allSuccess = false;
          console.warn(`[history] ⚠️ batch error: ${r.reason?.message}`);
        }
      }

      if (allSuccess) {
        batchSuccess = true;
        
        for (const r of batchResults) {
          totalRuns += r.value.runs;
          if (r.value.runs > 0) console.log(`[history] +${r.value.runs} (${r.value.start.toISOString().slice(0,10)})`);
          oldestReached = r.value.start.getTime();
        }
      } else {
        console.warn(`[history] ⚠️ Erreur dans le batch - retry ${retryCount + 1}/${maxRetries}`);
        await sleep(30000);
        retryCount++;
      }
    }

    // Si le batch échoue après tous les retries, arrêter
    if (!batchSuccess) {
      console.error(`[history] ❌ Batch échoué après ${maxRetries} retries - arrêt de la sync`);
      break;
    }

    // Checkpoint après chaque batch (seulement si succès)
    setCheckpoint('history_oldest_reached', String(oldestReached));
    done += batch.length;

    const pct = Math.round((done / windows.length) * 100);
    console.log(`[history] ${done}/${windows.length} fenêtres (${pct}%) — ${totalRuns} runs — jusqu'au ${new Date(oldestReached).toISOString().slice(0,10)}`);
    
    // Pause entre les batches pour éviter le rate-limit
    if (BATCH_DELAY_HISTORY > 0 && i + batch.length < windows.length) {
      console.log(`[history] Pause de ${BATCH_DELAY_HISTORY/1000}s avant le prochain batch...`);
      await sleep(BATCH_DELAY_HISTORY);
    }
  }

  console.log(`[history] ✅ Terminé — ${totalRuns} runs insérés`);
  return totalRuns;
}

// ── Sync des trous : comble le gap depuis la dernière sync ───────────────────
async function syncMissed() {
  const saved = getCheckpoint('last_sync_time');
  if (!saved) {
    console.log('[missed] Pas de sync précédente connue — ignoré');
    return 0;
  }

  const lastSync = parseInt(saved);
  const now = Date.now();
  const gapMs = now - lastSync;
  const gapMin = Math.round(gapMs / 60_000);

  // Moins de 15 min d'écart → pas besoin de combler
  if (gapMs < 15 * 60_000) return 0;

  const globalStart = Date.now();
  console.log(`[missed] Gap détecté : ${gapMin} min depuis la dernière sync — récupération...`);

  const WINDOW_MS = 1 * 60 * 1_000; // 1 minute par fenêtre (plus de fenêtres = plus de parallélisme)

  // Génère toutes les fenêtres à traiter
  const windows = [];
  for (let end = now; end > lastSync; end -= WINDOW_MS) {
    const start = Math.max(end - WINDOW_MS, lastSync);
    windows.push({ start: new Date(start), end: new Date(end) });
  }

  console.log(`[missed] ${windows.length} fenêtres à traiter`);

  let totalRuns = 0;
  let done = 0;

  // Traitement par batches de CONCURRENCY_HISTORY fenêtres en parallèle
  for (let i = 0; i < windows.length; i += CONCURRENCY_HISTORY) {
    const batch = windows.slice(i, i + CONCURRENCY_HISTORY);

    const batchResults = await Promise.allSettled(
      batch.map(async ({ start, end }) => {
        try {
          const games = await fetchGamesInWindow(start, end);
          if (games.length === 0) return { runs: 0 };
          const runs = await processGames(games, { concurrency: CONCURRENCY_HISTORY, batchDelay: 0 });
          return { runs, start };
        } catch (e) {
          console.warn(`[missed] ⚠️ ${start.toISOString().slice(0,16)}: ${e.message}`);
          return { runs: 0, start };
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        totalRuns += r.value.runs;
      }
    }

    done += batch.length;
    const pct = Math.round((done / windows.length) * 100);
    console.log(`[missed] ${done}/${windows.length} fenêtres (${pct}%) — ${totalRuns} runs`);
    
    // Pause entre les batches pour éviter le rate-limit
    if (BATCH_DELAY_HISTORY > 0 && i + CONCURRENCY_HISTORY < windows.length) {
      console.log(`[missed] Pause de ${BATCH_DELAY_HISTORY/1000}s avant le prochain batch...`);
      await sleep(BATCH_DELAY_HISTORY);
    }
  }

  const globalDuration = Date.now() - globalStart;
  console.log(`[missed] ✅ Trou comblé — ${totalRuns} runs récupérés en ${globalDuration}ms`);
  return totalRuns;
}

// ── Sync normale : fenêtre 12h ────────────────────────────────────────────────
async function syncSpeedruns() {
  const globalStart = Date.now();
  console.log(`[sync] Démarrage — ${new Date().toISOString()}`);
  let newRuns = 0;
  try {
    const now       = new Date();
    const threeHAgo = new Date(Date.now() - 12 * 60 * 60 * 1_000);
    const games     = await fetchGamesInWindow(threeHAgo, now);
    // console.log(`[sync] ${games.length} parties candidates`);
    newRuns = await processGames(games, {
      concurrency: CONCURRENCY_NORMAL,
      batchDelay:  BATCH_DELAY_NORMAL,
    });
    setCheckpoint('last_sync_time', String(Date.now()));
    const globalDuration = Date.now() - globalStart;
    // console.log(`[sync] ✅ Terminé — ${newRuns} nouveaux runs en ${globalDuration}ms`);
  } catch (e) {
    console.error(`[sync] ❌ ${e.message}`);
  }
  return { newRuns };
}

module.exports = { syncSpeedruns, syncHistory, syncMissed, fetchGameDetail };
