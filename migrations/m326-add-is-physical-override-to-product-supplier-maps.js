'use strict';

// is_physical_override: SupplierMapping definido pelo "Físico que manda" — o EAN é exclusivo desse produto
// na integração; o sync deixa de gravar esse EAN em outros produtos. Quem/quando fica em audit_logs.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_supplier_maps', 'is_physical_override', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('product_supplier_maps', 'is_physical_override');
  },
};
