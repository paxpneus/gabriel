'use strict';

// Vendedor criado só com o código Tecinco (sem integração/mapping) que é o mesmo do Bling: [código Tecinco, nome, código Bling e nome do original].
const MERGES = [
  ['237', 'Beatriz Alberto Neves', '15596861978', 'BEATRIZ ALBERTO NEVES'],
  ['522', 'Felipe Menão dos Santos', '15596934794', 'FELIPE MENAO DOS SANTOS'],
  ['155', 'Juliana Silva', '15596868087', 'Juliana Aparecida da Silva'],
];

// Vendedor só da Tecinco, sem par no Bling: fica, com o código Tecinco virando mapping. [código Tecinco, nome].
const TECINCO_ONLY = [
  ['141', 'Adriana Scaranare'],
  ['497', 'Izadora de Sousa Paonessa Monteiro'],
  ['326', 'Letícia Vicente da Silva'],
  ['523', 'Marquiano Nunes Soares'],
  ['3', 'Rafael Minetto de Lima'],
  ['1234', 'Rogerio de Gregorio'],
  ['207', 'Taís Borges'],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    // Só pra conferência no terminal: quantos pedidos/notas cada duplicado tem antes de mover.
    const counts = await sequelize.query(
      `SELECT c.name, c.id_system,
         (SELECT COUNT(*)::int FROM orders x WHERE x.seller_id = c.id) AS orders,
         (SELECT COUNT(*)::int FROM invoices x WHERE x.seller_id = c.id) AS invoices
       FROM contacts c
       WHERE c.integrations_id IS NULL AND c.id_system IN (:codes)`,
      { type: 'SELECT', replacements: { codes: MERGES.map(([code]) => code) } },
    );
    console.table(counts);

    const toValues = (rows) =>
      rows.map((row) => `(${row.map((v) => sequelize.escape(v)).join(', ')})`).join(', ');

    // Tudo num bloco só: qualquer RAISE (contato não achado/achado 2x, código já mapeado em outro, sobra de registro) desfaz tudo.
    await sequelize.query(`
      DO $$
      DECLARE
        tecinco_id uuid;
        bling_id uuid;
        m record;
        k record;
        dup_id uuid;
        orig_id uuid;
        mapped_to text;
        leftover int;
      BEGIN
        SELECT id INTO STRICT tecinco_id FROM integrations WHERE name = 'Tecinco';
        SELECT id INTO STRICT bling_id FROM integrations WHERE name = 'Bling';

        FOR m IN SELECT * FROM (VALUES ${toValues(MERGES)}) v(tec_code, tec_name, bling_code, bling_name) LOOP
          -- STRICT: erro se não achar ou achar mais de um.
          SELECT id INTO STRICT dup_id FROM contacts
          WHERE integrations_id IS NULL AND id_system = m.tec_code AND name = m.tec_name;
          SELECT id INTO STRICT orig_id FROM contacts
          WHERE integrations_id = bling_id AND id_system = m.bling_code AND name = m.bling_name;

          -- updated_at faz o job incremental do sales/seller report reprocessar esses pedidos com o vendedor original.
          UPDATE orders SET seller_id = orig_id, updated_at = now() WHERE seller_id = dup_id;
          UPDATE invoices SET seller_id = orig_id WHERE seller_id = dup_id;

          -- Código Tecinco do duplicado vira mapping do original (se ainda não for); mapeado em outro contato = conflito real.
          SELECT internal_id INTO mapped_to FROM integration_mappings
          WHERE entity_type = 'CONTACT' AND integrations_id = tecinco_id AND external_id = m.tec_code;
          IF mapped_to IS NOT NULL AND mapped_to <> orig_id::text THEN
            RAISE EXCEPTION 'Código Tecinco % já mapeado em outro contato (%)', m.tec_code, mapped_to;
          END IF;
          IF mapped_to IS NULL THEN
            INSERT INTO integration_mappings (id, entity_type, internal_id, integrations_id, external_id, is_primary, created_at, updated_at)
            VALUES (
              gen_random_uuid(), 'CONTACT', orig_id::text, tecinco_id, m.tec_code,
              NOT EXISTS (
                SELECT 1 FROM integration_mappings
                WHERE entity_type = 'CONTACT' AND internal_id = orig_id::text
                  AND integrations_id = tecinco_id AND is_primary
              ),
              now(), now()
            );
          END IF;

          -- Só apaga o duplicado sem pedido/nota/mapping pendente; relatório sai pela FK (facts CASCADE, snapshots SET NULL) e volta no /run.
          SELECT
            (SELECT COUNT(*) FROM orders WHERE seller_id = dup_id)
            + (SELECT COUNT(*) FROM invoices WHERE seller_id = dup_id)
            + (SELECT COUNT(*) FROM integration_mappings WHERE entity_type = 'CONTACT' AND internal_id = dup_id::text)
          INTO leftover;
          IF leftover > 0 THEN
            RAISE EXCEPTION 'Duplicado % (%) ainda tem % registros', m.tec_name, dup_id, leftover;
          END IF;
          DELETE FROM contacts WHERE id = dup_id;
        END LOOP;

        FOR k IN SELECT * FROM (VALUES ${toValues(TECINCO_ONLY)}) v(tec_code, tec_name) LOOP
          SELECT id INTO STRICT dup_id FROM contacts
          WHERE integrations_id IS NULL AND id_system = k.tec_code AND name = k.tec_name;

          SELECT internal_id INTO mapped_to FROM integration_mappings
          WHERE entity_type = 'CONTACT' AND integrations_id = tecinco_id AND external_id = k.tec_code;
          IF mapped_to IS NOT NULL THEN
            RAISE EXCEPTION 'Código Tecinco % já mapeado em outro contato (%)', k.tec_code, mapped_to;
          END IF;

          INSERT INTO integration_mappings (id, entity_type, internal_id, integrations_id, external_id, is_primary, created_at, updated_at)
          VALUES (gen_random_uuid(), 'CONTACT', dup_id::text, tecinco_id, k.tec_code, true, now(), now());
          -- Mesmo padrão dos vendedores do Bling: id_system + integrations_id apontam pra integração de origem.
          UPDATE contacts SET integrations_id = tecinco_id, updated_at = now() WHERE id = dup_id;
        END LOOP;
      END $$;
    `);
  },

  async down() {
    // Irreversível: duplicados apagados e pedidos/notas repassados pro original.
  },
};
