# Contact (`contacts`)

Vendedores do Bling (clientes ficam em `customers`, não aqui apesar do enum). Campos: `type`, `id_system` (id do vendedor no Bling), `integrations_id`, `unit_business_id` (loja; Bling grava no upsert do vendedor), `user_id` (usuário do sistema ligado ao vendedor).

- `type` (`enum_contacts_type`): `SELLER`, `SELLER_MANAGER` (m331), `CUSTOMER`.
- `SELLER_MANAGER` = gerente da loja `unit_business_id`; marcado manualmente pelo CRUD (`PUT /api/contacts/:id`). Usado só no `seller-commission-report` (gerente = contato `SELLER_MANAGER` da loja da venda, ganha a comissão de gerente de todas as vendas com vendedor da loja). O `byManager` do seller report ainda usa `users`/`user_config.type = 'manager'`.
- Gerente também é vendedor: toda busca "é vendedor?" usa `SELLER_CONTACT_TYPES` (`contacts.types.ts`), não `'SELLER'` literal — fallback de vendedor do pedido (`bling-order.service`), upsert de vendedor (`bling-direct-upsert.queue`), vendedor da NF-e (`bling-api-fetch.queue`) e escopo de seller do seller report. Com `'SELLER'` literal o gerente não era achado: nota sem vendedor e contato duplicado.
- Sync do Bling atualiza `name`/`integrations_id`/`unit_business_id` do existente, nunca `type` — marcação de gerente não é desfeita. Scripts antigos em `src/scripts/bling/` (merge/populate) ainda filtram `'SELLER'`.
- Rotas: CRUD genérico do BaseController em `/api/contacts` (filtros por campo, ex. `filters[type]=SELLER_MANAGER`); mappings do contato em `GET /api/integration-mapping/contact/:contactId` (só leitura, `findByContactId`).
- Sync do Bling sobrescreve `unit_business_id` com a loja do cadastro de vendedor do Bling (`seller.loja.id`, null se não tiver) — loja do gerente tem que bater com a do Bling, senão volta.
- Mapping `CONTACT` por integração: vendedor do Bling tem mapping Bling (`id_system`) e, quando é o mesmo vendedor na Tecinco, também mapping Tecinco (código do vendedor na Tecinco). Vendedor só da Tecinco: `integrations_id` = Tecinco, `id_system` = código Tecinco + mapping Tecinco (m332, que também juntou os duplicados criados só com código Tecinco no vendedor do Bling).
- Gerentes das lojas marcados pelo m333 (lista do financeiro, contato achado por código Bling + nome). Lojas 06 e 20 sem gerente (desligados).
- Pedido: `orders.seller_id` → contacts. "Vendedor 0" (nome) = marketplace, fora dos relatórios de vendedor.
