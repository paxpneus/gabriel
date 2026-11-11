'use strict';

// Cupom genérico, vínculo afiliado ↔ cupom (com taxa) e cupom usado no pedido (comissão congelada).
// Nada é apagado: vínculo só é inativado, por isso FKs RESTRICT (exceto pedido → CASCADE).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'coupons',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          code: {
            type: Sequelize.STRING(50),
            allowNull: false,
            unique: true,
          },
          discount_type: {
            type: Sequelize.STRING(20),
            allowNull: true,
          },
          discount_value: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          active: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
        },
        { transaction },
      );

      await queryInterface.createTable(
        'contact_coupons',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          contact_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'contacts', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          coupon_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'coupons', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          commission_rate: {
            type: Sequelize.DECIMAL(5, 2),
            allowNull: false,
          },
          active: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          deactivated_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
        },
        { transaction },
      );

      // Um único dono ativo por cupom; histórico inativo fica livre.
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX contact_coupons_active_coupon_unique ON contact_coupons (coupon_id) WHERE active`,
        { transaction },
      );
      await queryInterface.addIndex('contact_coupons', ['contact_id'], { transaction });

      await queryInterface.createTable(
        'order_coupons',
        {
          order_id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'orders', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          coupon_id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'coupons', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          contact_coupon_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'contact_coupons', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          discount_amount: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
          },
          commission_rate: {
            type: Sequelize.DECIMAL(5, 2),
            allowNull: true,
          },
          commission_amount: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('order_coupons', ['contact_coupon_id'], { transaction });
      // No máximo um afiliado por pedido.
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX order_coupons_one_affiliate_per_order ON order_coupons (order_id) WHERE contact_coupon_id IS NOT NULL`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('order_coupons', { transaction });
      await queryInterface.dropTable('contact_coupons', { transaction });
      await queryInterface.dropTable('coupons', { transaction });
    });
  },
};
