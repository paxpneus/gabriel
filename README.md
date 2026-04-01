# 🚀 Order Automation Pipeline

Sistema de automação de pedidos que integra **Bling ERP**, **Mercado Livre** e emissão de **NFe** via um pipeline de filas assíncronas. Cada pedido percorre etapas automáticas de validação — verificação de CNAE, match com dados do ML e agendamento de nota fiscal — sem intervenção manual.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework HTTP | Express 5 |
| Fila / Workers | BullMQ 5 |
| Broker | Redis (ioredis) |
| ORM | Sequelize 6 |
| Banco de dados | PostgreSQL |
| Scraping | Playwright + Stealth Plugin |
| HTTP Client | Axios |
| Planilhas | XLSX |

---

## Como funciona

O sistema opera em dois fluxos paralelos que se encontram no `MLOrderSyncQueue`:

```
Bling Webhook
    │
    ▼
BlingOrderQueue        ← valida e salva o pedido
    │
    ▼
CNPJQueue              ← verifica CNAE (CNPJ) ou passa direto (CPF)
    │
    ▼
MLOrderQueue           ← dispatcher para o sync
    │
    ▼                               ▼
MLOrderSyncQueue   ←────────  MLScrapingQueue (a cada 10 min)
    │                          baixa Excel do ML e enfileira rows
    ▼
NFeQueue (delayed)     ← agendado 1 dia antes da coleta
    │
    ▼
Bling API              ← emissão da NFe

NFeReconcilerQueue (a cada 5 min)
    └── verifica jobs perdidos no Redis e recria
```

### Status interno do pedido

```
OPEN
  → WAITING CHANNEL VALIDATION   (aguardando match com dados do ML)
  → WAITING FOR NFE EMISSION     (collection_date definida, NFe agendada)
  → EMITTED                      (NFe emitida com sucesso)
  → CANCELLED                    (pedido cancelado em alguma etapa)
```

---

## Pré-requisitos

- Node.js >= 18
- PostgreSQL >= 14
- Redis >= 6
- Conta ativa no Bling com aplicativo OAuth cadastrado
- Acesso à conta vendedor do Mercado Livre

---

## Instalação

```bash
# Clone o repositório
git clone <repo-url>
cd projeto

# Instale as dependências
npm install

# Instale os browsers do Playwright (necessário para o scraping do ML)
npx playwright install chromium
```

---

## Configuração do ambiente

Copie o arquivo de exemplo e preencha as variáveis:

```bash
cp .env-example .env
```

```env
PORT=3000
NODE_ENV=development          # em produção: production

# Banco de dados
DB_HOST=localhost
DB_PORT=5432
DB_NAME=seu_banco
DB_USER=postgres
DB_PASS=sua_senha

# Redis
REDIS_PORT=6379
REDIS_HOST=127.0.0.1
# REDIS_USERNAME=redis        # descomente se necessário
# REDIS_PASSWORD=redis        # descomente se necessário
REDIS_DB=0

# Scraping Mercado Livre
# ML_HEADLESS=true            # forçar headless independente do NODE_ENV
```

> ⚠️ Em produção, `NODE_ENV=production` já ativa o modo headless do Playwright automaticamente.

---

## Rodando o projeto

```bash
# Desenvolvimento (com hot reload)
npm run dev

# Produção
npm run build
npm start
```

O servidor sobe em `http://localhost:3000`. Você verá no console:

```
------------------- DB: Banco Conectado! -------------------
------------------- Rota registrada: /api/bling-orders -------------------
...
------------------- QUEUE: Workers Ativos! -------------------
------------------- SERVER: Rodando em http//localhost:3000 -------------------
```

---

## Configuração das Integrações

Antes de usar o sistema, é necessário cadastrar a integração com a Bling e o respectivo `ConfigToken` diretamente no banco. Faça isso via `INSERT` ou pela rota da API.

### 1. Criar a Integration

```sql
INSERT INTO integrations (id, name, type, api_url, cnaes, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'Bling',
  'SYSTEM',
  'https://www.bling.com.br/Api/v3',
  ARRAY['4771701', '4771702'],  -- CNAEs autorizados (ajuste conforme seu negócio)
  NOW(),
  NOW()
);
```

> O campo `cnaes` é um array de strings. Cadastre os CNAEs que sua empresa atende. Pedidos de clientes com CNPJ fora dessa lista serão automaticamente bloqueados.

### 2. Criar o ConfigToken

Você precisa das credenciais do aplicativo cadastrado no painel da Bling em **Configurações → API → Aplicativos**.

```sql
INSERT INTO config_tokens (
  id,
  integrations_id,
  client_id,
  client_secret,
  access_token_url,
  auth_url,
  callback_url,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '<uuid da integration criada acima>',
  'seu_client_id_da_bling',
  'seu_client_secret_da_bling',
  'https://www.bling.com.br/Api/v3/oauth/token',
  'https://www.bling.com.br/Api/v3/oauth/authorize',
  'https://seudominio.com/api/bling-orders/callback',
  NOW(),
  NOW()
);
```

