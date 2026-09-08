#!/usr/bin/env bash
set -euo pipefail

# Deploy blue-green da api: builda a imagem nova, sobe a cor ociosa (a que
# NÃO está recebendo tráfego), espera ela ficar healthy, vira o Caddy para
# ela — e é só isso. A cor antiga continua rodando em paralelo (não é
# parada), então um rollback é só um "deploy/switch.sh <cor antiga>", sem
# precisar rebuildar nada. Ver deploy/README.md para o passo a passo.
#
# IMPORTANTE: rode com o mesmo COMPOSE_PROJECT_NAME usado pelo Portainer
# para essa stack (confira em Portainer > Stacks, ou "docker compose ls"),
# senão este script vai gerenciar uma stack paralela em vez da que já está
# no ar.

cd "$(dirname "$0")/.."

: "${COMPOSE_PROJECT_NAME:?defina COMPOSE_PROJECT_NAME com o nome da stack no Portainer antes de rodar}"

ACTIVE_FILE="caddy/active-upstream"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-120}"
HEALTH_INTERVAL_S=3

log() { echo "==> $*"; }

current_color() {
  if grep -q "api-blue:3000" "$ACTIVE_FILE"; then
    echo "blue"
  else
    echo "green"
  fi
}

write_upstream() {
  local color="$1"
  cat > "$ACTIVE_FILE" <<EOF
reverse_proxy api-${color}:3000 {
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up Host {host}
}
EOF
}

wait_healthy() {
  local service="$1"
  local waited=0
  local cid status
  while true; do
    cid=$(docker compose ps -q "$service")
    if [ -n "$cid" ]; then
      status=$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "starting")
      if [ "$status" = "healthy" ]; then
        return 0
      fi
      if [ "$status" = "unhealthy" ]; then
        echo "!! $service ficou unhealthy" >&2
        docker compose logs --tail=80 "$service" >&2
        return 1
      fi
    fi
    if [ "$waited" -ge "$HEALTH_TIMEOUT_S" ]; then
      echo "!! timeout esperando $service ficar healthy" >&2
      docker compose logs --tail=80 "$service" >&2
      return 1
    fi
    sleep "$HEALTH_INTERVAL_S"
    waited=$((waited + HEALTH_INTERVAL_S))
  done
}

ACTIVE=$(current_color)
if [ "$ACTIVE" = "blue" ]; then IDLE="green"; else IDLE="blue"; fi

log "cor ativa agora: api-${ACTIVE} | nova versão vai subir em: api-${IDLE}"

log "rodando migrations"
docker compose run --rm migrate

log "build da imagem nova"
docker compose build "api-${IDLE}"

log "subindo api-${IDLE} com a imagem nova"
docker compose up -d --no-deps "api-${IDLE}"

log "esperando api-${IDLE} ficar healthy (timeout ${HEALTH_TIMEOUT_S}s)"
if ! wait_healthy "api-${IDLE}"; then
  echo "!! api-${IDLE} não ficou saudável — abortando sem trocar o tráfego. api-${ACTIVE} continua no ar normalmente." >&2
  exit 1
fi

log "virando o tráfego do Caddy para api-${IDLE}"
write_upstream "$IDLE"
CADDY_CID=$(docker compose ps -q caddy)
docker exec "$CADDY_CID" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

log "deploy concluído. Ativo agora: api-${IDLE} (api-${ACTIVE} segue rodando, ociosa, pra rollback rápido)"
