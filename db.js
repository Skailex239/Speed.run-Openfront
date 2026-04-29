const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const fs = require('fs');

// Fetch global (Node 18+)
const fetch = global.fetch || require('node-fetch');

// Cache local avec lowdb
const adapter = new FileSync("speedruns.json");
const db = low(adapter);
db.defaults({ runs: [], seen_games: [], checkpoints: [] }).write();

// ── GitHub Backup ─────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'Skailex239/Speed.run-Openfront';
const USE_GITHUB_BACKUP = !!GITHUB_TOKEN;

let lastBackup = 0;
const BACKUP_INTERVAL = 2 * 60 * 1000; // 2 minutes minimum entre backups

async function backupToGitHub() {
  if (!USE_GITHUB_BACKUP) {
    console.log('[backup] Backup désactivé (pas de token)');
    return;
  }
  
  const now = Date.now();
  if (now - lastBackup < BACKUP_INTERVAL) {
    console.log('[backup] Interval pas atteint');
    return;
  }
  
  try {
    // Vérifier si le fichier existe localement
    if (!fs.existsSync('speedruns.json')) {
      console.log('[backup] Fichier speedruns.json inexistant localement');
      return;
    }
    
    const content = fs.readFileSync('speedruns.json', 'utf8');
    const runs = db.get('runs').size().value();
    console.log(`[backup] Fichier lu: ${content.length} bytes, ${runs} runs`);
    
    // Ne pas backup si pas assez de runs (pour éviter d'écraser les données)
    if (runs < 10) {
      console.log(`[backup] ⏳ Ignoré - seulement ${runs} runs (minimum 10 pour backup)`);
      return;
    }
    
    const contentBase64 = Buffer.from(content).toString('base64');
    
    // Essayer de récupérer le sha actuel (pour update)
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/speedruns.json`;
    let sha = null;
    
    console.log('[backup] Vérification fichier existant sur GitHub...');
    try {
      const getRes = await fetch(apiUrl, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
      });
      console.log(`[backup] GET status: ${getRes.status}`);
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
        console.log('[backup] Fichier existant, sha:', sha.slice(0, 8) + '...');
      } else if (getRes.status === 404) {
        console.log('[backup] Fichier inexistant, création...');
      }
    } catch (e) {
      console.log('[backup] Erreur GET:', e.message);
    }
    
    // Créer ou mettre à jour
    const body = {
      message: `[auto] backup: ${runs} runs`,
      content: contentBase64,
      branch: 'main'
    };
    if (sha) body.sha = sha;
    
    console.log('[backup] Envoi vers GitHub API...');
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API ${response.status}: ${err}`);
    }
    
    lastBackup = now;
    console.log('[backup] ✅ Sauvegardé sur GitHub (API) :', runs, 'runs');
  } catch (e) {
    console.log('[backup] ❌ Erreur API:', e.message);
  }
}

// Restaurer depuis GitHub au démarrage via API
async function restoreFromGitHub() {
  if (!USE_GITHUB_BACKUP) {
    console.log('[backup] Restore désactivé (pas de token)');
    return;
  }
  
  try {
    console.log('[backup] Tentative de restauration depuis GitHub API...');
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/speedruns.json`;
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    console.log(`[backup] GET restore status: ${response.status}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log('[backup] Fichier speedruns.json non trouvé sur GitHub (premier backup?)');
      } else {
        console.log('[backup] Erreur GET restore:', response.status);
      }
      return;
    }
    
    const data = await response.json();
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    
    // Ne pas restaurer si fichier trop petit (vide ou corrompu)
    if (content.length < 50) {
      console.log(`[backup] Fichier GitHub trop petit (${content.length} bytes) - ignoré`);
      return;
    }
    
    // Écrire le fichier localement
    fs.writeFileSync('speedruns.json', content);
    console.log(`[backup] Fichier écrit: ${content.length} bytes`);
    
    // Recharger la DB
    db.read();
    
    const runs = db.get('runs').size().value();
    const checkpoints = db.get('checkpoints').size().value();
    console.log('[backup] ✅ Restauré depuis GitHub (API) :', runs, 'runs,', checkpoints, 'checkpoints');
  } catch (e) {
    console.log('[backup] ⚠️ Pas de restauration API:', e.message);
  }
}

// Backup périodique uniquement - pas de restauration automatique au boot
// (la restauration manuelle peut être faite via l'API /api/restore si besoin)
if (USE_GITHUB_BACKUP) {
  setInterval(backupToGitHub, 60000); // Backup toutes les minutes
  console.log('[backup] GitHub backup activé (sans restauration auto au boot)');
}



