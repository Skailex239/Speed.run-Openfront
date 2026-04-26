require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const cron    = require("node-cron");
const path    = require("path");

const {
  getLeaderboard, getMaps, insertRun, getStats,
  getGlobalRanking, getPlayerMaps, getFeed, resetCheckpoints
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

app.listen(PORT, () => {
  console.log(`\n🎮  OpenFront SpeedRun · http://localhost:${PORT}\n`);
  
  // Reset les checkpoints sur Render pour repartir proprement
  if (process.env.RENDER) {
    resetCheckpoints();
  }
  
  setTimeout(async () => {
    await syncMissed();
    console.log("[boot] Sync historique...");
    await syncHistory();
  }, 2000);
});
