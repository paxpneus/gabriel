'use strict';

// Gerentes regionais (vendedores do Bling achados por código + nome): [código Bling, nome, grupo de lojas].
const BLING_REGIONAL_MANAGERS = [
  ['15596862610', 'Jhonny Henrique Lupo dos Santos', 'Paraná'],
  ['15596862675', 'Luiz Fernando Uehara', 'Regional 1'],
];

// Regional que não vende no Bling: contato novo, sem integração, com código interno fixo.
const INTERNAL_REGIONAL_MANAGER = ['MANAGER-MARCOS-ORLANDO', 'Marcos Orlando', 'Regional 2'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const toValues = (rows) =>
      rows.map((row) => `(${row.map((v) => sequelize.escape(v)).join(', ')})`).join(', ');
    const [internalCode, internalName, internalGroup] = INTERNAL_REGIONAL_MANAGER.map((v) => sequelize.escape(v));

    // Tudo num bloco só: contato ou grupo não achado (STRICT) desfaz tudo. Loja do contato (Bling) fica como está.
    await sequelize.query(`
      DO $$
      DECLARE
        bling_id uuid;
        m record;
        contact_id uuid;
        group_id uuid;
      BEGIN
        SELECT id INTO STRICT bling_id FROM integrations WHERE name = 'Bling';

        FOR m IN SELECT * FROM (VALUES ${toValues(BLING_REGIONAL_MANAGERS)}) v(bling_code, name, group_name) LOOP
          SELECT id INTO STRICT group_id FROM unit_business_groups WHERE name = m.group_name;
          SELECT id INTO STRICT contact_id FROM contacts
          WHERE integrations_id = bling_id AND id_system = m.bling_code AND name = m.name;

          UPDATE contacts SET type = 'SELLER_MANAGER', unit_business_group_id = group_id, updated_at = now()
          WHERE id = contact_id;
        END LOOP;

        -- Contato interno: reaproveita se já existir (rodar de novo não duplica).
        SELECT id INTO STRICT group_id FROM unit_business_groups WHERE name = ${internalGroup};
        UPDATE contacts SET type = 'SELLER_MANAGER', name = ${internalName}, unit_business_group_id = group_id, updated_at = now()
        WHERE id_system = ${internalCode} AND integrations_id IS NULL;
        IF NOT FOUND THEN
          INSERT INTO contacts (id, name, type, id_system, unit_business_group_id, created_at, updated_at)
          VALUES (gen_random_uuid(), ${internalName}, 'SELLER_MANAGER', ${internalCode}, group_id, now(), now());
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    // Regionais do Bling voltam a vendedor sem grupo; o contato interno é apagado.
    const { sequelize } = queryInterface;
    await sequelize.query(
      `UPDATE contacts SET type = 'SELLER', unit_business_group_id = NULL, updated_at = now()
       WHERE id_system IN (:codes)`,
      { replacements: { codes: BLING_REGIONAL_MANAGERS.map(([code]) => code) } },
    );
    await sequelize.query(`DELETE FROM contacts WHERE id_system = :code AND integrations_id IS NULL`, {
      replacements: { code: INTERNAL_REGIONAL_MANAGER[0] },
    });
  },
};