// ── insertRun ─────────────────────────────────────────────────────────────────

function insertRun(run) {

  if (db.get("runs").find({ game_id: run.game_id }).value()) return;



  const existing = db.get("runs")

    .find({ player: run.player, map: run.map, won: 1 })

    .value();



  if (existing) {

    if (run.duration_s < existing.duration_s) {

      db.get("runs")

        .find({ player: run.player, map: run.map })

        .assign({ ...run, created_at: new Date().toISOString() })

        .write();

      console.log(`[db] 🔄 Record battu ! ${run.player} sur ${run.map}`);

    }

  } else {

    db.get("runs")

      .push({ ...run, id: Date.now(), created_at: new Date().toISOString() })

      .write();

  }

}



// ── getLeaderboard ────────────────────────────────────────────────────────────

function getLeaderboard(map, limit = 5) {

  return db.get("runs")

    .filter(r => r.map === map && r.won === 1)

    .sortBy("duration_s")

    .take(limit)

    .value();

}



// ── getMaps ───────────────────────────────────────────────────────────────────

function getMaps() {

  const runs = db.get("runs").filter({ won: 1 }).value();

  const maps = {};

  runs.forEach(r => {

    if (!maps[r.map]) maps[r.map] = { map: r.map, total: 0, best: Infinity };

    maps[r.map].total++;

    if (r.duration_s < maps[r.map].best) maps[r.map].best = r.duration_s;

  });

  return Object.values(maps).sort((a, b) => a.map.localeCompare(b.map));

}



// ── isSeen / markSeen ─────────────────────────────────────────────────────────

function isSeen(gameId) {

  return !!db.get("seen_games").find({ game_id: gameId }).value();

}

function markSeen(gameId) {

  if (!isSeen(gameId)) {

    db.get("seen_games")

      .push({ game_id: gameId, checked_at: new Date().toISOString() })

      .write();

  }

}



// ── insertRunsBatch : insertion batch de plusieurs runs ───────────────────────

function insertRunsBatch(runs) {

  if (!runs || runs.length === 0) return;

  const existingIds = new Set(db.get("runs").map("game_id").value());

  const existingSeen = new Set(db.get("seen_games").map("game_id").value());



  const toInsert = [];

  const toUpdate = [];



  for (const run of runs) {

    if (existingIds.has(run.game_id)) continue;



    const key = `${run.player}|${run.map}`;

    const existing = db.get("runs").find({ player: run.player, map: run.map, won: 1 }).value();



    if (existing) {

      if (run.duration_s < existing.duration_s) {

        toUpdate.push({ run, existing });

      }

    } else {

      toInsert.push({ ...run, id: Date.now() + Math.random(), created_at: new Date().toISOString() });

    }

  }



  // Insertions en une seule opération

  if (toInsert.length > 0) {

    db.get("runs").push(...toInsert).write();

  }



  // Mises à jour

  for (const { run, existing } of toUpdate) {

    db.get("runs")

      .find({ player: run.player, map: run.map })

      .assign({ ...run, created_at: new Date().toISOString() })

      .write();

  }



  // console.log(`[db] Batch: +${toInsert.length} insertions, ${toUpdate.length} updates`);

}



// ── markSeenBatch : marquer plusieurs parties d'un coup ───────────────────────

function markSeenBatch(gameIds) {

  if (!gameIds || gameIds.length === 0) return;

  const existing = new Set(db.get("seen_games").map("game_id").value());

  const newEntries = gameIds

    .filter(id => !existing.has(id))

    .map(id => ({ game_id: id, checked_at: new Date().toISOString() }));



  if (newEntries.length > 0) {

    db.get("seen_games").push(...newEntries).write();

  }

}



// ── getStats ──────────────────────────────────────────────────────────────────

function getStats() {

  const runs = db.get("runs").filter({ won: 1 }).value();

  const players = new Set(runs.map(r => r.player));

  const maps    = new Set(runs.map(r => r.map));

  const fastest = runs.length ? Math.min(...runs.map(r => r.duration_s)) : null;

  const avg     = runs.length ? runs.reduce((s,r) => s + r.duration_s, 0) / runs.length : 0;

  return {

    total_runs: runs.length, total_players: players.size,

    total_maps: maps.size, fastest_run: fastest, avg_duration: avg,

  };

}



// ── getFeed ───────────────────────────────────────────────────────────────────

