'use strict';

// stores acumulou linhas duplicadas com o mesmo `name` (ex.: ~20 linhas
// "LojaFisica") por uma race condition em BlingOrderService.resolveStore
// (antigo createOrderFromBling/updateOrderFromBling, código duplicado nos
// dois): sob processamento concorrente de webhooks de pedidos de canais
// diferentes mas do mesmo tipo Bling (`tipo`, ex. "LojaFisica"), múltiplas
// chamadas passavam pelo check `findOne({where:{name: tipo}})` ao mesmo
// tempo, antes de qualquer uma commitar, e cada uma criava sua própria
// linha — sem nenhuma constraint no banco pra pegar a colisão.
//
// `stores.name` (o `tipo` do canal Bling) é a identidade real que o resto
// do código já usa diretamente — nfe-reconciler's
// `where: { name: "MercadoLivre" }`, `ALLOWED_STORE_NAME`, o fallback
// `where: { name: "Outros" }`, `integration.allowed_channels` — não
// `id_store_system`, que é só um atalho de lookup pro id do canal Bling que
// resolveu esse bucket primeiro. Corrigido no código: resolveStore agora
// usa storeService.findOrCreateByName, que só fica race-safe de verdade com
// o índice único criado aqui.
//
// Esta migração, numa transação:
// 1. Escolhe a linha mais antiga (created_at, depois id) de cada grupo de
//    `name` duplicado como "kept".
// 2. Reaponta orders.store_id / invoices.store_id /
//    sales_order_snapshots.store_id / sales_order_item_snapshots.store_id
//    das duplicatas pra linha mantida (nenhuma dessas tem constraint única
//    envolvendo store_id, então é um UPDATE direto e seguro).
// 3. daily_sales_store_facts TEM UNIQUE(fact_date, unit_business_id,
//    store_id) — reapontar direto podia colidir com uma linha que já existe
//    pro store_id mantido no mesmo dia. Em vez de tentar mesclar métricas
//    (tem coluna de percentual, ex. markup_pct/contribution_pct, que não dá
//    pra somar), as linhas presas a store_id duplicado são apagadas — é uma
//    tabela de fatos derivada (upsertDailySalesStoreFacts), populada a
//    partir de orders/sales_order_snapshots, que este passo já corrigiu.
//    IMPORTANTE: isso não recalcula sozinho o HISTÓRICO já registrado sob o
//    store_id errado — se os relatórios de dias passados precisarem ficar
//    exatos, rode o recomputo dos snapshots/fatos depois desta migração.
// 4. Apaga as linhas duplicadas de stores.
// 5. Cria o índice único em stores(name) (ignorando NULL) que torna
//    findOrCreateByName race-safe daqui pra frente.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        CREATE TEMP TABLE store_dupe_map ON COMMIT DROP AS
        WITH ranked AS (
          SELECT id, name,
                 ROW_NUMBER() OVER (
                   PARTITION BY name ORDER BY created_at ASC, id ASC
                 ) AS rn
          FROM stores
          WHERE name IS NOT NULL
        ),
        keepers AS (
          SELECT name, id AS keep_id FROM ranked WHERE rn = 1
        )
        SELECT r.id AS dupe_id, k.keep_id
        FROM ranked r
        JOIN keepers k ON k.name = r.name
        WHERE r.rn > 1;

        UPDATE orders o
        SET store_id = m.keep_id
        FROM store_dupe_map m
        WHERE o.store_id = m.dupe_id;

        UPDATE invoices i
        SET store_id = m.keep_id
        FROM store_dupe_map m
        WHERE i.store_id = m.dupe_id;

        UPDATE sales_order_snapshots s
        SET store_id = m.keep_id
        FROM store_dupe_map m
        WHERE s.store_id = m.dupe_id;

        UPDATE sales_order_item_snapshots s
        SET store_id = m.keep_id
        FROM store_dupe_map m
        WHERE s.store_id = m.dupe_id;

        DELETE FROM daily_sales_store_facts f
        USING store_dupe_map m
        WHERE f.store_id = m.dupe_id;

        DELETE FROM stores s
        USING store_dupe_map m
        WHERE s.id = m.dupe_id;

        CREATE UNIQUE INDEX stores_name_unique_idx ON stores (name) WHERE name IS NOT NULL;
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS stores_name_unique_idx;`,
        { transaction },
      );
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
