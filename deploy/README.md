# Deploy blue-green da api

Problema que isso resolve: hoje o Portainer recria o único container da
`api` a cada deploy, e nessa janela (o antigo já parou, o novo ainda não
subiu) o Caddy fica sem upstream — todo mundo conectado, inclusive via
WebSocket, cai por alguns segundos.

## Como funciona

- `docker-compose.yml` agora define `api-blue` e `api-green`: duas cópias
  do mesmo serviço, sempre rodando as duas em paralelo, cada uma só
  acessível internamente na rede `backend` (não publicam porta no host).
- `Caddyfile` não aponta mais direto para `api:3000` — ele dá `import
  active-upstream`, um snippet em `caddy/active-upstream` que diz pra qual
  cor (`api-blue:3000` ou `api-green:3000`) o tráfego vai.
- `deploy/deploy.sh` builda a imagem nova, sobe só a cor **ociosa** (a que
  não está recebendo tráfego agora), espera o healthcheck dela reportar
  `healthy` e só então reescreve `caddy/active-upstream` e manda o Caddy
  recarregar (`caddy reload`, que troca de config sem derrubar conexão
  nenhuma). A cor antiga **não é parada** — continua rodando, ociosa, como
  rede de segurança.
- `deploy/switch.sh blue|green` só troca o tráfego na mão (sem build, sem
  esperar healthcheck) — serve tanto pra rollback instantâneo depois de um
  deploy ruim quanto pra alternar manualmente.

## Antes de usar

1. **Descubra o nome do projeto que o Portainer usou pra essa stack.**
   Isso é essencial: se os scripts rodarem com um `COMPOSE_PROJECT_NAME`
   diferente do que o Portainer usou, o `docker compose` vai gerenciar uma
   stack paralela em vez da que já está no ar. Rode `docker compose ls`
   no host e veja o nome — geralmente é o nome da stack no Portainer, em
   minúsculo. Exporte antes de rodar qualquer script:

   ```bash
   export COMPOSE_PROJECT_NAME=<nome-da-stack-no-portainer>
   ```

2. **Suba a stack pelo menos uma vez com `docker compose up -d` normal**
   (via Portainer mesmo) depois de puxar essa mudança, pra `api-blue` e
   `api-green` existirem os dois. `caddy/active-upstream` já vem
   apontando pra `api-blue` por padrão.

## Uso no dia a dia

Depois de dar `git pull` no host com o código novo:

```bash
cd /caminho/do/repo
export COMPOSE_PROJECT_NAME=<nome-da-stack-no-portainer>
./deploy/deploy.sh
```

Se algo não ficar saudável, o script aborta **antes** de trocar o
tráfego — quem está no ar não é afetado.

Se depois de trocar o tráfego algo se mostrar errado (um bug que só
aparece com uso real, por exemplo), reverte na hora sem rebuildar nada:

```bash
./deploy/switch.sh blue   # ou green, a cor que estava no ar antes
```

## Limitações / cuidados

- **Migrations continuam sendo compartilhadas pelas duas cores** (mesmo
  banco). O `deploy.sh` roda as migrations antes de subir a cor nova, o
  que significa que, durante a janela em que a cor antiga ainda está
  respondendo tráfego, ela já está rodando contra o schema novo. Migration
  que quebra compatibilidade com o código antigo (remover/renomear coluna
  que o código antigo ainda lê, por exemplo) não é segura nesse modelo —
  precisa ser expand/contract (adicionar o novo, deixar o velho, migrar
  em duas etapas).
- Os workers (`workers`, `worker-bling`, `worker-tecinco`,
  `worker-automation`, `worker-scraping`) **não** entraram nesse esquema
  blue-green — eles processam fila em background, não atendem usuário
  direto, então recriar via Portainer normalmente (com o shutdown
  gracioso que também foi adicionado no `server.ts`) já é suficiente. Se
  algum dia isso incomodar, dá pra aplicar o mesmo padrão neles.
- Como a cor ociosa fica sempre no ar, a `api` roda em dobro (duas
  instâncias do processo Node) o tempo todo, mesmo fora de deploy — é o
  preço do rollback instantâneo. Se os recursos da VPS apertarem, dá pra
  rodar `docker compose stop api-<cor-antiga>` manualmente depois de
  confirmar que o deploy novo está estável.
