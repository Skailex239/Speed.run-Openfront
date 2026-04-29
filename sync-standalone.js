const fetch = require("node-fetch");
const fs = require("fs");

const API_BASE = "https://api.openfront.io";
const FETCH_TIMEOUT = 20_000;
const TIME_OFFSET_SECS = 32;

const CONCURRENCY_NORMAL = 5;
const CONCURRENCY_HISTORY = 1;
const BATCH_DELAY_NORMAL = 2000;
const BATCH_DELAY_HISTORY = 3000;
const CHECKPOINT_EVERY = 100;
const DELAY_429 = 30_000;

const TARGET_DATE = new Date('2025-12-01T00:00:00Z').getTime();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        const wait = DELAY_429 + (attempt * 10000);
        console.log(`[sync] 429 - attente ${wait/1000}s...`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === retries) throw e;
      await sleep(2000);
    }
  }
}

async function fetchGamesInWindow(start, end) {
  const url = `${API_BASE}/games?since=${start.toISOString()}&until=${end.toISOString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    if (res.status !== 429) console.log(`[sync] Erreur ${res.status}: ${url}`);
    return [];
  }
  const data = await res.json();
  if (!data.games) return [];
  
  return data.games.filter(g => {
    const isWin = g.won === 1;
    const isFFA = g.mode === "FFA";
    const isPublic = g.type === "Public";
    const enoughPlayers = (g.players || []).length >= 10;
    const notBotsOnly = g.difficulty !== 0;
    return isWin && isFFA && isPublic && enoughPlayers && notBotsOnly;
  });
}

async function fetchGameDetail(gameId) {
  const url = `${API_BASE}/game/${gameId}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return null;
  return res.json();
}

