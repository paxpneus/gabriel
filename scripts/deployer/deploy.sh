#!/usr/bin/env bash
# Deploy blue-green da API + recreate simples dos workers.
#
# Roda dentro do container `deployer` (docker.sock montado), disparado pelo
# webhook.js a cada push. Fluxo:
#   1. trava com flock (aborta se já tiver outro deploy em andamento)
#   2. atualiza o clone local do repo (/repo, próprio do deployer)
#   3. builda a imagem nova (falha aqui = nada foi tocado)
#   4. sobe a imagem nova só no slot ocioso (api-blue ou api-green)
#   5. espera o healthcheck do Docker desse container ficar "healthy"
#   6. só então para/remove o slot antigo
#   7. recria os workers (sem gate de healthcheck - eles não recebem
#      tráfego HTTP direto, um restart curto é aceitável)
#
# Se o build ou o healthcheck falharem, o slot antigo nunca é tocado.
set -euo pipefail

LOCKFILE="/tmp/gabriel-deploy.lock"
REPO_DIR="/repo"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-60}"
HEALTH_POLL_INTERVAL=2
# Buffer pra garantir que o Caddy (health_interval 5s no Caddyfile) já
# marcou o slot novo como saudável antes de derrubar o antigo.
CADDY_SETTLE_BUFFER=10

: "${REPO_URL:?REPO_URL não definido}"
: "${GIT_BRANCH:=main}"
: "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME não definido - precisa bater com o nome da stack no Portainer}"

log() { echo "[deploy $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

dc() {
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$REPO_DIR/docker-compose.yml" "$@"
}

# healthy | stopped | absent | starting | unhealthy | none
container_state() {
    local svc="$1" cid
    cid=$(dc ps -q "$svc" 2>/dev/null || true)
    if [ -z "$cid" ]; then
        echo "absent"
        return
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" != "true" ]; then
        echo "stopped"
        return
    fi
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "none"
}

update_repo() {
    if [ -d "$REPO_DIR/.git" ]; then
        git -C "$REPO_DIR" fetch origin "$GIT_BRANCH"
        # Reset hard de propósito: este clone é de uso exclusivo do
        # deployer, nunca um working copy manual - não existe alteração
        # local pra perder.
        git -C "$REPO_DIR" reset --hard "origin/$GIT_BRANCH"
    else
        git clone --branch "$GIT_BRANCH" --single-branch "$REPO_URL" "$REPO_DIR"
    fi
    git -C "$REPO_DIR" rev-parse --short HEAD
}

wait_healthy() {
    local svc="$1" elapsed=0 state
    while true; do
        state=$(container_state "$svc")
        if [ "$state" = "healthy" ]; then
            return 0
        fi
        if [ "$state" = "stopped" ] || [ "$state" = "absent" ]; then
            log "$svc parou/sumiu durante o boot (estado: $state)."
            return 1
        fi
        if [ "$elapsed" -ge "$HEALTH_TIMEOUT" ]; then
            log "$svc não ficou 'healthy' em ${HEALTH_TIMEOUT}s (último estado: $state)."
            return 1
        fi
        sleep "$HEALTH_POLL_INTERVAL"
        elapsed=$((elapsed + HEALTH_POLL_INTERVAL))
    done
}

deploy_api() {
    local blue green target old
    blue=$(container_state api-blue)
    green=$(container_state api-green)

    if [ "$blue" = "healthy" ] && [ "$green" = "healthy" ]; then
        log "AVISO: api-blue e api-green estão os dois 'healthy' (deploy anterior deve ter falhado no meio). Tratando api-blue como o slot ativo."
        target=api-green
        old=api-blue
    elif [ "$green" = "healthy" ]; then
        target=api-blue
        old=api-green
    else
        # inclui o caso de instalação nova (os dois "absent")
        target=api-green
        old=api-blue
    fi

    log "Slot alvo: $target | slot atual: $old"

    log "Buildando $target (GIT_SHA=$GIT_SHA)..."
    if ! dc build "$target"; then
        log "ERRO: build falhou. Nenhum container em produção foi tocado."
        return 1
    fi

    # --no-deps é obrigatório aqui: sem ele o compose tentaria recriar/rodar
    # `migrate` de novo a cada deploy, e migration é sempre manual neste
    # projeto (o usuário roda db:migrate por conta própria).
    log "Subindo $target..."
    dc up -d --no-deps "$target"

    log "Aguardando healthcheck de $target (timeout ${HEALTH_TIMEOUT}s)..."
    if ! wait_healthy "$target"; then
        log "ERRO: healthcheck de $target falhou. Removendo só o slot novo, $old continua servindo."
        dc stop "$target" || true
        dc rm -f "$target" || true
        return 1
    fi

    log "$target saudável. Aguardando ${CADDY_SETTLE_BUFFER}s pro Caddy confirmar antes de derrubar $old..."
    sleep "$CADDY_SETTLE_BUFFER"

    if [ "$(container_state "$old")" != "absent" ]; then
        log "Removendo slot antigo ($old)..."
        dc stop "$old"
        dc rm -f "$old"
    else
        log "$old nunca existiu (primeiro deploy) - nada pra remover."
    fi

    log "API atualizada. Slot ativo agora: $target (versão $GIT_SHA)."
}

deploy_workers() {
    log "Atualizando workers (recreate simples, sem gate de healthcheck)..."
    # --no-deps pelo mesmo motivo do slot da API: nunca re-disparar `migrate`.
    dc up -d --no-deps --build workers worker-automation worker-bling worker-tecinco worker-scraping
}

main() {
    exec 9>"$LOCKFILE"
    if ! flock -n 9; then
        log "Já existe um deploy em andamento (lock ocupado). Abortando."
        exit 1
    fi
    trap 'flock -u 9' EXIT

    log "Atualizando repo ($GIT_BRANCH)..."
    export GIT_SHA
    GIT_SHA=$(update_repo)
    log "GIT_SHA=$GIT_SHA"

    deploy_api
    deploy_workers

    log "Deploy concluído com sucesso. Versão ativa: $GIT_SHA"
}

main "$@"
