# Ticket (`tickets`)

Módulo: `src/modules/company/tickets/tickets/ticket/`.

## Usuários do ticket
- `requester_user_id` (NOT NULL): solicitante, **obrigatório no body** do create (controller devolve 400 se faltar). Nunca vem do usuário logado: quem cadastra pode abrir em nome de outro.
- `opened_by` (nullable, FK users, SET NULL): usuário logado no create (controller sobrescreve qualquer valor do body). Também é o `changed_by_user_id` da primeira linha de `ticket_status_histories`.
- `closed_by` (nullable, FK users, SET NULL): gravado em `changeStatus` (inclui `markAsCompleted`/`markAsCanceled`) junto com `completed_at` — status `completed`/`canceled` → usuário logado; voltar pra status aberto → `null`.
- Associações: `requester`, `openedBy`, `closedBy` (as duas últimas incluídas só com `id`, `name`).

## Backfill (m336)
Tickets antigos: `opened_by = requester_user_id` (o histórico antigo gravava o solicitante como autor da abertura); `closed_by` = `changed_by_user_id` da última mudança pra status concluído/cancelado, só onde `completed_at` não é nulo.
