#!/bin/bash
# install.sh — Déploiement du serveur MCP Hermes sur VPS
# Usage: bash install.sh

set -e

echo "=== Installation Hermes MCP Server ==="

# 1. Dépendances
echo "[1/5] Vérification de Node.js..."
node --version || { echo "ERREUR: Node.js non installé"; exit 1; }

# 2. Dépendances npm
echo "[2/5] Installation des dépendances npm..."
npm install

# 3. Fichier .env
if [ ! -f .env ]; then
  echo "[3/5] Création du fichier .env depuis .env.example..."
  cp .env.example .env
  echo "      ⚠  Édite /root/mcp-hermes-test/.env avec tes vraies valeurs avant de continuer."
else
  echo "[3/5] Fichier .env déjà présent."
fi

# 4. Service systemd
echo "[4/5] Installation du service systemd hermes-mcp..."
cp hermes-mcp.service /etc/systemd/system/hermes-mcp.service
systemctl daemon-reload
systemctl enable hermes-mcp

# 5. Test de connexion
echo "[5/5] Test de connexion vers l'API Hermes..."
source .env
HERMES_BASE_URL=$HERMES_BASE_URL HERMES_API_KEY=$HERMES_API_KEY node test-connection.js

echo ""
echo "=== Installation terminée ==="
echo "Démarre le service: systemctl start hermes-mcp"
echo "Vérifie les logs:   journalctl -u hermes-mcp -f"
echo "Santé du serveur:   curl http://localhost:\${PORT:-3001}/health"