function getFeed(limit = 10) {

  return db.get("runs").filter({ won: 1 })

    .sortBy("played_at").reverse().take(limit).value();

}



// ── getPlayerMaps ─────────────────────────────────────────────────────────────

function getPlayerMaps(player) {

  const runs = db.get("runs").filter(r => r.player === player && r.won === 1).value();

  const allRuns = db.get("runs").filter({ won: 1 }).value();



  // Meilleur temps du joueur par carte

  const byMap = {};

  runs.forEach(r => {

    if (!byMap[r.map] || r.duration_s < byMap[r.map].duration_s) byMap[r.map] = r;

  });



  const secsToTime = (s) => {

    const m = Math.floor(s / 60), sec = s % 60;

    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;

  };



  return Object.values(byMap).map(row => {

    // Calcul du rang sur cette carte

    const mapRuns = allRuns.filter(r => r.map === row.map);

    const bestsByPlayer = {};

    mapRuns.forEach(r => {

      if (!bestsByPlayer[r.player] || r.duration_s < bestsByPlayer[r.player]) {

        bestsByPlayer[r.player] = r.duration_s;

      }

    });

    const rank = Object.values(bestsByPlayer).filter(d => d < row.duration_s).length + 1;



    return {

      map:        row.map,

      time:       secsToTime(row.duration_s),

      duration_s: row.duration_s,

      rank,

      date:       row.played_at?.split("T")[0] ?? "",

      gameUrl:    row.game_id ? `https://openfront.io/game/${row.game_id}` : null,

    };

  }).sort((a, b) => a.rank - b.rank);

}



// ── getGlobalRanking ──────────────────────────────────────────────────────────

function getGlobalRanking(limit = 50) {

  const POINTS = [10, 5, 3, 2, 1];

  const runs = db.get("runs").filter({ won: 1 }).value();



  const bests = {};

  runs.forEach(r => {

    const key = `${r.player}|${r.map}`;

    if (!bests[key] || r.duration_s < bests[key].duration_s) bests[key] = r;

  });



  const byMap = {};

  Object.values(bests).forEach(r => {

    if (!byMap[r.map]) byMap[r.map] = [];

    byMap[r.map].push(r);

  });

  Object.values(byMap).forEach(arr => arr.sort((a,b) => a.duration_s - b.duration_s));



  const scores = {};

  Object.entries(byMap).forEach(([map, arr]) => {

    arr.slice(0,5).forEach((r, i) => {

      const pts = POINTS[i] || 0;

      if (!scores[r.player]) scores[r.player] = { player: r.player, points:0, maps:0, gold:0, silver:0, bronze:0 };

      scores[r.player].points += pts;

      scores[r.player].maps++;

      if (i===0) scores[r.player].gold++;

      if (i===1) scores[r.player].silver++;

      if (i===2) scores[r.player].bronze++;

    });

  });



  return Object.values(scores)

    .sort((a,b) => b.points - a.points || b.gold - a.gold)

    .slice(0, limit);

}



// ── getCheckpoint / setCheckpoint ────────────────────────────────────────────

function getCheckpoint(key) {
  const row = db.get("checkpoints").find({ key }).value();
  const value = row ? row.value : null;
  console.log(`[checkpoint] GET ${key}: ${value ? 'trouvé' : 'non trouvé'}`);
  return value;
}

function setCheckpoint(key, value) {
  const existing = db.get("checkpoints").find({ key }).value();
  if (existing) {
    db.get("checkpoints").find({ key }).assign({ value }).write();
  } else {
    db.get("checkpoints").push({ key, value }).write();
  }
  console.log(`[checkpoint] SET ${key}: ${value}`);
}



// Reset les checkpoints au démarrage sur Render (car la DB est perdue à chaque déploiement)
function resetCheckpoints() {
  db.set("checkpoints", []).write();
  console.log("[checkpoint] RESET - tous les checkpoints effacés");
}

// Lister tous les checkpoints pour le debug
function listCheckpoints() {
  const all = db.get("checkpoints").value();
  console.log(`[checkpoint] Liste: ${all.length} checkpoint(s)`);
  all.forEach(c => console.log(`[checkpoint]   - ${c.key}: ${c.value}`));
  return all;
}



module.exports = {

  insertRun, insertRunsBatch, getLeaderboard, getMaps, isSeen, markSeen, markSeenBatch,

  getStats, getFeed, getPlayerMaps, getGlobalRanking,

  getCheckpoint, setCheckpoint, resetCheckpoints, listCheckpoints, restoreFromGitHub,

};

