require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const cron    = require("node-cron");
const path    = require("path");

const {
  getLeaderboard, getMaps, insertRun, getStats,
  getGlobalRanking, getPlayerMaps, getFeed, resetCheckpoints, listCheckpoints
} = require("./db");
const { syncSpeedruns, syncHistory, syncMissed } = require("./sync");
const { fetchGameDetail } = require("./sync");

const app  = express();
const PORT = process.env.PORT || 3000;

function secsToTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function parseGameId(input) {
  if (!input) return null;
  input = input.trim();
  const match = input.match(/game\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{4,20}$/.test(input)) return input;
  return null;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// GET /api/maps
app.get("/api/maps", (req, res) => {
  const maps = getMaps();
  res.json(maps.map(m => ({
    map: m.map, count: m.total, best: m.best, bestTime: secsToTime(m.best),
  })));
});

// GET /api/runs/:map
app.get("/api/runs/:map", (req, res) => {
  const map  = decodeURIComponent(req.params.map);
  const runs = getLeaderboard(map, 5);
  res.json(runs.map((r, i) => ({
    rank:        i + 1,
    player:      r.player,
    map:         r.map,
    durationSecs: r.duration_s,
    time:        secsToTime(r.duration_s),
    difficulty:  r.difficulty,
    date:        r.played_at?.split("T")[0] ?? "",
    gameUrl:     r.game_id ? `https://openfront.io/game/${r.game_id}` : null,
    createdAt:   r.created_at || null,
  })));
});

// GET /api/ranking
app.get("/api/ranking", (req, res) => {
  try { res.json(getGlobalRanking(100)); }
  catch(e) { res.json([]); }
});

// GET /api/player/:name
app.get("/api/player/:name", (req, res) => {
  const player = decodeURIComponent(req.params.name);
  try {
    const maps = getPlayerMaps(player);
    res.json({ player, maps });
  } catch(e) {
    console.error("[player]", e.message);
    res.json({ player, maps: [] });
  }
});

// GET /api/feed
app.get("/api/feed", (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  try {
    const rows = getFeed(limit);
    res.json(rows.map(r => ({
      player:      r.player,
      map:         r.map,
      time:        secsToTime(r.duration_s),
      durationSecs: r.duration_s,
      difficulty:  r.difficulty,
      date:        r.played_at?.split("T")[0] ?? "",
      gameUrl:     r.game_id ? `https://openfront.io/game/${r.game_id}` : null,
      createdAt:   r.created_at,
    })));
  } catch(e) { res.json([]); }
});

// GET /api/status
app.get("/api/status", (req, res) => {
  const stats = getStats();
  res.json({
    uptime:       Math.floor(process.uptime()),
    totalRuns:    stats.total_runs,
    totalPlayers: stats.total_players,
    totalMaps:    stats.total_maps,
    fastestRun:   stats.fastest_run ? secsToTime(stats.fastest_run) : null,
  });
});

// POST /api/sync
app.post("/api/sync", async (req, res) => {
  console.log("[API] Sync manuelle");
  const result = await syncSpeedruns();
  res.json(result);
});

// POST /api/runs
app.post("/api/runs", async (req, res) => {
  const { player, map, minutes, seconds, gameLink } = req.body;
  if (!player) return res.status(400).json({ error: "Pseudo requis" });
  const duration_s = (parseInt(minutes)||0)*60 + (parseInt(seconds)||0);
  if (duration_s <= 0) return res.status(400).json({ error: "Durée invalide" });

  let game_id = null;
  if (gameLink) { const parsed = parseGameId(gameLink); if (parsed) game_id = parsed; }

  // Validation via l'API si un game ID est fourni
  if (game_id) {
    try {
      const raw = await fetchGameDetail(game_id);
      if (!raw || !raw.info) {
        return res.status(400).json({ error: "Partie introuvable — ce code de game n'existe pas" });
      }

      const detail = raw.info;
      const config = detail.config || {};

      // Vérifier que la partie est publique FFA
      if (config.gameType !== "Public" || config.gameMode !== "Free For All") {
        return res.status(400).json({ error: "Cette partie n'est pas un FFA Public" });
      }

      // Vérifier le gagnant
      const players = detail.players || [];
      const winner = detail.winner;
      if (!winner || !Array.isArray(winner) || winner.length < 2) {
        return res.status(400).json({ error: "Aucun gagnant trouvé dans cette partie" });
      }

      const winnerPlayer = players.find(p => p.clientID === winner[1]);
      if (!winnerPlayer) {
        return res.status(400).json({ error: "Gagnant introuvable dans les données de la partie" });
      }

      // Vérifier que le pseudo correspond au gagnant
      const submittedPlayer = player.trim().toLowerCase();
      const actualWinner = (winnerPlayer.username || "").toLowerCase();
      if (submittedPlayer !== actualWinner) {
        return res.status(400).json({ error: `Ce pseudo ne correspond pas au gagnant de cette partie. Le gagnant est : ${winnerPlayer.username}` });
      }

      // Vérifier le nombre de joueurs
      const humanPlayers = players.filter(p => !p.isBot);
      if (humanPlayers.length < 10) {
        return res.status(400).json({ error: `Pas assez de joueurs (${humanPlayers.length}/10 minimum)` });
      }

      // Utiliser les données réelles de l'API
      const actualMap = config.gameMap || map || "Europe";
      const actualDifficulty = config.difficulty || "Medium";

      const run = {
        game_id,
        player: winnerPlayer.username,
        map: actualMap,
        duration_s,
        difficulty: actualDifficulty,
        bots: config.bots || 400,
        won: 1,
        played_at: detail.start ? new Date(detail.start > 100000 ? detail.start : detail.start * 1000).toISOString() : new Date().toISOString(),
      };
      insertRun(run);
      res.json({ ok: true, run: { ...run, time: secsToTime(duration_s) } });
    } catch (e) {
      return res.status(400).json({ error: `Impossible de vérifier cette partie : ${e.message}` });
    }
  } else {
    // Soumission manuelle sans game link — pas de validation possible
    const run = {
      game_id: `manual-${Date.now()}`, player: player.trim().slice(0,32),
      map: map || "Europe", duration_s,
      difficulty: "—", bots: 400, won: 1,
      played_at: new Date().toISOString(),
    };
    insertRun(run);
    res.json({ ok: true, run: { ...run, time: secsToTime(duration_s) } });
  }
});

// GET /ping - keep-alive pour Render (empêche le serveur de s'endormir)
app.get("/ping", (req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

// Cron 2 min
cron.schedule("*/2 * * * *", () => {
  console.log("[cron] Sync auto");
  syncSpeedruns();
});

// Keep-alive : self-ping toutes les 10 min pour empêcher Render de s'endormir
const SELF_URL = process.env.RENDER_EXTERNAL_URL || null;
if (SELF_URL) {
  setInterval(async () => {
    try {
      await fetch(SELF_URL + "/ping");
      console.log("[keep-alive] ping OK");
    } catch (e) {
      console.warn("[keep-alive] ping échoué:", e.message);
    }
  }, 10 * 60 * 1000); // toutes les 10 min
}

// ── Middleware d'authentification Admin ───────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function requireAdminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Admin non configuré" });
  }
  
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).json({ error: "Authentification requise" });
  }
  
  const credentials = Buffer.from(auth.slice(6), 'base64').toString();
  const [username, password] = credentials.split(':');
  
  if (password !== ADMIN_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  
  next();
}

