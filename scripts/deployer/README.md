# deployer

Serviço que recebe o webhook de push do GitHub e roda `deploy.sh`
(build → sobe o slot ocioso da API → espera healthcheck → troca de tráfego
via Caddy → remove o slot antigo → recria os workers). Ver comentários em
`deploy.sh` pro fluxo completo.

## Variáveis obrigatórias (`.env` na raiz do projeto)

- `DEPLOY_REPO_URL` — URL do repo Git (ex.: `https://github.com/paxpneus/gabriel.git`).
  O deployer mantém seu **próprio clone**, num volume dedicado
  (`deploy_repo`), separado de onde o Portainer guarda o checkout da stack.
- `DEPLOY_GIT_BRANCH` — branch de deploy (default `main`).
- `COMPOSE_PROJECT_NAME` — **precisa ser exatamente o nome da stack no
  Portainer.** O Compose identifica containers pelo par
  (project name, service name), não pelo caminho do `docker-compose.yml` -
  se esse valor não bater com o nome que o Portainer usa, o deploy cria um
  segundo project/stack em paralelo em vez de atualizar os containers que já
  estão servindo tráfego. Pra descobrir o nome atual: no Portainer, é o nome
  da stack; via CLI, `docker inspect <container-da-api-atual> --format '{{ index .Config.Labels "com.docker.compose.project" }}'`.
- `DEPLOY_WEBHOOK_SECRET` — segredo HMAC compartilhado com o GitHub (mesmo
  padrão do `WEBHOOK_SECRET` já usado pro webhook do Bling).
- `DEPLOY_HEALTH_TIMEOUT` — opcional, segundos de espera pelo healthcheck do
  slot novo antes de desistir (default `60`).

## Configurando o webhook no GitHub

Settings → Webhooks → Add webhook:
- Payload URL: `https://deploy.paxpneus.com.br/webhook`
- Content type: `application/json`
- Secret: o mesmo valor de `DEPLOY_WEBHOOK_SECRET`
- Evento: só `push`

## Por que não o webhook nativo do Portainer

O redeploy automático de stack do Portainer roda um `docker compose up -d
--build` sem lock, sem gate de healthcheck e sem blue-green - é
exatamente o mecanismo que causa a indisponibilidade que este serviço
existe pra eliminar. O Portainer continua útil só como painel de
visibilidade sobre os mesmos containers (o `deployer` fala com o Docker do
host via `docker.sock`, então tudo que ele faz aparece normalmente na UI).
