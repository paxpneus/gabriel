-- Rate limit da Bling com faixas: decide, de forma atômica, se ESTE ticket pode disparar agora.
-- Chamado em loop por waitForBlingRateLimit (bling_api.service.ts). Retorno: 0 = dispara; >0 = ms pra esperar e chamar de novo.
--
-- Vazão fixa: 1 vaga a cada `interval` ms. O script só escolhe QUEM usa cada vaga:
--   1. faixas strict (NFE_EMISSION) passam na frente de todas;
--   2. demais faixas se revezam em ordem alfabética, cada uma pegando até `weight` vagas seguidas;
--   3. dentro da faixa, menor score (job.timestamp) primeiro = job mais antigo termina antes.
-- Faixa = fila do job (jobContext). Faixa sem ticket esperando é pulada, então nenhuma vaga fica ociosa.

-- ─── Chaves ───────────────────────────────────────────────────────────────────
local lastKey = KEYS[1]  -- string: timestamp do último disparo concedido
local stateKey = KEYS[2] -- hash: cursor/credit (revezamento) + assigned/assignedAt/assignedLane (vaga reservada)
local lanesKey = KEYS[3] -- set: faixas com ao menos um ticket esperando
local aliveKey = KEYS[4] -- zset: ticket -> último heartbeat (cada chamada a este script é um heartbeat)
-- Cada faixa tem seu zset `lanePrefix .. faixa` (ticket -> score).

-- ─── Argumentos ───────────────────────────────────────────────────────────────
local ticket = ARGV[1]                   -- id único desta chamada à Bling
local lane = ARGV[2]                     -- faixa do chamador
local score = tonumber(ARGV[3])          -- job.timestamp do chamador (ordem dentro da faixa)
local now = tonumber(ARGV[4])
local interval = tonumber(ARGV[5])       -- BLING_RATE_LIMIT_INTERVAL_MS
local staleMs = tonumber(ARGV[6])        -- sem heartbeat há mais que isso = processo morreu esperando
local claimTimeoutMs = tonumber(ARGV[7]) -- tempo pro ticket escolhido buscar a vaga antes de perdê-la
local pollMs = tonumber(ARGV[8])         -- espera curta enquanto a vaga está reservada pra outro ticket
local lanePrefix = ARGV[9]
local defaultWeight = tonumber(ARGV[10])
local weights = cjson.decode(ARGV[11])     -- { [faixa] = peso } — override do defaultWeight
local strictLanes = cjson.decode(ARGV[12]) -- { faixa, ... } — ordem = prioridade entre strict
local keyTtlMs = 3600000                   -- só pra não deixar lixo se todos os processos morrerem

-- ─── Helpers ──────────────────────────────────────────────────────────────────
local function laneKey(name)
  return lanePrefix .. name
end

-- Tira o ticket da faixa e do heartbeat; faixa vazia sai do set de faixas ativas.
local function dropTicket(t, name)
  redis.call("ZREM", aliveKey, t)
  if not name then return end
  redis.call("ZREM", laneKey(name), t)
  if redis.call("ZCARD", laneKey(name)) == 0 then
    redis.call("SREM", lanesKey, name)
  end
end

local function isStrict(name)
  for _, strictName in ipairs(strictLanes) do
    if strictName == name then return true end
  end
  return false
end

local function weightOf(name)
  local weight = tonumber(weights[name])
  if weight and weight > 0 then return weight end
  return defaultWeight
end

-- Primeiro ticket VIVO da faixa (menor score). Ticket sem heartbeat recente é descartado pra não travar a faixa.
local function headOf(name)
  for _ = 1, 50 do
    local head = redis.call("ZRANGE", laneKey(name), 0, 0)[1]
    if not head then
      redis.call("SREM", lanesKey, name)
      return nil
    end
    local seen = tonumber(redis.call("ZSCORE", aliveKey, head))
    if seen and now - seen <= staleMs then return head end
    dropTicket(head, name)
  end
  return nil
end

