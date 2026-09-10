'use strict';

// BUG CRÍTICO em produção (confirmado por log real): os triggers de
// conflito (m263/m264/m265/m272/m273) usam `BEFORE INSERT OR UPDATE OF
// <colunas>` — no Postgres, isso dispara sempre que a coluna aparece na
// cláusula SET do UPDATE, INDEPENDENTE do valor mudar ou não (não existe
// comparação implícita OLD vs NEW). `ProductConfig.upsert(...)` (Sequelize)
// sempre inclui sku/gtin no SET a cada chamada, mesmo reescrevendo o mesmo
// valor que já estava lá — então, pra qualquer produto que já tinha um
// sku/gtin duplicado de dado legado (ex.: sku=48681 hoje compartilhado por
// 62 produtos diferentes, achado na análise desta sessão), TODO sync
// normal (processProduct, nem passa por criação nenhuma) passou a falhar
// pra sempre no BEFORE UPDATE, mesmo sem escrever nada realmente novo —
// o job só reafirma o mesmo valor que já estava salvo e ainda assim é
// barrado. Sintoma real: "[QUEUE] Job product-X falhou: sku Y já pertence
// a outro produto..." repetindo em loop pra produtos já mapeados há muito
// tempo, sem nenhuma mudança de dado envolvida.
//
// Fix: adiciona a guarda OLD/NEW nos 4 triggers de conflito existentes —
// só valida em INSERT, ou em UPDATE quando a(s) coluna(s) relevante(s)
// realmente mudou(aram) de valor. Não afrouxa a checagem em si (uma
// escrita que introduz uma colisão NOVA continua bloqueada); só para de
// re-barrar escritas que não mudam nada. Aplica o mesmo fix no trigger de
// gtin de ProductConfig (m264/m265) e no de SupplierMapping (m263) porque
// os dois têm exatamente o mesmo defeito estrutural, mesmo não tendo sido
// criados nesta sessão.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        CREATE OR REPLACE FUNCTION prevent_product_config_gtin_conflict()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.gtin IS NOT NULL AND NEW.gtin <> ''
             AND (
               TG_OP = 'INSERT'
               OR NEW.gtin IS DISTINCT FROM OLD.gtin
               OR NEW.unit_business_id IS DISTINCT FROM OLD.unit_business_id
               OR NEW.product_id IS DISTINCT FROM OLD.product_id
             )
          THEN
            IF EXISTS (
              SELECT 1 FROM product_configs pc
              WHERE pc.unit_business_id = NEW.unit_business_id
                AND pc.product_id <> NEW.product_id
                AND pc.gtin = NEW.gtin
            ) THEN
              RAISE EXCEPTION
                'gtin % já pertence a outro produto nessa unit_business (unit_business_id=%)',
                NEW.gtin, NEW.unit_business_id;
            END IF;
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION prevent_supplier_mapping_gtin_conflict()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.supplier_product_code IS NOT NULL AND NEW.supplier_product_code <> '' AND NEW.integrations_id IS NOT NULL
             AND (
               TG_OP = 'INSERT'
               OR NEW.supplier_product_code IS DISTINCT FROM OLD.supplier_product_code
               OR NEW.integrations_id IS DISTINCT FROM OLD.integrations_id
               OR NEW.product_id IS DISTINCT FROM OLD.product_id
             )
          THEN
            IF EXISTS (
              SELECT 1
              FROM product_configs pc
              JOIN unit_businesses ub ON ub.id = pc.unit_business_id
              WHERE ub.integrations_id = NEW.integrations_id
                AND pc.product_id <> NEW.product_id
                AND (pc.gtin = NEW.supplier_product_code OR pc.sku = NEW.supplier_product_code)
            ) THEN
              RAISE EXCEPTION
                'supplier_product_code % já é o gtin/sku de outro produto (product_id=%) na mesma integração (integrations_id=%)',
                NEW.supplier_product_code, NEW.product_id, NEW.integrations_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION prevent_duplicate_supplier_mapping()
        RETURNS TRIGGER AS $$
        DECLARE
          conflicting_id UUID;
        BEGIN
          IF NEW.integrations_id IS NOT NULL AND NEW.supplier_product_code IS NOT NULL AND NEW.supplier_product_code <> ''
             AND (
               TG_OP = 'INSERT'
               OR NEW.supplier_product_code IS DISTINCT FROM OLD.supplier_product_code
               OR NEW.integrations_id IS DISTINCT FROM OLD.integrations_id
             )
          THEN
            SELECT product_id INTO conflicting_id
            FROM product_supplier_maps
            WHERE integrations_id = NEW.integrations_id
              AND supplier_product_code = NEW.supplier_product_code
              AND id <> NEW.id
            LIMIT 1;

            IF conflicting_id IS NOT NULL THEN
              RAISE EXCEPTION
                'Não é possível vincular: o código % já está mapeado (SupplierMapping) pra outro produto (product_id=%) nessa mesma integração (integrations_id=%) — só pode existir uma linha de SupplierMapping por código+integração',
                NEW.supplier_product_code, conflicting_id, NEW.integrations_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION prevent_product_config_sku_conflict()
        RETURNS TRIGGER AS $$
        DECLARE
          target_integrations_id UUID;
          conflicting_id UUID;
        BEGIN
          IF NEW.sku IS NOT NULL AND NEW.sku <> ''
             AND (TG_OP = 'INSERT' OR NEW.sku IS DISTINCT FROM OLD.sku OR NEW.unit_business_id IS DISTINCT FROM OLD.unit_business_id)
          THEN
            SELECT integrations_id INTO target_integrations_id FROM unit_businesses WHERE id = NEW.unit_business_id;

            IF target_integrations_id IS NOT NULL THEN
              SELECT pc.product_id INTO conflicting_id
              FROM product_configs pc
              JOIN unit_businesses ub ON ub.id = pc.unit_business_id
              WHERE ub.integrations_id = target_integrations_id
                AND pc.product_id <> NEW.product_id
                AND pc.sku = NEW.sku
              LIMIT 1;

              IF conflicting_id IS NOT NULL THEN
                RAISE EXCEPTION
                  'sku % já pertence a outro produto (product_id=%) na mesma integração (integrations_id=%)',
                  NEW.sku, conflicting_id, target_integrations_id;
              END IF;

              SELECT psm.product_id INTO conflicting_id
              FROM product_supplier_maps psm
              WHERE psm.integrations_id = target_integrations_id
                AND psm.product_id <> NEW.product_id
                AND psm.supplier_product_code = NEW.sku
              LIMIT 1;

              IF conflicting_id IS NOT NULL THEN
                RAISE EXCEPTION
                  'sku % já é o supplier_product_code de outro produto (product_id=%) na mesma integração (integrations_id=%)',
                  NEW.sku, conflicting_id, target_integrations_id;
              END IF;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // down: não reverte pro comportamento com bug (fire-on-no-op-update é um
  // defeito, não uma feature) — down() vira no-op proposital.
  async down() {},
};
