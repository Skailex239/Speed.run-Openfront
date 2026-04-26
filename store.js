// store.js — Stockage JSONL des parties validées
// Indépendant de sync.js, branché via un hook d'événement.
// Prévu pour accueillir plusieurs modes : FFA, Duo, etc.

const fs   = require("fs");
const path = require("path");

// ── Fichiers par mode ──────────────────────────────────────────────────────────
const FILES = {
  ffa: path.join(__dirname, "ffa_games.jsonl"),
  duo: path.join(__dirname, "duo_games.jsonl"),
  // ajoute ici d'autres modes quand nécessaire
};

// ── Schéma compact (clés abrégées pour minimiser la taille sur disque) ────────
//   id  → game_id
//   p   → player
//   m   → map
//   d   → duration_s
//   dif → difficulty
//   b   → bots
//   at  → played_at
function toCompact(run) {
  return {
    id:  run.game_id,
    p:   run.player,
    m:   run.map,
    d:   run.duration_s,
    dif: run.difficulty,
    b:   run.bots,
    at:  run.played_at,
  };
}

// ── Écriture d'une ligne JSONL ─────────────────────────────────────────────────
function append(mode, run) {
  const file = FILES[mode];
  if (!file) {
    console.warn(`[store] Mode inconnu : "${mode}" — partie non stockée`);
    return;
  }
  const line = JSON.stringify(toCompact(run)) + "\n";
  fs.appendFileSync(file, line, "utf8");
}

// ── Lecture de toutes les parties d'un mode ────────────────────────────────────
function readAll(mode) {
  const file = FILES[mode];
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

// ── Nombre de parties stockées ────────────────────────────────────────────────
function count(mode) {
  const file = FILES[mode];
  if (!file || !fs.existsSync(file)) return 0;
  const content = fs.readFileSync(file, "utf8");
  return content.split("\n").filter(Boolean).length;
}

// ── Vérifie si une partie est déjà stockée (par game_id) ──────────────────────
// Utilise un Set en mémoire pour éviter de relire le fichier à chaque fois.
const _seen = {};
function _loadSeen(mode) {
  if (_seen[mode]) return;
  _seen[mode] = new Set(readAll(mode).map(e => e.id));
}
function isStored(mode, gameId) {
  _loadSeen(mode);
  return _seen[mode].has(gameId);
}

// ── Point d'entrée principal : appelé depuis sync.js après validation ──────────
// run = objet retourné par extractSpeedrun()
// mode = "ffa" | "duo" | ...
function storeRun(run, mode = "ffa") {
  _loadSeen(mode);
  if (_seen[mode].has(run.game_id)) return; // déjà stocké
  append(mode, run);
  _seen[mode].add(run.game_id);
}

module.exports = { storeRun, readAll, count, isStored, FILES };
