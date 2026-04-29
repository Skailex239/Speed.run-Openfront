# 🎮 OpenFront SpeedRun Leaderboard

Site de speedrun automatique pour [OpenFront.io](https://openfront.io), avec synchronisation
directe depuis `api.openfront.io`.

## Installation

```bash
# 1. Clone ou télécharge le projet
cd openfront-speedrun

# 2. Installe les dépendances
npm install

# 3. Copie le fichier de config (optionnel)
cp .env.example .env

# 4. Lance le serveur
npm start
```

Ouvre ensuite **http://localhost:3000** dans ton navigateur.

## Comment ça marche

```
┌─────────────────────────────────────────────────────────────┐
│                      Toutes les 10 min                       │
│                                                              │
│  api.openfront.io  ──→  sync.js  ──→  SQLite (speedruns.db) │
│   /game/list                             │                   │
│   /game/:id                              ↓                   │
│                                    server.js (Express)       │
│                                          │                   │
│                                    public/index.html         │
│                                    (le site du leaderboard)  │
└─────────────────────────────────────────────────────────────┘
```

### Flux de synchronisation

1. Appel `GET api.openfront.io/game/list` → liste les parties des 2 derniers jours
2. Filtre : **Singleplayer** + **1 joueur humain** + **partie terminée**
3. Pour chaque candidat : `GET api.openfront.io/game/:id` → détails complets
4. Vérifie que le joueur **a gagné** (80% territoire)
5. Calcule la durée et insère dans la base SQLite

## API du serveur

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/maps` | Liste des cartes avec stats |
| `GET` | `/api/runs/:map` | Runs d'une carte triés par temps |
| `POST` | `/api/sync` | Déclenche une sync manuelle |
| `POST` | `/api/runs` | Ajoute un run manuel |
| `GET` | `/api/status` | Uptime + logs de sync |

## Hébergement

### Option A — Render.com (gratuit)
1. Push ce projet sur GitHub
2. Crée un **Web Service** sur [render.com](https://render.com)
3. Commande de démarrage : `npm start`
4. Variable d'env : `PORT=10000`

### Option B — VPS (Railway, Fly.io, DigitalOcean...)
```bash
npm install
npm start
# ou avec PM2 pour garder le serveur actif :
pm2 start server.js --name openfront-speedrun
```

## Structure des fichiers

```
openfront-speedrun/
├── server.js        ← Serveur Express + routes API + cron
├── db.js            ← Base de données SQLite
├── sync.js          ← Logique de scraping OpenFront API
├── public/
│   └── index.html   ← Site du leaderboard (servi par Express)
├── speedruns.db     ← Créé automatiquement au premier démarrage
├── package.json
├── .env.example
└── README.md
```
