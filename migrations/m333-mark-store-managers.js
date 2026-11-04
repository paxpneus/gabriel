'use strict';

// Gerente de cada loja (lista do financeiro), achado pelo código Bling + nome: [nº da loja, código Bling, nome].
const MANAGERS = [
  ['01', '15596862025', 'Liliane Naila Cardoso da Silva'],
  ['02', '15596862027', 'Sandra Cristina Horacio Venancio'],
  ['03', '15596862043', 'Paula Caroline Bittercourt'],
  ['04', '15596862046', 'Tarciso Morguetto Junior'],
  ['05', '15596862053', 'Rodrigo Fernandes Junior'],
  ['07', '15596862063', 'Diego De Souza Martins'],
  ['08', '15596862602', 'Andrea Cristina Oliveira Chagas'],
  ['09', '15596862605', 'Andressa Helena Santos'],
  ['10', '15596862604', 'Thalita Aparecida Oliveira Leite de Oliveira'],
  ['11', '15596875354', 'Telpo Henrique Penteado Montagnani'],
  ['13', '15596862621', 'Amandha Deyse Cantieri'],
  ['14', '15596869765', 'Marilene Aparecida da Silva'],
  ['15', '15596861519', 'Gabriel Françozo Costa'],
  ['16', '15596931650', 'Marcos Allan Venancio Dias'],
  ['19', '15596886757', 'Karoline de Castro Rocha Gonçalves Fernandes'],
  ['22', '15596862061', 'Juliana Aparecida Marquezano'],
  ['23', '15596862649', 'Thiago Rowe'],
  ['24', '15596875355', 'Felipe Gabriel de lima'],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const toValues = (rows) =>
      rows.map((row) => `(${row.map((v) => sequelize.escape(v)).join(', ')})`).join(', ');

    // Tudo num bloco só: contato/loja não achado (STRICT) ou loja que já tem outro gerente desfaz tudo.
    await sequelize.query(`
      DO $$
      DECLARE
        bling_id uuid;
        m record;
        contact_id uuid;
        store_id uuid;
        other_manager text;
      BEGIN
        SELECT id INTO STRICT bling_id FROM integrations WHERE name = 'Bling';

        FOR m IN SELECT * FROM (VALUES ${toValues(MANAGERS)}) v(store_number, bling_code, name) LOOP
          SELECT id INTO STRICT store_id FROM unit_businesses WHERE number = m.store_number;
          SELECT id INTO STRICT contact_id FROM contacts
          WHERE integrations_id = bling_id AND id_system = m.bling_code AND name = m.name;

          -- Um gerente por loja: outro já marcado na loja é conflito pra resolver à mão.
          SELECT name INTO other_manager FROM contacts
          WHERE type = 'SELLER_MANAGER' AND unit_business_id = store_id AND id <> contact_id LIMIT 1;
          IF other_manager IS NOT NULL THEN
            RAISE EXCEPTION 'Loja % já tem gerente: %', m.store_number, other_manager;
          END IF;

          UPDATE contacts SET type = 'SELLER_MANAGER', unit_business_id = store_id, updated_at = now()
          WHERE id = contact_id;
        END LOOP;

      END $$;
    `);
  },

  async down(queryInterface) {
    // Volta os marcados pra vendedor (loja não é restaurada).
    const { sequelize } = queryInterface;
    await sequelize.query(
      `UPDATE contacts SET type = 'SELLER', updated_at = now()
       WHERE type = 'SELLER_MANAGER' AND id_system IN (:codes)`,
      { replacements: { codes: MANAGERS.map(([, code]) => code) } },
    );
  },
};
