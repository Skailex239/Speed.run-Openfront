const fetch = require("node-fetch");
const fs = require("fs");

const API_BASE = "https://api.openfront.io";
const WINDOW_MS = 2 * 60 * 1000; // 2 min windows
const CONCURRENCY = 3;
const BATCH_DELAY = 3000;
const DELAY_429 = 30000;
const FETCH_TIMEOUT = 10000;
const CHECKPOINT_FILE = "checkpoint.json";
const RUNS_FILE = "runs.json";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Load runs
function loadRuns() {
  try { return JSON.parse(fs.readFileSync(RUNS_FILE, "utf8")); } catch { return []; }
}

// Save runs
function saveRuns(runs) {
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs));
}

// Load checkpoint (timestamp of last successful sync)
function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")); } catch { return { lastSync: Date.now() - 24 * 60 * 60 * 1000 }; }
}

// Save checkpoint
function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp));
}

// Fetch with retry on 429
async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        const wait = DELAY_429 * (attempt + 1);
        console.log(`[sync] 429 - attente ${wait/1000}s...`);
        await sleep(wait);
        continue;
      }
      if (res.status === 401) {
        console.log(`[sync] Erreur 401: ${url}`);
        return null;
      }
      if (!res.ok) {
        console.log(`[sync] Erreur ${res.status}: ${url}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      if (attempt === retries) { console.log(`[sync] Timeout: ${url}`); return null; }
      await sleep(2000);
    }
  }
  return null;
}

// Fetch games in a time window
async function fetchGamesInWindow(start, end) {
  const url = `${API_BASE}/public/games?start=${start.toISOString()}&end=${end.toISOString()}`;
  const data = await fetchWithRetry(url);
  if (!data) return [];
  const games = Array.isArray(data) ? data : (data.games || []);
  return games.filter(g =>
    g.type === "Public" &&
    g.mode === "Free For All" &&
    g.numPlayers >= 10
  );
}

// Fetch game detail
async function fetchGameDetail(gameId) {
  return fetchWithRetry(`${API_BASE}/public/game/${gameId}`);
}

// Extract speedrun from game detail
function extractSpeedrun(raw) {
  if (!raw || !raw.players) return null;
  const winner = raw.players.find(p => p.won === 1 || p.won === true);
  if (!winner) return null;
  const start = new Date(raw.start || raw.startTime);
  const end = new Date(raw.end || raw.endTime);
  const duration_s = Math.round((end - start) / 1000);
  if (duration_s < 60) return null;
  return {
    id: raw.game || raw.gameId || raw.id,
    map: raw.map || raw.mapName || "Unknown",
    player: winner.name || winner.username || winner.player,
    duration_s,
    timestamp: (raw.end || raw.endTime || raw.endedAt),
    difficulty: raw.difficulty || "Unknown",
    bots: raw.bots || raw.numPlayers || 0
  };
}

// Semaphore for concurrency
function sem(max) {
  let active = 0, queue = [];
  return fn => new Promise((resolve, reject) => {
    const run = () => { active++; fn().then(resolve).catch(reject).finally(() => { active--; if (queue.length) queue.shift()(); }); };
    if (active < max) run(); else queue.push(run);
  });
}

// Process a batch of games
async function processGames(games) {
  const runs = loadRuns();
  const seenIds = new Set(runs.map(r => r.id));
  const unseen = games.filter(g => !seenIds.has(g.game));
  if (unseen.length === 0) return 0;

  const s = sem(CONCURRENCY);
  let newCount = 0;
  const tasks = unseen.map(game => s(async () => {
    const raw = await fetchGameDetail(game.game);
    if (!raw) return;
    const run = extractSpeedrun(raw);
    if (run && !seenIds.has(run.id)) {
      runs.push(run);
      seenIds.add(run.id);
      newCount++;
    }
  }));
  await Promise.allSettled(tasks);
  if (newCount > 0) saveRuns(runs);
  return newCount;
}

// Sync recent runs (last 24h)
async function syncRecent() {
  const cp = loadCheckpoint();
  const now = new Date();
  let lastSync = new Date(cp.lastSync);
  if (isNaN(lastSync)) lastSync = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Cap to 24h max
  const maxStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (lastSync < maxStart) lastSync = maxStart;

  console.log(`[sync] Sync recent: ${lastSync.toISOString()} → ${now.toISOString()}`);
  let totalNew = 0;

  for (let end = now; end > lastSync; end -= WINDOW_MS) {
    const start = new Date(Math.max(end.getTime() - WINDOW_MS, lastSync.getTime()));
    try {
      const games = await fetchGamesInWindow(start, end);
      if (games.length > 0) {
        const n = await processGames(games);
        totalNew += n;
      }
    } catch (e) {
      console.error(`[sync] Error window ${start.toISOString()}:`, e.message);
    }
    await sleep(500);
  }

  cp.lastSync = now.getTime();
  saveCheckpoint(cp);
  console.log(`[sync] ✅ Sync recent terminé: ${totalNew} nouveaux runs`);
  return totalNew;
}

// Main
async function main() {
  console.log("[sync] Démarrage...");
  const runs = loadRuns();
  console.log(`[sync] ${runs.length} runs existants`);
  await syncRecent();
  const finalRuns = loadRuns();
  console.log(`[sync] Terminé: ${finalRuns.length} runs total`);
}

main().catch(e => { console.error("[sync] Fatal:", e); process.exit(1); });
