// reset-db.js — Remet la base de données à zéro
const fs = require("fs");

if (fs.existsSync("speedruns.json")) {
  fs.writeFileSync("speedruns.json", JSON.stringify({ speedruns: [], sync_log: [] }, null, 2));
  console.log("✅ Base de données remise à zéro !");
} else {
  console.log("ℹ️  Pas de base existante, rien à faire.");
}