> `callback_url` deve ser exatamente a mesma URL cadastrada no painel do aplicativo Bling.

### 3. Autorizar o OAuth da Bling

Com o servidor rodando, acesse no navegador:

```
GET http://localhost:3000/api/bling-orders/auth/bling
```

Você será redirecionado para a tela de autorização da Bling. Após aprovar, o sistema salva automaticamente o `access_token` e o `refresh_token` no banco.

A partir daí o token é renovado automaticamente pelo interceptor do Axios sempre que expirar.

### 4. Configurar o Webhook na Bling

No painel da Bling, vá em **Configurações → Notificações** e cadastre:

```
URL: https://seudominio.com/api/bling-orders/webhook
Eventos: Pedidos (criado, atualizado, excluído)
```

---

## Rotas disponíveis

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/bling-orders/webhook` | Recebe eventos de pedidos da Bling |
| `GET` | `/api/bling-orders/auth/bling` | Inicia o fluxo OAuth com a Bling |
| `GET` | `/api/bling-orders/callback` | Callback OAuth — salva os tokens |
| `GET` | `/api/integrations` | Lista integrações |
| `GET` | `/api/customers` | Lista clientes |
| `GET` | `/api/orders` | Lista pedidos |
| `GET` | `/api/order-history` | Lista histórico de pedidos |
| `GET` | `/api/steps` | Lista steps do pipeline |

---

## Testando o webhook manualmente

Em desenvolvimento, simule um pedido chegando da Bling:

```bash
curl -X POST http://localhost:3000/api/bling-orders/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "order.created",
    "data": {
      "id": 123456
    }
  }'
```

O sistema vai buscar o pedido completo na API da Bling e iniciar o pipeline.

---

## Scraping do Mercado Livre

O `MLScrapingQueue` roda automaticamente a cada 10 minutos assim que o servidor sobe. Ele:

1. Abre o navegador (Playwright) com sessão salva em `./ml_session/`
2. Acessa a área de vendas do ML
3. Baixa o relatório Excel em `./ml_downloads/`
4. Parseia cada linha e enfileira no `MLOrderSyncQueue`

Na primeira execução, pode ser necessário fazer login manualmente. Em desenvolvimento (`ML_HEADLESS=false` ou `NODE_ENV != production`), o navegador abre em modo visual para facilitar o debug de CAPTCHA ou login.

> ⚠️ Em ambientes containerizados, garanta que `./ml_session/` seja um volume persistente, caso contrário a sessão é perdida a cada deploy e o sistema precisará fazer login do zero.

---

## Resiliência

- **Retry automático**: todos os jobs tentam 3 vezes com backoff exponencial (5s → 10s → 20s)
- **Jobs mortos**: ficam preservados no Redis com `removeOnFail: false` para análise
- **NFeReconcilerQueue**: roda a cada 5 minutos e recria jobs de NFe que tenham sumido do Redis por crash ou restart

---

## Observabilidade (recomendado)

Para visualizar filas, jobs ativos, falhos e aguardando no Redis, suba o [Bull Board](https://github.com/felixmosh/bull-board):

```bash
npm install @bull-board/express @bull-board/api
```

Ou use o [Redis Insight](https://redis.io/insight/) para inspecionar os dados diretamente.

---

## Estrutura do projeto

```
src/
├── app.ts                        # Express app
├── server.ts                     # Entry point
├── config/
│   ├── axios.ts                  # Factory de instâncias Axios com interceptors
│   ├── database.js               # Config Sequelize CLI
│   ├── redis.ts                  # Conexão Redis
│   ├── routes.ts                 # Carregamento dinâmico de rotas
│   └── sequelize.ts              # Instância Sequelize
├── modules/
│   ├── association/              # Mapeamento de relacionamentos Sequelize
│   ├── handlers/
│   │   ├── bling/
│   │   │   ├── api/              # Instância blingApi + OAuth
│   │   │   └── services/
│   │   │       ├── bling-customers/
│   │   │       ├── bling-nfe/    # NFeQueue + NFeReconcilerQueue + NFeValidationService
│   │   │       └── bling-orders/ # BlingOrderQueue + BlingOrderService + routes
│   │   ├── cnpj/                 # CNPJQueue + integração API CNPJ
│   │   └── mercado-livre/        # MLScrapingQueue + MLOrderQueue + MLOrderSyncQueue
│   ├── integrations/             # CRUD de Integrations e ConfigTokens
│   └── sales/                    # CRUD de Orders, Customers, Steps, OrderHistory
├── queues/
│   └── index.ts                  # Instancia e encadeia todas as filas
└── shared/
    ├── types/queue/              # Tipos base das filas (nextStepOnQueue, etc.)
    └── utils/
        ├── base-models/          # BaseQueueService, BaseService, BaseRepository, BaseController
        ├── normalizers/          # document, webhook, dotToPoint
        └── validators/           # document validator
```

---

## Licença

ISC