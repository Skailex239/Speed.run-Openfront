const fetch = require("node-fetch");
const fs = require("fs");

const API_BASE         = "https://api.openfront.io";
const FETCH_TIMEOUT    = 5_000;
const TIME_OFFSET_SECS = 32;

const CONCURRENCY_NORMAL  = 5;
const CONCURRENCY_HISTORY = 5;
const BATCH_DELAY_NORMAL  = 1000;
const BATCH_DELAY_HISTORY = 1000;
const CHECKPOINT_EVERY = 20;
const MAX_HISTORY_WINDOWS_PER_RUN = 100; // limite pour éviter que le job ne dure trop longtemps
const DELAY_429 = 5_000;

const WINDOW_MS  = 2 * 60 * 1_000; // 2 minutes par fenêtre
const HISTORY_MS = 360 * 24 * 60 * 60 * 1_000; // ~360 jours
const TARGET_DATE = new Date("2025-12-01").getTime(); // remonter jusqu'au 1er déc 2025

const RUNS_FILE = "runs.json";
const CHECKPOINT_FILE = "checkpoint.json";
const SEEN_FILE = "seen.json";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Persistence ──────────────────────────────────────────────────────────────
function loadRuns() {
  try { return JSON.parse(fs.readFileSync(RUNS_FILE, "utf8")); } catch { return []; }
}
function saveRuns(runs) {
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs));
}
function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))); } catch { return new Set(); }
}
function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen]));
}
function loadCheckpoints() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")); } catch { return {}; }
}
function saveCheckpoints(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp));
}