// ── Routes Admin ──────────────────────────────────────────────────────────────

// API - Lister toutes les runs (avec pagination)
app.get("/admin/api/runs", requireAdminAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const map = req.query.map;
  
  try {
    const low = require("lowdb");
    const FileSync = require("lowdb/adapters/FileSync");
    const db = low(new FileSync("speedruns.json"));
    
    let runs = db.get("runs").value();
    
    if (map) {
      runs = runs.filter(r => r.map === map);
    }
    
    runs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    
    const total = runs.length;
    const start = (page - 1) * limit;
    const paginated = runs.slice(start, start + limit);
    
    res.json({
      runs: paginated,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API - Supprimer une run par ID
app.delete("/admin/api/runs/:id", requireAdminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  
  try {
    const low = require("lowdb");
    const FileSync = require("lowdb/adapters/FileSync");
    const db = low(new FileSync("speedruns.json"));
    
    const run = db.get("runs").find({ id }).value();
    if (!run) {
      return res.status(404).json({ error: "Run non trouvée" });
    }
    
    db.get("runs").remove({ id }).write();
    console.log(`[admin] Run supprimée: ${run.player} - ${run.map}`);
    
    res.json({ success: true, message: "Run supprimée", run });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API - Statistiques admin
app.get("/admin/api/stats", requireAdminAuth, (req, res) => {
  try {
    const stats = getStats();
    const maps = getMaps();
    
    res.json({
      totalRuns: stats.total_runs,
      totalMaps: stats.total_maps,
      totalPlayers: stats.total_players,
      maps: maps.map(m => m.map).sort()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Page admin HTML protégée
app.get("/admin/panel", requireAdminAuth, (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Admin - OpenFront Speedrun</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a2e; color: #fff; }
    h1 { color: #4ecca3; }
    .stats { display: flex; gap: 20px; margin: 20px 0; }
    .stat-box { background: #2d2d44; padding: 15px; border-radius: 8px; min-width: 150px; }
    .stat-box h3 { margin: 0 0 10px 0; color: #4ecca3; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #444; }
    th { background: #2d2d44; }
    tr:hover { background: #2d2d44; }
    .btn-delete { background: #e74c3c; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px; }
    .btn-delete:hover { background: #c0392b; }
    .pagination { margin-top: 20px; display: flex; gap: 10px; align-items: center; }
    .pagination button { background: #4ecca3; color: #1a1a2e; border: none; padding: 8px 15px; cursor: pointer; border-radius: 4px; }
    .pagination button:disabled { background: #444; cursor: not-allowed; }
    .filters { margin: 20px 0; }
    .filters select, .filters input { padding: 8px; margin-right: 10px; background: #2d2d44; color: #fff; border: 1px solid #444; }
  </style>
</head>
<body>
  <h1>🎮 Panel Admin - OpenFront Speedrun</h1>
  
  <div class="stats" id="stats"></div>
  
  <div class="filters">
    <select id="mapFilter">
      <option value="">Toutes les cartes</option>
    </select>
    <input type="text" id="searchPlayer" placeholder="Rechercher un joueur...">
    <button onclick="loadRuns()">Recharger</button>
  </div>
  
  <table id="runsTable">
    <thead>
      <tr>
        <th>ID</th>
        <th>Joueur</th>
        <th>Carte</th>
        <th>Temps</th>
        <th>Difficulté</th>
        <th>Date</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
  
  <div class="pagination">
    <button onclick="prevPage()" id="btnPrev">← Précédent</button>
    <span id="pageInfo">Page 1</span>
    <button onclick="nextPage()" id="btnNext">Suivant →</button>
  </div>

  <script>
    let currentPage = 1;
    let totalPages = 1;
    
    async function loadStats() {
      const res = await fetch('/admin/api/stats');
      const data = await res.json();
      document.getElementById('stats').innerHTML = \`
        <div class="stat-box"><h3>Total Runs</h3><p>\${data.totalRuns}</p></div>
        <div class="stat-box"><h3>Cartes</h3><p>\${data.totalMaps}</p></div>
        <div class="stat-box"><h3>Joueurs</h3><p>\${data.totalPlayers}</p></div>
      \`;
      
      const mapSelect = document.getElementById('mapFilter');
      mapSelect.innerHTML = '<option value="">Toutes les cartes</option>';
      data.maps.forEach(map => {
        mapSelect.innerHTML += \`<option value="\${map}">\${map}</option>\`;
      });
    }
    
    async function loadRuns() {
      const map = document.getElementById('mapFilter').value;
      const search = document.getElementById('searchPlayer').value;
      const url = \`/admin/api/runs?page=\${currentPage}&limit=50\${map ? '&map=' + map : ''}\`;
      
      const res = await fetch(url);
      const data = await res.json();
      
      totalPages = data.pagination.pages;
      document.getElementById('pageInfo').textContent = \`Page \${currentPage} / \${totalPages}\`;
      document.getElementById('btnPrev').disabled = currentPage <= 1;
      document.getElementById('btnNext').disabled = currentPage >= totalPages;
      
      const tbody = document.querySelector('#runsTable tbody');
      tbody.innerHTML = '';
      
      data.runs.forEach(run => {
        if (search && !run.player.toLowerCase().includes(search.toLowerCase())) return;
        
        const time = Math.floor(run.duration_s / 60) + 'm' + (run.duration_s % 60) + 's';
        const date = run.created_at ? new Date(run.created_at).toLocaleDateString() : '-';
        
        tbody.innerHTML += \`
          <tr>
            <td>\${run.id}</td>
            <td>\${run.player}</td>
            <td>\${run.map}</td>
            <td>\${time}</td>
            <td>\${run.difficulty}</td>
            <td>\${date}</td>
            <td>
              <button class="btn-delete" onclick="deleteRun(\${run.id})">Supprimer</button>
            </td>
          </tr>
        \`;
      });
    }
    
    async function deleteRun(id) {
      if (!confirm('Êtes-vous sûr de vouloir supprimer cette run ?')) return;
      
      const res = await fetch(\`/admin/api/runs/\${id}\`, { method: 'DELETE' });
      if (res.ok) {
        alert('Run supprimée avec succès');
        loadRuns();
        loadStats();
      } else {
        alert('Erreur lors de la suppression');
      }
    }
    
    function prevPage() {
      if (currentPage > 1) {
        currentPage--;
        loadRuns();
      }
    }
    
    function nextPage() {
      if (currentPage < totalPages) {
        currentPage++;
        loadRuns();
      }
    }
    
    loadStats();
    loadRuns();
  </script>
</body>
</html>
  `);
});

// ── Démarrage ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎮  OpenFront SpeedRun · http://localhost:${PORT}\n`);
  
  // Afficher les checkpoints existants au démarrage
  console.log("[boot] Checkpoints existants:");
  listCheckpoints();
  
  // Reset des checkpoints désactivé pour permettre la persistance sur Render
  // if (process.env.RENDER) {
  //   resetCheckpoints();
  // }
  
  setTimeout(async () => {
    // 1. Sync normale d'abord (24h) - rapide, pour avoir des runs immédiatement
    console.log("[boot] Sync normale (24h) pour runs récents...");
    await syncSpeedruns();
    
    // 2. Sync historique en background (ne bloque pas)
    console.log("[boot] Lancement sync historique en background...");
    syncHistory().then(() => {
      console.log("[boot] Historique terminé !");
    }).catch(e => {
      console.error("[boot] Erreur historique:", e.message);
    });
    
    // 3. Sync des trous (missed) en background aussi
    syncMissed().catch(e => console.error("[boot] Erreur missed:", e.message));
  }, 2000);
});
