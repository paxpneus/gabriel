#!/usr/bin/env bash
set -euo pipefail

# Troca manualmente para qual cor o Caddy manda o tráfego, sem buildar nada
# nem esperar healthcheck — usado para rollback rápido depois de um
# deploy.sh (a cor antiga continua rodando em paralelo) ou pra alternar
# entre as duas na mão. Uso: deploy/switch.sh blue|green

cd "$(dirname "$0")/.."

COLOR="${1:-}"
if [ "$COLOR" != "blue" ] && [ "$COLOR" != "green" ]; then
  echo "uso: $0 blue|green" >&2
  exit 1
fi

: "${COMPOSE_PROJECT_NAME:?defina COMPOSE_PROJECT_NAME com o nome da stack no Portainer antes de rodar}"

CID=$(docker compose ps -q "api-${COLOR}")
if [ -z "$CID" ]; then
  echo "api-${COLOR} não está rodando — suba com 'docker compose up -d --no-deps api-${COLOR}' antes de trocar." >&2
  exit 1
fi

STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo "desconhecido")
if [ "$STATUS" != "healthy" ]; then
  echo "!! aviso: api-${COLOR} está '${STATUS}', não 'healthy'. Trocando mesmo assim." >&2
fi

cat > caddy/active-upstream <<EOF
reverse_proxy api-${COLOR}:3000 {
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up Host {host}
}
EOF

docker exec "$(docker compose ps -q caddy)" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "tráfego virado para api-${COLOR}."
