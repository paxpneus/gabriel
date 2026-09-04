'use strict';

// integration_mappings.internal_id não é uma foreign key de verdade (é
// varchar simples, porque a tabela é polimórfica — serve tanto pra PRODUCT
// quanto pra CONTACT etc., cada entity_type apontando pra uma tabela
// diferente) — então apagar um Product não limpa sozinho o mapping que
// apontava pra ele. Isso deixa uma linha órfã reservando o external_id
// daquele produto pra sempre: createOrUpdateIntegrationMapping nunca
// reaponta um mapping já existente (só dá warn e ignora), então o próximo
// produto criado pra esse mesmo external_id (ex.: via
// UnmappedInvoiceProductService.createProduct) nasce sem mapping nenhum,
// silenciosamente. Bug real, reproduzido nesta sessão: produto apagado
// manualmente -> mapping ficou órfão -> produto novo criado depois pro
// mesmo external_id não recebeu mapping.
//
// Trigger AFTER DELETE em products: apaga de integration_mappings toda
// linha com entity_type='PRODUCT' e internal_id = id do produto apagado.
// Só mexe em PRODUCT — outros entity_type (ex. CONTACT) não são afetados
// por deleção de Product.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        CREATE OR REPLACE FUNCTION delete_integration_mapping_on_product_delete()
        RETURNS TRIGGER AS $$
        BEGIN
          DELETE FROM integration_mappings
          WHERE entity_type = 'PRODUCT'
            AND internal_id = OLD.id::text;

          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trigger_delete_integration_mapping_on_product_delete
        AFTER DELETE ON products
        FOR EACH ROW
        EXECUTE FUNCTION delete_integration_mapping_on_product_delete();
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
        `
        DROP TRIGGER IF EXISTS trigger_delete_integration_mapping_on_product_delete ON products;
        DROP FUNCTION IF EXISTS delete_integration_mapping_on_product_delete();
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
