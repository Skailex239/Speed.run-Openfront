const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const adapter = new FileSync("speedruns.json");
const db = low(adapter);
db.defaults({ runs: [], seen_games: [], checkpoints: [] }).write();

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
  return row ? row.value : null;
}
function setCheckpoint(key, value) {
  const existing = db.get("checkpoints").find({ key }).value();
  if (existing) {
    db.get("checkpoints").find({ key }).assign({ value }).write();
  } else {
    db.get("checkpoints").push({ key, value }).write();
  }
}

module.exports = {
  insertRun, insertRunsBatch, getLeaderboard, getMaps, isSeen, markSeen, markSeenBatch,
  getStats, getFeed, getPlayerMaps, getGlobalRanking,
  getCheckpoint, setCheckpoint,
};