-- Concede a vaga ao chamador: marca o disparo e remove o ticket (ele não volta a chamar o script).
local function grant()
  redis.call("SET", lastKey, now, "PX", interval * 1000)
  dropTicket(ticket, lane)
  return 0
end

-- ─── 1. Registro + heartbeat do chamador ──────────────────────────────────────
-- NX: mantém o score original; um ticket descartado (ex.: perdeu a vaga reservada) re-entra na mesma posição.
redis.call("ZADD", laneKey(lane), "NX", score, ticket)
redis.call("SADD", lanesKey, lane)
redis.call("ZADD", aliveKey, now, ticket)
for _, key in ipairs({ stateKey, lanesKey, aliveKey, laneKey(lane) }) do
  redis.call("PEXPIRE", key, keyTtlMs)
end

-- ─── 2. Vaga já reservada pra algum ticket ────────────────────────────────────
-- Quando a vaga abre e o escolhido não é quem chamou, ela fica reservada até o escolhido buscar.
local assigned = redis.call("HGET", stateKey, "assigned")
if assigned then
  if assigned == ticket then
    redis.call("HDEL", stateKey, "assigned", "assignedAt", "assignedLane")
    return grant()
  end
  local assignedAt = tonumber(redis.call("HGET", stateKey, "assignedAt"))
  if assignedAt and now - assignedAt < claimTimeoutMs then return pollMs end
  -- Escolhido não buscou a tempo (morto ou travado): perde a reserva e a vaga é escolhida de novo abaixo.
  dropTicket(assigned, redis.call("HGET", stateKey, "assignedLane") or nil)
  redis.call("HDEL", stateKey, "assigned", "assignedAt", "assignedLane")
end

-- ─── 3. A vaga já abriu? ──────────────────────────────────────────────────────
local last = tonumber(redis.call("GET", lastKey))
if last and now < last + interval then
  return last + interval - now
end

-- ─── 4. Escolha do ticket que leva a vaga ─────────────────────────────────────
local winner, winnerLane

-- 4a. Faixas strict primeiro, sem consumir o revezamento das demais.
for _, name in ipairs(strictLanes) do
  if redis.call("SISMEMBER", lanesKey, name) == 1 then
    winner = headOf(name)
    if winner then
      winnerLane = name
      break
    end
  end
end

-- 4b. Revezamento ponderado: cursor = faixa da vez, credit = vagas que ela ainda pode pegar nesta vez.
if not winner then
  local cursor = redis.call("HGET", stateKey, "cursor") or nil
  local credit = tonumber(redis.call("HGET", stateKey, "credit")) or 0

  -- Faixa da vez ainda tem crédito e ticket esperando: continua com ela.
  if cursor and credit > 0 and redis.call("SISMEMBER", lanesKey, cursor) == 1 then
    winner = headOf(cursor)
    if winner then
      winnerLane = cursor
      credit = credit - 1
    end
  end

  -- Senão, passa a vez pra próxima faixa (ordem alfabética, depois do cursor, dando a volta) que tenha ticket vivo.
  if not winner then
    local lanes = redis.call("SMEMBERS", lanesKey)
    table.sort(lanes)
    local start = 1
    if cursor then
      for i, name in ipairs(lanes) do
        if name > cursor then
          start = i
          break
        end
      end
    end
    for offset = 0, #lanes - 1 do
      local name = lanes[((start - 1 + offset) % #lanes) + 1]
      if not isStrict(name) then
        winner = headOf(name)
        if winner then
          winnerLane = name
          credit = weightOf(name) - 1 -- esta vaga já conta como a 1ª da vez
          break
        end
      end
    end
  end

  if winner then
    redis.call("HSET", stateKey, "cursor", winnerLane, "credit", credit)
  end
end

-- ─── 5. Concede ou reserva ────────────────────────────────────────────────────
-- `not winner` não deveria acontecer (o próprio chamador está vivo); concede pra não travar.
if not winner or winner == ticket then
  return grant()
end

redis.call("HSET", stateKey, "assigned", winner, "assignedAt", now, "assignedLane", winnerLane)
return pollMs
