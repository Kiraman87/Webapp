# Hermes MCP Server — Guide d'installation

## Variables d'environnement à configurer

| Variable          | Description                                     | Exemple                          |
|-------------------|-------------------------------------------------|----------------------------------|
| `HERMES_BASE_URL` | URL de ton VPS (sans slash final)               | `https://hermes.monsite.com`     |
| `HERMES_API_KEY`  | Clé API (laisser vide si pas d'auth)            | `sk-xxxxx`                       |
| `HERMES_MODEL`    | Nom du modèle à utiliser                        | `hermes` ou `NousResearch/Hermes`|
| `PORT`            | Port du serveur HTTP/SSE (mode distant)         | `3001`                           |
| `MCP_SECRET`      | Secret partagé pour protéger l'endpoint MCP SSE | `un-secret-fort`                 |

---

## Option 1 — Claude Desktop (local, stdio)

### Installation

```bash
cd mcp-hermes
npm install
```

### Config Claude Desktop

Édite le fichier selon ton OS :
- **Mac** : `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** : `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hermes": {
      "command": "node",
      "args": ["/CHEMIN/ABSOLU/VERS/mcp-hermes/server.js"],
      "env": {
        "HERMES_BASE_URL": "https://TON-DOMAINE-VPS.com",
        "HERMES_API_KEY":  "TA_CLE_API_ICI",
        "HERMES_MODEL":    "hermes"
      }
    }
  }
}
```

Remplace `/CHEMIN/ABSOLU/VERS/` par le vrai chemin sur ton ordinateur.

Redémarre Claude Desktop → tu verras l'outil `chat_hermes` disponible.

---

## Option 2 — Claude Code CLI (stdio)

Le fichier `.claude/settings.json` est déjà configuré dans ce projet.  
Édite juste `HERMES_BASE_URL` et `HERMES_API_KEY` avec tes vraies valeurs.

```bash
cd mcp-hermes && npm install
# Puis lance Claude Code depuis la racine du projet
claude
```

---

## Option 3 — Serveur HTTP/SSE distant (sur ton VPS)

Idéal si tu veux accéder au MCP depuis plusieurs machines ou depuis l'app web.

### Déploiement sur le VPS

```bash
# Sur ton VPS Hostinger
git clone <ce-repo> /opt/hermes-mcp
cd /opt/hermes-mcp/mcp-hermes
npm install

# Lance avec les bonnes variables
HERMES_BASE_URL=http://localhost:11434 \
HERMES_API_KEY="" \
HERMES_MODEL=hermes \
PORT=3001 \
MCP_SECRET=un-secret-fort \
node server-http.js
```

### Config Nginx (reverse proxy HTTPS)

```nginx
server {
    listen 443 ssl;
    server_name mcp.TON-DOMAINE.com;

    # Tes certificats SSL (ex: Certbot)
    ssl_certificate     /etc/letsencrypt/live/mcp.TON-DOMAINE.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.TON-DOMAINE.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        # Nécessaire pour SSE (Server-Sent Events)
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

### Config Claude Desktop (mode SSE distant)

```json
{
  "mcpServers": {
    "hermes-remote": {
      "type": "sse",
      "url": "https://mcp.TON-DOMAINE.com/sse",
      "headers": {
        "x-mcp-secret": "un-secret-fort"
      }
    }
  }
}
```

---

## Test de connexion

```bash
# Teste que ton API Hermes répond bien
cd mcp-hermes
HERMES_BASE_URL=https://TON-DOMAINE-VPS.com \
HERMES_API_KEY=TA_CLE_API \
node test-connection.js
```

Résultat attendu :
```
Test de connexion vers: https://TON-DOMAINE-VPS.com

1. Liste des modèles disponibles...
   OK — modèles:
  - hermes

2. Test d'une requête de chat...
   OK — Réponse Hermes: "OK Hermes fonctionne!"

Test terminé.
```

---

## Outils MCP exposés

| Outil                | Description                                    |
|----------------------|------------------------------------------------|
| `chat_hermes`        | Envoie un message à Hermes, retourne sa réponse |
| `list_hermes_models` | Liste les modèles disponibles sur l'endpoint   |
