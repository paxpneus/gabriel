'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('coupons', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
        code: { type: Sequelize.STRING(50), allowNull: false, unique: true },
        // Nullable: cupom criado automaticamente a partir de pedido da Magento nasce sem desconto definido.
        discount_type: { type: Sequelize.STRING(20), allowNull: true },
        discount_value: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
        active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction });

      await queryInterface.createTable('contact_coupons', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
        contact_id: {
          type: Sequelize.UUID, allowNull: false,
          references: { model: 'contacts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        coupon_id: {
          type: Sequelize.UUID, allowNull: false,
          references: { model: 'coupons', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        commission_rate: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
        active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        deactivated_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction });

      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX contact_coupons_one_active_owner_per_coupon
        ON contact_coupons (coupon_id) WHERE active;
        CREATE INDEX contact_coupons_contact_id_idx ON contact_coupons (contact_id);
      `, { transaction });

      await queryInterface.createTable('order_coupons', {
        order_id: {
          type: Sequelize.UUID, allowNull: false, primaryKey: true,
          references: { model: 'orders', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        coupon_id: {
          type: Sequelize.UUID, allowNull: false, primaryKey: true,
          references: { model: 'coupons', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        contact_coupon_id: {
          type: Sequelize.UUID, allowNull: true,
          references: { model: 'contact_coupons', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        discount_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        commission_rate: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
        commission_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction });

      await queryInterface.sequelize.query(`
        CREATE INDEX order_coupons_contact_coupon_id_idx ON order_coupons (contact_coupon_id);
        CREATE UNIQUE INDEX order_coupons_one_affiliate_per_order
        ON order_coupons (order_id) WHERE contact_coupon_id IS NOT NULL;
      `, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_coupons');
    await queryInterface.dropTable('contact_coupons');
    await queryInterface.dropTable('coupons');
  },
};