// Charger/Sauvegarder runs
function loadRuns() {
  if (fs.existsSync('runs.json')) {
    try {
      return JSON.parse(fs.readFileSync('runs.json', 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveRuns(runs) {
  fs.writeFileSync('runs.json', JSON.stringify(runs, null, 2));
}

function loadCheckpoint() {
  if (fs.existsSync('.checkpoint')) {
    try {
      return parseInt(fs.readFileSync('.checkpoint', 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function saveCheckpoint(timestamp) {
  fs.writeFileSync('.checkpoint', String(timestamp));
}

async function processGames(games, existingRuns) {
  const seen = new Set(existingRuns.map(r => r.game_id));
  const runs = [...existingRuns];
  let newRuns = 0;
  
  for (let i = 0; i < games.length; i += CONCURRENCY_NORMAL) {
    const batch = games.slice(i, i + CONCURRENCY_NORMAL);
    const results = await Promise.all(batch.map(async (game) => {
      if (seen.has(game.id)) return null;
      
      try {
        const detail = await fetchGameDetail(game.id);
        if (!detail || !detail.started_at || !detail.ended_at) return null;
        
        const start = new Date(detail.started_at).getTime() / 1000;
        const end = new Date(detail.ended_at).getTime() / 1000;
        const duration = Math.round(end - start + TIME_OFFSET_SECS);
        
        if (duration <= 0 || duration > 7200) return null;
        
        return {
          id: Date.now() + Math.random(),
          game_id: game.id,
          player: game.winner_name || "Unknown",
          map: game.map,
          duration_s: duration,
          won: 1,
          mode: game.mode,
          type: game.type,
          timestamp: new Date().toISOString()
        };
      } catch (e) {
        return null;
      }
    }));
    
    for (const run of results) {
      if (run) {
        runs.push(run);
        seen.add(run.game_id);
        newRuns++;
        console.log(`[sync] ✅ ${run.player} — ${run.map} — ${Math.floor(run.duration_s/60)}m${run.duration_s%60}s`);
      }
    }
    
    if (BATCH_DELAY_NORMAL > 0) await sleep(BATCH_DELAY_NORMAL);
  }
  
  return { runs, newRuns };
}

// Sync normale (24h)
async function syncNormal() {
  console.log(`[sync] === SYNC NORMALE (24h) ===`);
  const now = new Date();
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  console.log(`[sync] Fenêtre: ${windowStart.toISOString()} → ${now.toISOString()}`);
  
  const games = await fetchGamesInWindow(windowStart, now);
  console.log(`[sync] ${games.length} parties candidates`);
  
  if (games.length === 0) return 0;
  
  const existingRuns = loadRuns();
  const { runs, newRuns } = await processGames(games, existingRuns);
  
  if (newRuns > 0) {
    runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    saveRuns(runs);
    console.log(`[sync] ✅ ${newRuns} nouveaux runs, ${runs.length} total`);
  }
  
  return newRuns;
}

// Sync historique (jusqu'à décembre 2025)
async function syncHistory() {
  console.log(`[sync] === SYNC HISTORIQUE ===`);
  const WINDOW_MS = 2 * 60 * 1000; // 2 minutes
  const now = Date.now();
  const oldest = TARGET_DATE;
  
  // Reprendre depuis checkpoint
  const savedCheckpoint = loadCheckpoint();
  const resumeFrom = savedCheckpoint ? Math.max(savedCheckpoint - (WINDOW_MS * 5), oldest) : now;
  
  if (savedCheckpoint) {
    console.log(`[history] Reprise depuis ${new Date(resumeFrom).toISOString().slice(0, 10)}`);
  } else {
    console.log(`[history] Démarrage depuis aujourd'hui → 1er décembre 2025`);
  }
  
  let current = resumeFrom;
  let totalNewRuns = 0;
  let windowsProcessed = 0;
  const existingRuns = loadRuns();
  let runs = [...existingRuns];
  const seen = new Set(existingRuns.map(r => r.game_id));
  
  while (current > oldest) {
    const windowStart = new Date(current - WINDOW_MS);
    const windowEnd = new Date(current);
    
    const games = await fetchGamesInWindow(windowStart, windowEnd);
    
    if (games.length > 0) {
      console.log(`[history] ${windowStart.toISOString()} → ${games.length} games`);
      
      for (let i = 0; i < games.length; i += CONCURRENCY_HISTORY) {
        const batch = games.slice(i, i + CONCURRENCY_HISTORY);
        
        for (const game of batch) {
          if (seen.has(game.id)) continue;
          
          try {
            const detail = await fetchGameDetail(game.id);
            if (!detail || !detail.started_at || !detail.ended_at) continue;
            
            const start = new Date(detail.started_at).getTime() / 1000;
            const end = new Date(detail.ended_at).getTime() / 1000;
            const duration = Math.round(end - start + TIME_OFFSET_SECS);
            
            if (duration <= 0 || duration > 7200) continue;
            
            const run = {
              id: Date.now() + Math.random(),
              game_id: game.id,
              player: game.winner_name || "Unknown",
              map: game.map,
              duration_s: duration,
              won: 1,
              mode: game.mode,
              type: game.type,
              timestamp: new Date().toISOString()
            };
            
            runs.push(run);
            seen.add(run.game_id);
            totalNewRuns++;
            console.log(`[history] ✅ ${run.player} — ${run.map} — ${Math.floor(run.duration_s/60)}m${run.duration_s%60}s`);
          } catch (e) {
            // Continue
          }
        }
        
        if (BATCH_DELAY_HISTORY > 0) await sleep(BATCH_DELAY_HISTORY);
      }
    }
    
    current -= WINDOW_MS;
    windowsProcessed++;
    
    // Checkpoint tous les 100 fenêtres
    if (windowsProcessed % CHECKPOINT_EVERY === 0) {
      saveCheckpoint(current);
      runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      saveRuns(runs);
      console.log(`[history] 💾 Checkpoint: ${windowsProcessed} fenêtres, ${totalNewRuns} nouveaux runs`);
    }
  }
  
  // Sauvegarde finale
  if (totalNewRuns > 0) {
    runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    saveRuns(runs);
  }
  
  saveCheckpoint(oldest);
  console.log(`[history] ✅ Terminé — ${totalNewRuns} runs historiques ajoutés`);
  return totalNewRuns;
}

// Main
async function main() {
  console.log(`[sync] =====================================`);
  console.log(`[sync] Démarrage sync — ${new Date().toISOString()}`);
  console.log(`[sync] =====================================`);
  
  // Sync normale d'abord (rapide)
  const normalRuns = await syncNormal();
  
  // Sync historique si premier run ou si demandé
  const args = process.argv.slice(2);
  if (args.includes('--history') || loadRuns().length === 0) {
    await syncHistory();
  }
  
  console.log(`[sync] =====================================`);
  console.log(`[sync] Terminé — ${new Date().toISOString()}`);
  console.log(`[sync] =====================================`);
}

main().catch(e => {
  console.error('[sync] Erreur fatale:', e);
  process.exit(1);
});