// ── Fetch avec retry sur 429 ──────────────────────────────────────────────────
async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        const wait = DELAY_429 * (attempt + 1);
        console.log(`[rate-limit] 429 — pause ${wait}ms (tentative ${attempt + 1})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      if (attempt === retries) throw e;
      await sleep(500);
    }
  }
}

// ── Semaphore ─────────────────────────────────────────────────────────────────
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  function next() {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  }
  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

// ── Cartes connues ────────────────────────────────────────────────────────────
const MAP_NAMES = {
  Europe: "Europe", "Europe Classic": "Europe Classic", World: "Monde",
  "World Rotated": "World Rotated", Asia: "Asie", "East Asia": "East Asia",
  Africa: "Afrique", Australia: "Australie", Iceland: "Islande",
  "North America": "Amérique du Nord", "South America": "Amérique du Sud",
  Japan: "Japon", Italy: "Italie", Italia: "Italia", Britannia: "Britannia",
  "Britannia Classic": "Britannia Classic", Mars: "Mars", Pluto: "Pluto",
  Pangaea: "Pangée", "Bosphorus Straits": "Bosphore", "Bering Strait": "Détroit de Béring",
  "Strait of Gibraltar": "Strait of Gibraltar", "Strait of Hormuz": "Strait of Hormuz",
  "Black Sea": "Black Sea", "Between Two Seas": "Between Two Seas",
  Alps: "Alpes", Hawaii: "Hawaï", Arctic: "Arctique", "Nile Delta": "Delta du Nil",
  "San Francisco": "San Francisco", "New York City": "New York City",
  Montreal: "Montreal", Passage: "Passage", "The Box": "The Box",
  "Traders Dream": "Traders Dream", Yenisei: "Iénisseï", Baikal: "Baikal",
  "Amazon River": "Amazon River", "Gulf of St. Lawrence": "Gulf of St. Lawrence",
  "Gateway to the Atlantic": "Gateway to the Atlantic", "Falkland Islands": "Falkland Islands",
  "Faroe Islands": "Faroe Islands", "Four Islands": "Four Islands",
  Lemnos: "Lemnos", Aegean: "Aegean", Halkidiki: "Halkidiki", Lisbon: "Lisbon",
  Mena: "Mena", Achiran: "Achiran", Svalmel: "Svalmel", Manicouagan: "Manicouagan",
  Sierpinski: "Sierpinski", Surrounded: "Surrounded", "Two Lakes": "Two Lakes",
  "Deglaciated Antarctica": "Deglaciated Antarctica",
};
function normalizeName(n) { return MAP_NAMES[n] || n; }

// ── Appel liste de parties dans une fenêtre temporelle ────────────────────────
async function fetchGamesInWindow(start, end) {
  const url = `${API_BASE}/public/games?start=${start.toISOString()}&end=${end.toISOString()}`;
  const data = await fetchWithRetry(url);
  if (!data) return [];
  const games = Array.isArray(data) ? data : (data.games || []);
  return games.filter(g =>
    (g.difficulty === "Easy" || g.difficulty === "Medium" || g.difficulty === "Hard") &&
    (g.numPlayers == null || g.numPlayers >= 10) &&
    (g.mode === "Free For All" || g.mode === "FFA" || g.mode == null) &&
    (g.type === "Public" || g.type == null)
  );
}

async function fetchGameDetail(gameId) {
  return fetchWithRetry(`${API_BASE}/public/game/${gameId}`);
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

  // ── Règles speedrun ──────────────────────────────────────────────────────
  if (config.gameType    !== "Public")       return null;
  if (config.gameMode    !== "Free For All") return null;
  if (config.gameMapSize !== "Normal")       return null;
  if (config.bots        !== 400)            return null;

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
  return {
    id: gameId,
    player: winnerPlayer.username,
    map: normalizeName(config.gameMap || "Inconnu"),
    duration_s: durationSecs,
    difficulty: config.difficulty || "Medium",
    bots: 400,
    timestamp: detail.start
      ? new Date(detail.start > 1e10 ? detail.start : detail.start * 1000).toISOString()
      : new Date().toISOString(),
  };
}

// ── Traitement parallèle avec sémaphore ───────────────────────────────────────
async function processGames(games, { concurrency = CONCURRENCY_NORMAL, batchDelay = BATCH_DELAY_NORMAL } = {}) {
  const seen = loadSeen();
  const unseen = games.filter(g => g.game && !seen.has(g.game));
  if (unseen.length === 0) return 0;

  console.log(`[sync] ${unseen.length} parties → parallèle (max ${concurrency} simultané)`);

  const sem = createSemaphore(concurrency);
  let newRuns = 0;
  let errors = 0;
  const runs = loadRuns();
  const runIds = new Set(runs.map(r => r.id));

  const tasks = unseen.map(game => sem(async () => {
    const gameId = game.game;
    try {
      const raw = await fetchGameDetail(gameId);
      seen.add(gameId); // marquer même si pas de run valide
      const run = extractSpeedrun(raw);
      if (run && !runIds.has(run.id)) {
        runs.push(run);
        runIds.add(run.id);
        newRuns++;
        console.log(`[sync] ✅ ${run.player} — ${run.map} — ${Math.floor(run.duration_s / 60)}m${run.duration_s % 60}s`);
      }
    } catch (e) {
      errors++;
      console.warn(`[sync] ⚠️ ${gameId}: ${e.message}`);
    }
  }));

  await Promise.allSettled(tasks);

  if (newRuns > 0) {
    saveRuns(runs);
    console.log(`[sync] 💾 ${newRuns} nouveaux runs sauvegardés`);
  }
  saveSeen(seen);

  if (batchDelay > 0) await sleep(batchDelay);
  if (errors > 0) console.log(`[sync] ${errors} erreur(s) — seront retentées`);
  return newRuns;
}

// ── Sync normale : fenêtre 24h ───────────────────────────────────────────────
async function syncSpeedruns() {
  console.log(`[sync] Démarrage normal — ${new Date().toISOString()}`);
  let newRuns = 0;
  try {
    const now = new Date();
    const ago = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const games = await fetchGamesInWindow(ago, now);
    console.log(`[sync] ${games.length} parties candidates`);
    newRuns = await processGames(games, {
      concurrency: CONCURRENCY_NORMAL,
      batchDelay: BATCH_DELAY_NORMAL,
    });
    const cp = loadCheckpoints();
    cp.last_sync_time = String(Date.now());
    saveCheckpoints(cp);
    console.log(`[sync] ✅ Terminé — ${newRuns} nouveaux runs`);
  } catch (e) {
    console.error(`[sync] ❌ ${e.message}`);
  }
  return newRuns;
}

// ── Sync historique avec checkpoint ──────────────────────────────────────────
async function syncHistory() {
  const now = Date.now();
  const oldest = TARGET_DATE; // 1er déc 2025

  const cp = loadCheckpoints();
  const saved = cp.history_oldest_reached;
  const resumeFrom = saved ? Math.max(parseInt(saved) - WINDOW_MS, oldest) : now;

  if (saved) {
    console.log(`[history] Reprise depuis ${new Date(resumeFrom).toISOString().slice(0,10)} (checkpoint trouvé)`);
  } else {
    console.log(`[history] Démarrage depuis aujourd'hui`);
  }

  const windows = [];
  for (let end = resumeFrom; end > oldest; end -= WINDOW_MS) {
    const start = Math.max(end - WINDOW_MS, oldest);
    windows.push({ start: new Date(start), end: new Date(end) });
  }

  console.log(`[history] ${windows.length} fenêtres restantes jusqu'au ${new Date(oldest).toISOString().slice(0,10)}`);
  if (windows.length === 0) {
    console.log(`[history] ✅ Historique déjà complet`);
    return 0;
  }

  let totalRuns = 0, done = 0;
  let oldestReached = resumeFrom;

  for (let i = 0; i < windows.length && i < MAX_HISTORY_WINDOWS_PER_RUN; i += CHECKPOINT_EVERY) {
    const batch = windows.slice(i, Math.min(i + CHECKPOINT_EVERY, MAX_HISTORY_WINDOWS_PER_RUN));

    const batchResults = await Promise.allSettled(
      batch.map(async ({ start, end }) => {
        const games = await fetchGamesInWindow(start, end);
        if (games.length === 0) return { start, runs: 0 };
        const runs = await processGames(games, { concurrency: CONCURRENCY_NORMAL, batchDelay: 0 });
        return { start, runs };
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        totalRuns += r.value.runs;
        if (r.value.runs > 0) console.log(`[history] +${r.value.runs} (${r.value.start.toISOString().slice(0,10)})`);
        oldestReached = r.value.start.getTime();
      }
    }

    cp.history_oldest_reached = String(oldestReached);
    saveCheckpoints(cp);
    done += batch.length;

    const pct = Math.round((done / windows.length) * 100);
    console.log(`[history] 💾 Checkpoint: ${done}/${windows.length} fenêtres (${pct}%) — ${totalRuns} runs — jusqu'au ${new Date(oldestReached).toISOString().slice(0,10)}`);
  }

  if (windows.length > MAX_HISTORY_WINDOWS_PER_RUN) {
    console.log(`[history] ⏹️ Limite atteinte (${MAX_HISTORY_WINDOWS_PER_RUN} fenêtres) — reprendra au prochain run`);
  } else {
    console.log(`[history] ✅ Terminé — ${totalRuns} runs insérés`);
  }
  return totalRuns;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[sync] 🚀 Démarrage...");
  const runs = loadRuns();
  console.log(`[sync] ${runs.length} runs existants`);

  // 1. Sync normale d'abord (24h) — rapide
  await syncSpeedruns();

  // 2. Sync historique en continu
  await syncHistory();

  const finalRuns = loadRuns();
  console.log(`[sync] 🏁 Terminé: ${finalRuns.length} runs total`);
}

main().catch(e => { console.error("[sync] Fatal:", e); process.exit(1); });
