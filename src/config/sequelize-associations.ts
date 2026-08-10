/**
 * Arquivo de Associações do Sequelize
 *
 * Configure este arquivo em seu config/sequelize.ts ou database.ts
 * e chame setupAssociations() após a inicialização do Sequelize
 */

import UnitBusiness from "../modules/company/unit-business/unit-business.model";
import User from "../modules/company/users/users/user.model";
import UserConfig from "../modules/company/users/user_config/user_config.model";
import UserUnitBusiness from "../modules/company/users/user_unit_business/user_unit_business.model";
import Role from "../modules/company/users/roles/role.model";
import Transporter from "../modules/warehouse/transporter/transporter.model";
import CarrierLabelRange from "../modules/warehouse/transporter/carrier-label-ranges/carrier-label-ranges.model";
import CarrierImportLayout from "../modules/warehouse/transporter/carrier-import-layouts/carrier-import-layouts.model";
import ExpeditionBatch from "../modules/warehouse/expedition/batch/batch.model";
import ExpeditionBatchItems from "../modules/warehouse/expedition/batch-items/batch-items.model";
import ExpeditionBatchInvoice from "../modules/warehouse/expedition/batch-invoices/batch-invoices.model";
import ExpeditionScanLog from "../modules/warehouse/expedition/scan-logs/scan-logs.model";
import Invoice from "../modules/warehouse/fiscal/invoices/invoice/invoice.model";
import InvoiceItems from "../modules/warehouse/fiscal/invoices/invoice-items/invoice-items.model";
import Product from "../modules/inventory/products/product.model";
import ProductConfig from "../modules/inventory/product-config/product_config.model";
import Stock from "../modules/inventory/stock/stock/stock.model";
import SupplierMapping from "../modules/inventory/supplier-mapping/supplier-mapping.model";
import IntegrationMapping from "../modules/integrations/integration-mapping/integration-mapping.model";
import Integration from "../modules/integrations/integrations/integrations.model";
import ConfigToken from "../modules/integrations/config_tokens/config_tokens.model";
import Order from "../modules/sales/orders/order/orders.model";
import Customer from "../modules/sales/customers/customers.model";
import Contact from "../modules/sales/contacts/contacts.model";
import OrderHistory from "../modules/sales/orders/order_history/order_history.model";
import Store from "../modules/sales/stores/stores.model";
import OrderItems from "../modules/sales/orders/order_items/order_items.model";
import Step from "../modules/sales/steps/steps.model";
import InventoryBatch from "../modules/inventory/stock-inventory/inventory-batch/inventory-batch.model";
import InventoryBatchItems from "../modules/inventory/stock-inventory/inventory-batch-items/inventory-batch-items.model";
import InventoryBatchLogs from "../modules/inventory/stock-inventory/inventory-batch-logs/inventory-batch-logs.model";
import UnmappedInvoiceProduct from "../modules/inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import InvoiceOperationSnapshot from "../modules/reports/daily-operation/invoice-operation-snapshot/invoice-operation-snapshot.model";
import DailyOperationFact from "../modules/reports/daily-operation/daily-operation-fact/daily-operation-fact.model";
import DailyTransporterFact from "../modules/reports/daily-operation/daily-transporter-fact/daily-transporter-fact.model";
import SalesOrderSnapshot from "../modules/reports/daily-sales/sales-order-snapshot/sales-order-snapshot.model";
import SalesOrderItemSnapshot from "../modules/reports/daily-sales/sales-order-item-snapshot/sales-order-item-snapshot.model";
import DailySalesFact from "../modules/reports/daily-sales/daily-sales-fact/daily-sales-fact.model";
import DailySalesStateFact from "../modules/reports/daily-sales/daily-sales-state-fact/daily-sales-state-fact.model";
import DailySalesStoreFact from "../modules/reports/daily-sales/daily-sales-store-fact/daily-sales-store-fact.model";
import DailySalesProductFact from "../modules/reports/daily-sales/daily-sales-product-fact/daily-sales-product-fact.model";
import DailySalesStatusFact from "../modules/reports/daily-sales/daily-sales-status-fact/daily-sales-status-fact.model";
import InvoiceFiscalItem from "../modules/warehouse/fiscal/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import IntegrationOrderStatusMapping from "../modules/sales/orders/integration-order-status-mapping/integration-order-status-mapping.model";
import { Supplier } from "../modules/inventory";
import Operations from "../modules/warehouse/operations/operation/operations.model";
import OperationsItens from "../modules/warehouse/operations/operations-itens/operations-itens.model";
import OperationComment from "../modules/warehouse/operations/operation-comment/operation-comment.model";
import Application from "../modules/integrations/applications/applications.model";
import DailySellerProductFact from "../modules/reports/sellers-report/models/daily-seller-product-fact/daily-seller-product-fact.model";
import DailySellerCustomerFact from "../modules/reports/sellers-report/models/daily-seller-customer-fact/daily-seller-customer-fact.model";
import BatchInvoiceItems from "../modules/warehouse/expedition/batch-invoice-items/batch-invoice-items.model";
import InvoiceUnitBusinessAttributes from "../modules/warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import State from "../modules/warehouse/address/state/state.model";
import Brand from "../modules/inventory/brands/brands.model";
import SellerSalesOrderItemSnapshot from "../modules/reports/sellers-report/models/seller-sales-order-item-snapshot/seller-sales-order-item-snapshot.model";
import Group from "../modules/inventory/groups/group/group.model";
import Subgroup from "../modules/inventory/groups/subgroup/subgroup.model";
import InventorySubgroup from "../modules/inventory/stock-inventory/inventory-subgroups/inventory-subgroups.model";
import Event from "../modules/company/events/event/event.model";
import UserEvent from "../modules/company/events/users-event/users-event.model";
import InvoiceLogisticOccurrences from "../modules/warehouse/fiscal/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.model";
import StockMovementSourceData from "../modules/inventory/stock/stock-movement-source-data/stock-movement-source-data.model";
import Cte from "../modules/warehouse/fiscal/ctes/cte/cte.model";

export function setupAssociations() {
  // Standalone lookup table; no FK associations declared yet.
  void State;
  void StockMovementSourceData;

  // 2. INTEGRATIONS 1:N ORDERS (PEDIDOS) ORDER SIDE

  Order.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration",
  });

  // 3. CUSTOMER (CLIENTE) 1:N ORDERS (PEDIDOS)
  Customer.hasMany(Order, { foreignKey: "customer_id", as: "orders" });
  Order.belongsTo(Customer, { foreignKey: "customer_id", as: "customer" });

  Contact.hasMany(Order, { foreignKey: "seller_id", as: 'orders'});
  Order.belongsTo(Contact, { foreignKey: "seller_id", as: "seller"});

  // Contacts -> Integration / Unit Business
  Contact.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration",
  });
  Integration.hasMany(Contact, {
    foreignKey: "integrations_id",
    as: "contacts",
  });
  Contact.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });
  UnitBusiness.hasMany(Contact, {
    foreignKey: "unit_business_id",
    as: "contacts",
  });
  Contact.belongsTo(User, { foreignKey: "user_id", as: "user" });
  User.hasOne(Contact, { foreignKey: "user_id", as: "contact" });

  // 4. ORDER (PEDIDO) 1:N ORDER_HISTORY (HISTORICO)
  Order.hasMany(OrderHistory, { foreignKey: "order_id", as: "history" });
  OrderHistory.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  // 5. STEP N:N ORDER (Via OrderHistory como tabela pivot)
  // Isso permite saber todos os passos que um pedido já passou
  Order.belongsToMany(Step, {
    through: OrderHistory,
    foreignKey: "order_id",
    otherKey: "step_id",
    as: "steps",
  });

  // Order -> UnitBusiness
  Order.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });
  UnitBusiness.hasMany(Order, { foreignKey: "unit_business_id", as: "orders" });

  // Order -> Invoice (1:1)
  Order.belongsTo(Invoice, { foreignKey: "invoice_id", as: "invoice" });
  Invoice.hasOne(Order, { foreignKey: "invoice_id", as: "order" });

  Step.belongsToMany(Order, {
    through: OrderHistory,
    foreignKey: "step_id",
    otherKey: "order_id",
    as: "orders",
  });

  // Relacionamento direto do Histórico com o Step (N:1)
  OrderHistory.belongsTo(Step, { foreignKey: "step_id", as: "step" });
  Step.hasMany(OrderHistory, { foreignKey: "step_id", as: "histories" });

  // OrderItems N:1 Orders (Itens do pedido e pedido)
  OrderItems.belongsTo(Order, { foreignKey: "order_id", as: "order" });
  Order.hasMany(OrderItems, { foreignKey: "order_id", as: "items" });

  OrderItems.belongsTo(Product, {foreignKey: "product_id", as: "product"});
  Product.hasMany(OrderItems, {foreignKey: "product_id", as: 'orderItems'})

  // Store 1:N Orders (loja e pedido)
  Order.belongsTo(Store, { foreignKey: "store_id", as: "store" });
  Store.hasMany(Order, { foreignKey: "store_id", as: "orders" });

  // 1. INTEGRATIONS 1:1 CONFIG_TOKENS
  Integration.hasOne(ConfigToken, {
    foreignKey: "integrations_id",
    as: "tokens",
  });
  ConfigToken.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration",
  });

  // 2. INTEGRATIONS 1:N ORDERS (PEDIDOS) INTEGRATION SIDE
  Integration.hasMany(Order, { foreignKey: "integrations_id", as: "orders" });

  // ===== WAREHOUSE - UNIT BUSINESS =====

  // Unit Business -> Users
  UnitBusiness.hasMany(User, {
    foreignKey: "unit_business_id",
    as: "users",
  });
  User.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });

  User.hasOne(UserConfig, {
    foreignKey: "user_id",
    as: "config",
  });
  UserConfig.belongsTo(User, {
    foreignKey: "user_id",
    as: "user",
  });

  User.hasMany(UserUnitBusiness, {
    foreignKey: "user_id",
    as: "userUnitBusinesses",
  });
  UserUnitBusiness.belongsTo(User, {
    foreignKey: "user_id",
    as: "user",
  });
  UnitBusiness.hasMany(UserUnitBusiness, {
    foreignKey: "unit_business_id",
    as: "userUnitBusinesses",
  });
  UserUnitBusiness.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });
  User.belongsToMany(UnitBusiness, {
    through: UserUnitBusiness,
    foreignKey: "user_id",
    otherKey: "unit_business_id",
    as: "availableUnitBusinesses",
  });
  UnitBusiness.belongsToMany(User, {
    through: UserUnitBusiness,
    foreignKey: "unit_business_id",
    otherKey: "user_id",
    as: "availableUsers",
  });

  // Unit Business -> Expedition Batches
  UnitBusiness.hasMany(ExpeditionBatch, {
    foreignKey: "unit_business_id",
    as: "expeditionBatches",
  });
  ExpeditionBatch.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });

  // Unit Business -> Integrations
  UnitBusiness.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration",
  });
  Integration.hasMany(UnitBusiness, {
    foreignKey: "integrations_id",
    as: "unitBusiness",
  });

  // ===== TRANSPORTER =====

  Transporter.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration"
  })

  Integration.hasMany(Transporter, {
    foreignKey: "integrations_id",
    as: "transporters"
  })

  // Transporter -> Invoices
  Transporter.hasMany(Invoice, {
    foreignKey: "transporter_id",
    as: "invoices",
  });
  Invoice.belongsTo(Transporter, {
    foreignKey: "transporter_id",
    as: "transporter",
  });

  Transporter.hasMany(CarrierLabelRange, {
    foreignKey: "transporter_id",
    as: "labelRange",
  });
  CarrierLabelRange.belongsTo(Transporter, {
    foreignKey: "transporter_id",
    as: "transporter",
  });

  Transporter.hasOne(CarrierImportLayout, {
    foreignKey: "transporter_id",
    as: "importLayout",
  });
  CarrierImportLayout.belongsTo(Transporter, {
    foreignKey: "transporter_id",
    as: "transporter",
  });

  // ===== ROLES & USERS =====

  Role.hasMany(User, {
    foreignKey: "role_id",
    as: "users",
  });
  User.belongsTo(Role, {
    foreignKey: "role_id",
    as: "role",
  });

  Role.hasMany(Application, {
    foreignKey: "role_id",
    as: "applications",
  });
  Application.belongsTo(Role, {
    foreignKey: "role_id",
    as: "role",
  });

  // ===== PRODUCTS =====

  // Product -> Supplier Mappings
  Product.hasMany(SupplierMapping, {
    foreignKey: "product_id",
    as: "supplierMappings",
  });
  SupplierMapping.belongsTo(Product, {
    foreignKey: "product_id",
    as: "product",
  });

  Supplier.hasMany(Product, { foreignKey: "supplier_id", as: "products" });
  Product.belongsTo(Supplier, { foreignKey: "supplier_id", as: "supplier" });

  Brand.hasMany(Product, { foreignKey: "brand_id", as: "products" });
  Product.belongsTo(Brand, { foreignKey: "brand_id", as: "brandRegister" });

  Group.hasMany(Subgroup, { foreignKey: "group_id", as: "subgroups" });
  Subgroup.belongsTo(Group, { foreignKey: "group_id", as: "group" });

  Subgroup.hasMany(Product, { foreignKey: "subgroup_id", as: "products" });
  Product.belongsTo(Subgroup, { foreignKey: "subgroup_id", as: "subgroup" });

  InventoryBatch.hasMany(InventorySubgroup, {
    foreignKey: "inventory_batch_id",
    as: "inventorySubgroups",
  });
  InventorySubgroup.belongsTo(InventoryBatch, {
    foreignKey: "inventory_batch_id",
    as: "inventoryBatch",
  });
  Subgroup.hasMany(InventorySubgroup, {
    foreignKey: "subgroup_id",
    as: "inventorySubgroups",
  });
  InventorySubgroup.belongsTo(Subgroup, {
    foreignKey: "subgroup_id",
    as: "subgroup",
  });
  InventoryBatch.belongsToMany(Subgroup, {
    through: InventorySubgroup,
    foreignKey: "inventory_batch_id",
    otherKey: "subgroup_id",
    as: "subgroups",
  });
  Subgroup.belongsToMany(InventoryBatch, {
    through: InventorySubgroup,
    foreignKey: "subgroup_id",
    otherKey: "inventory_batch_id",
    as: "inventoryBatches",
  });

  // Product -> Product Config
  Product.hasMany(ProductConfig, {
    foreignKey: "product_id",
    as: "productConfigs",
  });
  ProductConfig.belongsTo(Product, {
    foreignKey: "product_id",
    as: "product",
  });
  UnitBusiness.hasMany(ProductConfig, {
    foreignKey: "unit_business_id",
    as: "productConfigs",
  });
  ProductConfig.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });

  // Product -> Stock
  Product.hasMany(Stock, {
    foreignKey: "product_id",
    as: "stocks",
  });
  Stock.belongsTo(Product, {
    foreignKey: "product_id",
    as: "product",
  });

  // Product -> Expedition Batch Items
  Product.hasMany(ExpeditionBatchItems, {
    foreignKey: "product_id",
    as: "expeditionBatchItems",
  });
  ExpeditionBatchItems.belongsTo(Product, {
    foreignKey: "product_id",
    as: "product",
  });

  // Product -> Invoice Items
  Product.hasMany(InvoiceItems, {
    foreignKey: "product_id",
    as: "invoiceItems",
  });
  InvoiceItems.belongsTo(Product, {
    foreignKey: "product_id",
    as: "product",
  });

  // ===== EXPEDITION BATCH =====

  // Expedition Batch -> Batch Items
  ExpeditionBatch.hasMany(ExpeditionBatchItems, {
    foreignKey: "expedition_batch_id",
    as: "items",
  });
  ExpeditionBatchItems.belongsTo(ExpeditionBatch, {
    foreignKey: "expedition_batch_id",
    as: "batch",
  });

  ExpeditionBatch.belongsTo(User, {
    foreignKey: "operator_id",
    as: "operator",
  });

  User.hasMany(ExpeditionBatch, {
    foreignKey: "operator_id",
    as: "batches",
  });

  // Expedition Batch -> Batch Invoices
  ExpeditionBatch.hasMany(ExpeditionBatchInvoice, {
    foreignKey: "expedition_batch_id",
    as: "batchInvoices",
  });
  ExpeditionBatchInvoice.belongsTo(ExpeditionBatch, {
    foreignKey: "expedition_batch_id",
    as: "batch",
  });

  // Expedition Batch Invoice Item

  // batch_invoice_items -> batch_items (ExpeditionBatchItems)
  ExpeditionBatchItems.hasMany(BatchInvoiceItems, {
    foreignKey: "expedition_batch_item_id",
    as: "batchInvoiceItems",
  });
  BatchInvoiceItems.belongsTo(ExpeditionBatchItems, {
    foreignKey: "expedition_batch_item_id",
    as: "batchItem",
  });

  // batch_invoice_items -> batch_invoices (ExpeditionBatchInvoice)
  ExpeditionBatchInvoice.hasMany(BatchInvoiceItems, {
    foreignKey: "expedition_batch_invoice_id",
    as: "items",
  });
  BatchInvoiceItems.belongsTo(ExpeditionBatchInvoice, {
    foreignKey: "expedition_batch_invoice_id",
    as: "batchInvoice",
  });

  // Expedition Batch -> Integration
  ExpeditionBatch.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration",
  });
  Integration.hasMany(ExpeditionBatch, {
    foreignKey: "integrations_id",
    as: "expeditionBatches",
  });

  // Expedition Batch -> Transporter

  ExpeditionBatch.belongsTo(Transporter, {
    foreignKey: "transporters_id",
    as: "transporter",
  });

  Transporter.hasMany(ExpeditionBatch, {
    foreignKey: "transporters_id",
    as: "expeditionBatches",
  });

  // ===== EXPEDITION BATCH ITEMS =====

  // Batch Items -> Scan Logs
  ExpeditionBatchItems.hasMany(ExpeditionScanLog, {
    foreignKey: "expedition_batch_items_id",
    as: "scanLogs",
  });
  ExpeditionScanLog.belongsTo(ExpeditionBatchItems, {
    foreignKey: "expedition_batch_items_id",
    as: "batchItem",
  });

  // Batch Invoices -> Scan Logs
  ExpeditionBatchInvoice.hasMany(ExpeditionScanLog, {
    foreignKey: "expedition_batch_invoices_id",
    as: "scanLogs",
  });
  ExpeditionScanLog.belongsTo(ExpeditionBatchInvoice, {
    foreignKey: "expedition_batch_invoices_id",
    as: "batchInvoice",
  });

  // ===== EXPEDITION SCAN LOGS =====

  // Scan Logs -> Users
  User.hasMany(ExpeditionScanLog, {
    foreignKey: "user_id",
    as: "expeditionScans",
  });
  ExpeditionScanLog.belongsTo(User, {
    foreignKey: "user_id",
    as: "user",
  });

  // ===== INVOICES =====

  Invoice.hasMany(InvoiceLogisticOccurrences, {
    foreignKey: 'invoice_id',
    as: 'occurrences'
  })

  InvoiceLogisticOccurrences.belongsTo(Invoice, {
    foreignKey: 'invoice_id',
    as: 'invoice'
  })

  // Invoice -> Batch Invoices
  Invoice.hasOne(ExpeditionBatchInvoice, {
    foreignKey: "invoice_id",
    as: "batchInvoice",
  });

  ExpeditionBatchInvoice.belongsTo(Invoice, {
    foreignKey: "invoice_id",
    as: "invoice",
  });

  // Invoice -> Integration
  Invoice.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration",
  });
  Integration.hasMany(Invoice, {
    foreignKey: "integrations_id",
    as: "invoices",
  });

  // Invoice -> Invoice Items
  Invoice.hasMany(InvoiceItems, {
    foreignKey: "invoice_id",
    as: "items",
  });
  InvoiceItems.belongsTo(Invoice, {
    foreignKey: "invoice_id",
    as: "invoice",
  });

  // Invoice -> Store
  Invoice.belongsTo(Store, { foreignKey: "store_id", as: "store" });
  Store.hasMany(Invoice, { foreignKey: "store_id", as: "invoices" });

  // Invoice -> Seller Contact
  Invoice.belongsTo(Contact, { foreignKey: "seller_id", as: "seller" });
  Contact.hasMany(Invoice, { foreignKey: "seller_id", as: "sellerInvoices" });

  // Invoice -> Seller Contact
  Invoice.belongsTo(Supplier, { foreignKey: "supplier_id", as: "supplier" });
  Supplier.hasMany(Invoice, {
    foreignKey: "supplier_id",
    as: "supplierInvoices",
  });

  // ===== INVOICE UNIT BUSINESS ATTRIBUTES =====

  UnitBusiness.hasMany(InvoiceUnitBusinessAttributes, {
    foreignKey: "unit_business_id",
    as: "invoiceUnitBusinessAttributes",
  });
  InvoiceUnitBusinessAttributes.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });

  Invoice.hasMany(InvoiceUnitBusinessAttributes, {
    foreignKey: "invoice_id",
    as: "unitBusinessAttributes",
  });
  InvoiceUnitBusinessAttributes.belongsTo(Invoice, {
    foreignKey: "invoice_id",
    as: "invoice",
  });

  // ===== INTEGRATIONS =====

  // Integration Mapping -> Integration
  IntegrationMapping.belongsTo(Integration, {
    foreignKey: "integrations_id",
    as: "integration",
  });
  Integration.hasMany(IntegrationMapping, {
    foreignKey: "integrations_id",
    as: "mappings",
  });

  // ===== OPERATIONS =====

  Invoice.hasMany(Operations, {
    foreignKey: "invoice_id",
    as: "operations",
  });
  Operations.belongsTo(Invoice, {
    foreignKey: "invoice_id",
    as: "invoice",
  });

  UnitBusiness.hasMany(Operations, {
    foreignKey: "from_unit",
    as: "operationsFrom",
  });
  Operations.belongsTo(UnitBusiness, {
    foreignKey: "from_unit",
    as: "fromUnit",
  });

  UnitBusiness.hasMany(Operations, {
    foreignKey: "to_unit",
    as: "operationsTo",
  });
  Operations.belongsTo(UnitBusiness, {
    foreignKey: "to_unit",
    as: "toUnit",
  });

  User.hasMany(Operations, {
    foreignKey: "request_user",
    as: "requestedOperations",
  });
  Operations.belongsTo(User, {
    foreignKey: "request_user",
    as: "requestUser",
  });

  User.hasMany(Operations, {
    foreignKey: "receiver_user",
    as: "receivedOperations",
  });
  Operations.belongsTo(User, {
    foreignKey: "receiver_user",
    as: "receiverUser",
  });

  Operations.hasMany(OperationsItens, {
    foreignKey: "operation_id",
    as: "items",
  });
  OperationsItens.belongsTo(Operations, {
    foreignKey: "operation_id",
    as: "operation",
  });

  Product.hasMany(OperationsItens, {
    foreignKey: "product_id",
    as: "operationsItens",
  });
  OperationsItens.belongsTo(Product, {
    foreignKey: "product_id",
    as: "product",
  });

  // ===== OPERATION COMMENTS =====

  Operations.hasMany(OperationComment, {
    foreignKey: "operation_id",
    as: "comments",
  });
  OperationComment.belongsTo(Operations, {
    foreignKey: "operation_id",
    as: "operation",
  });

  User.hasMany(OperationComment, {
    foreignKey: "user_id",
    as: "operationComments",
  });
  OperationComment.belongsTo(User, {
    foreignKey: "user_id",
    as: "user",
  });

  UnitBusiness.hasMany(OperationComment, {
    foreignKey: "unit_business_id",
    as: "operationComments",
  });
  OperationComment.belongsTo(UnitBusiness, {
    foreignKey: "unit_business_id",
    as: "unitBusiness",
  });

  OperationComment.hasMany(OperationComment, {
    foreignKey: "point_to",
    as: "replies",
  });
  OperationComment.belongsTo(OperationComment, {
    foreignKey: "point_to",
    as: "parentComment",
  });
}

// ===== STOCKS =====

// Stock -> UnitBusiness
Stock.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});
UnitBusiness.hasMany(Stock, { foreignKey: "unit_business_id", as: "stocks" });

// ===== STOCK INVENTORY =====

// UnitBusiness -> InventoryBatch
UnitBusiness.hasMany(InventoryBatch, {
  foreignKey: "unit_business_id",
  as: "inventoryBatches",
});
InventoryBatch.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

// InventoryBatch -> InventoryBatchItems
InventoryBatch.hasMany(InventoryBatchItems, {
  foreignKey: "inventory_batch_id",
  as: "items",
});
InventoryBatchItems.belongsTo(InventoryBatch, {
  foreignKey: "inventory_batch_id",
  as: "batch",
});

// InventoryBatchItems -> InventoryBatchLogs
InventoryBatchItems.hasMany(InventoryBatchLogs, {
  foreignKey: "inventory_batch_item_id",
  as: "logs",
});
InventoryBatchLogs.belongsTo(InventoryBatchItems, {
  foreignKey: "inventory_batch_item_id",
  as: "item",
});

// ===== INVENTORY BATCH SELF RELATION (DIVERGENCY) =====

// Um batch ORIGINAL tem vários batches de divergência
InventoryBatch.hasMany(InventoryBatch, {
  foreignKey: "batch_id_for_divergency",
  as: "divergencies",
});

// Um batch de divergência pertence a um batch ORIGINAL
InventoryBatch.belongsTo(InventoryBatch, {
  foreignKey: "batch_id_for_divergency",
  as: "originalBatch",
});

// Relacionamentos com Entidades Externas:

// Items -> Product
Product.hasMany(InventoryBatchItems, {
  foreignKey: "product_id",
  as: "inventoryItems",
});
InventoryBatchItems.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

// Items -> Stock
Stock.hasMany(InventoryBatchItems, {
  foreignKey: "stock_id",
  as: "inventoryItems",
});
InventoryBatchItems.belongsTo(Stock, { foreignKey: "stock_id", as: "stock" });

// Logs -> User (Quem realizou a leitura)
User.hasMany(InventoryBatchLogs, {
  foreignKey: "user_id",
  as: "inventoryLogs",
});
InventoryBatchLogs.belongsTo(User, { foreignKey: "user_id", as: "user" });

// ─── Adicionar dentro de setupAssociations(), junto ao bloco ===== INVOICES ===
// Invoice -> Unmapped Invoice Products
Invoice.hasMany(UnmappedInvoiceProduct, {
  foreignKey: "invoice_id",
  as: "unmappedProducts",
});
UnmappedInvoiceProduct.belongsTo(Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
});

// UnmappedInvoiceProduct -> Integration
UnmappedInvoiceProduct.belongsTo(Integration, {
  foreignKey: "integrations_id",
  as: "integration",
});
Integration.hasMany(UnmappedInvoiceProduct, {
  foreignKey: "integrations_id",
  as: "unmappedInvoiceProducts",
});

// ===== ANALYTICS REPORTS =====

Invoice.hasOne(InvoiceOperationSnapshot, {
  foreignKey: "invoice_id",
  as: "operationSnapshot",
});
InvoiceOperationSnapshot.belongsTo(Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
});

UnitBusiness.hasMany(InvoiceOperationSnapshot, {
  foreignKey: "unit_business_id",
  as: "invoiceOperationSnapshots",
});
InvoiceOperationSnapshot.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Transporter.hasMany(InvoiceOperationSnapshot, {
  foreignKey: "transporter_id",
  as: "invoiceOperationSnapshots",
});
InvoiceOperationSnapshot.belongsTo(Transporter, {
  foreignKey: "transporter_id",
  as: "transporter",
});

UnitBusiness.hasMany(DailyOperationFact, {
  foreignKey: "unit_business_id",
  as: "dailyOperationFacts",
});
DailyOperationFact.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

UnitBusiness.hasMany(DailyTransporterFact, {
  foreignKey: "unit_business_id",
  as: "dailyTransporterFacts",
});
DailyTransporterFact.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Transporter.hasMany(DailyTransporterFact, {
  foreignKey: "transporter_id",
  as: "dailyTransporterFacts",
});
DailyTransporterFact.belongsTo(Transporter, {
  foreignKey: "transporter_id",
  as: "transporter",
});

// ===== SALES ANALYTICS REPORTS =====

Order.hasOne(SalesOrderSnapshot, {
  foreignKey: "order_id",
  as: "salesSnapshot",
});
SalesOrderSnapshot.belongsTo(Order, {
  foreignKey: "order_id",
  as: "order",
});

Invoice.hasMany(SalesOrderSnapshot, {
  foreignKey: "invoice_id",
  as: "salesOrderSnapshots",
});
SalesOrderSnapshot.belongsTo(Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
});

Integration.hasMany(SalesOrderSnapshot, {
  foreignKey: "integration_id",
  as: "salesOrderSnapshots",
});
SalesOrderSnapshot.belongsTo(Integration, {
  foreignKey: "integration_id",
  as: "integration",
});

Customer.hasMany(SalesOrderSnapshot, {
  foreignKey: "customer_id",
  as: "salesOrderSnapshots",
});
SalesOrderSnapshot.belongsTo(Customer, {
  foreignKey: "customer_id",
  as: "customer",
});

Store.hasMany(SalesOrderSnapshot, {
  foreignKey: "store_id",
  as: "salesOrderSnapshots",
});
SalesOrderSnapshot.belongsTo(Store, {
  foreignKey: "store_id",
  as: "store",
});

UnitBusiness.hasMany(SalesOrderSnapshot, {
  foreignKey: "unit_business_id",
  as: "salesOrderSnapshots",
});
SalesOrderSnapshot.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Invoice.hasMany(InvoiceFiscalItem, {
  foreignKey: "invoice_id",
  as: "fiscalItems",
});
InvoiceFiscalItem.belongsTo(Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
});

Product.hasMany(InvoiceFiscalItem, {
  foreignKey: "product_id",
  as: "invoiceFiscalItems",
});
InvoiceFiscalItem.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

SalesOrderSnapshot.hasMany(SalesOrderItemSnapshot, {
  foreignKey: "order_snapshot_id",
  as: "items",
});
SalesOrderItemSnapshot.belongsTo(SalesOrderSnapshot, {
  foreignKey: "order_snapshot_id",
  as: "orderSnapshot",
});

OrderItems.hasOne(SalesOrderItemSnapshot, {
  foreignKey: "order_item_id",
  as: "salesSnapshot",
});
SalesOrderItemSnapshot.belongsTo(OrderItems, {
  foreignKey: "order_item_id",
  as: "orderItem",
});

Order.hasMany(SalesOrderItemSnapshot, {
  foreignKey: "order_id",
  as: "salesItemSnapshots",
});
SalesOrderItemSnapshot.belongsTo(Order, {
  foreignKey: "order_id",
  as: "order",
});

Product.hasMany(SalesOrderItemSnapshot, {
  foreignKey: "product_id",
  as: "salesItemSnapshots",
});
SalesOrderItemSnapshot.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

Store.hasMany(SalesOrderItemSnapshot, {
  foreignKey: "store_id",
  as: "salesItemSnapshots",
});
SalesOrderItemSnapshot.belongsTo(Store, {
  foreignKey: "store_id",
  as: "store",
});

UnitBusiness.hasMany(SalesOrderItemSnapshot, {
  foreignKey: "unit_business_id",
  as: "salesItemSnapshots",
});
SalesOrderItemSnapshot.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Integration.hasMany(SalesOrderItemSnapshot, {
  foreignKey: "integration_id",
  as: "salesItemSnapshots",
});
SalesOrderItemSnapshot.belongsTo(Integration, {
  foreignKey: "integration_id",
  as: "integration",
});

UnitBusiness.hasMany(DailySalesFact, {
  foreignKey: "unit_business_id",
  as: "dailySalesFacts",
});
DailySalesFact.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Integration.hasMany(DailySalesFact, {
  foreignKey: "integration_id",
  as: "dailySalesFacts",
});
DailySalesFact.belongsTo(Integration, {
  foreignKey: "integration_id",
  as: "integration",
});

UnitBusiness.hasMany(DailySalesStateFact, {
  foreignKey: "unit_business_id",
  as: "dailySalesStateFacts",
});
DailySalesStateFact.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

UnitBusiness.hasMany(DailySalesStoreFact, {
  foreignKey: "unit_business_id",
  as: "dailySalesStoreFacts",
});
DailySalesStoreFact.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Store.hasMany(DailySalesStoreFact, {
  foreignKey: "store_id",
  as: "dailySalesFacts",
});
DailySalesStoreFact.belongsTo(Store, {
  foreignKey: "store_id",
  as: "store",
});

UnitBusiness.hasMany(DailySalesProductFact, {
  foreignKey: "unit_business_id",
  as: "dailySalesProductFacts",
});
DailySalesProductFact.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Product.hasMany(DailySalesProductFact, {
  foreignKey: "product_id",
  as: "dailySalesFacts",
});
DailySalesProductFact.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

UnitBusiness.hasMany(DailySalesStatusFact, {
  foreignKey: "unit_business_id",
  as: "dailySalesStatusFacts",
});
DailySalesStatusFact.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

Integration.hasMany(DailySalesStatusFact, {
  foreignKey: "integration_id",
  as: "dailySalesStatusFacts",
});
DailySalesStatusFact.belongsTo(Integration, {
  foreignKey: "integration_id",
  as: "integration",
});

Integration.hasMany(IntegrationOrderStatusMapping, {
  foreignKey: "integration_id",
  as: "integrationOrderStatusMappings",
});
IntegrationOrderStatusMapping.belongsTo(Integration, {
  foreignKey: "integration_id",
  as: "integration",
});

// ===== SELLER SALES ANALYTICS =====

Contact.hasMany(DailySellerProductFact, {
  foreignKey: "seller_id",
  as: "dailySellerProductFacts",
});
DailySellerProductFact.belongsTo(Contact, {
  foreignKey: "seller_id",
  as: "seller",
});

Product.hasMany(DailySellerProductFact, {
  foreignKey: "product_id",
  as: "dailySellerProductFacts",
});
DailySellerProductFact.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

Contact.hasMany(DailySellerCustomerFact, {
  foreignKey: "seller_id",
  as: "dailySellerCustomerFacts",
});
DailySellerCustomerFact.belongsTo(Contact, {
  foreignKey: "seller_id",
  as: "seller",
});

Customer.hasMany(DailySellerCustomerFact, {
  foreignKey: "customer_id",
  as: "dailySellerCustomerFacts",
});
DailySellerCustomerFact.belongsTo(Customer, {
  foreignKey: "customer_id",
  as: "customer",
});

// OrderItems <-> SellerSalesOrderItemSnapshot (1:1, por order_item_id)
OrderItems.hasOne(SellerSalesOrderItemSnapshot, {
  foreignKey: "order_item_id",
  as: "sellerSnapshot",
});
SellerSalesOrderItemSnapshot.belongsTo(OrderItems, {
  foreignKey: "order_item_id",
  as: "orderItem",
});

// Order -> SellerSalesOrderItemSnapshot (1:N, usado para agregação por pedido)
Order.hasMany(SellerSalesOrderItemSnapshot, {
  foreignKey: "order_id",
  as: "sellerItemSnapshots",
});
SellerSalesOrderItemSnapshot.belongsTo(Order, {
  foreignKey: "order_id",
  as: "order",
});

// Product -> SellerSalesOrderItemSnapshot
Product.hasMany(SellerSalesOrderItemSnapshot, {
  foreignKey: "product_id",
  as: "sellerItemSnapshots",
});
SellerSalesOrderItemSnapshot.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

// Contact (seller) -> SellerSalesOrderItemSnapshot
Contact.hasMany(SellerSalesOrderItemSnapshot, {
  foreignKey: "seller_id",
  as: "sellerItemSnapshots",
});
SellerSalesOrderItemSnapshot.belongsTo(Contact, {
  foreignKey: "seller_id",
  as: "seller",
});

// Customer -> SellerSalesOrderItemSnapshot
Customer.hasMany(SellerSalesOrderItemSnapshot, {
  foreignKey: "customer_id",
  as: "sellerItemSnapshots",
});
SellerSalesOrderItemSnapshot.belongsTo(Customer, {
  foreignKey: "customer_id",
  as: "customer",
});

// UnitBusiness -> SellerSalesOrderItemSnapshot
UnitBusiness.hasMany(SellerSalesOrderItemSnapshot, {
  foreignKey: "unit_business_id",
  as: "sellerItemSnapshots",
});
SellerSalesOrderItemSnapshot.belongsTo(UnitBusiness, {
  foreignKey: "unit_business_id",
  as: "unitBusiness",
});

  // Event & User Associations
  Event.belongsToMany(User, {
    through: UserEvent,
    foreignKey: "event_id",
    otherKey: "user_id",
    as: "users",
  });
  User.belongsToMany(Event, {
    through: UserEvent,
    foreignKey: "user_id",
    otherKey: "event_id",
    as: "events",
  });
  UserEvent.belongsTo(User, { foreignKey: "user_id", as: "user" });
  UserEvent.belongsTo(Event, { foreignKey: "event_id", as: "event" });
  User.hasMany(UserEvent, { foreignKey: "user_id", as: "userEvents" });
  Event.hasMany(UserEvent, { foreignKey: "event_id", as: "userEvents" });

// CTE(s) 

export function setupCteAssociations() {
  // -------------------------------------------------------------
  // 1. ISSUER (Emitente é SEMPRE a Transportadora)
  // -------------------------------------------------------------
  Cte.belongsTo(Transporter, {
    foreignKey: "issuer_tax_id",
    targetKey: "tax_id", // Assumindo que tax_id é a coluna de CNPJ na model
    as: "issuer_transporter",
  });

  // -------------------------------------------------------------
  // 2. SENDER (Remetente pode ser Loja, Fornecedor ou Cliente)
  // -------------------------------------------------------------
  Cte.belongsTo(UnitBusiness, {
    foreignKey: "sender_tax_id",
    targetKey: "tax_id",
    as: "sender_unit_business",
  });

  Cte.belongsTo(Supplier, {
    foreignKey: "sender_tax_id",
    targetKey: "tax_id",
    as: "sender_supplier",
  });

  Cte.belongsTo(Customer, {
    foreignKey: "sender_tax_id",
    targetKey: "tax_id",
    as: "sender_customer",
  });

  // -------------------------------------------------------------
  // 3. RECIPIENT (Destinatário pode ser Cliente, Loja ou Fornecedor)
  // -------------------------------------------------------------
  Cte.belongsTo(Customer, {
    foreignKey: "recipient_tax_id",
    targetKey: "tax_id",
    as: "recipient_customer",
  });

  Cte.belongsTo(UnitBusiness, {
    foreignKey: "recipient_tax_id",
    targetKey: "tax_id",
    as: "recipient_unit_business",
  });

  Cte.belongsTo(Supplier, {
    foreignKey: "recipient_tax_id",
    targetKey: "tax_id",
    as: "recipient_supplier",
  });

  // -------------------------------------------------------------
  // 4. EXPEDIDOR / RECEBEDOR (Geralmente são outras Transportadoras ou Lojas)
  // -------------------------------------------------------------
  Cte.belongsTo(Transporter, {
    foreignKey: "dispatcher_tax_id",
    targetKey: "tax_id",
    as: "dispatcher_transporter",
  });

  Cte.belongsTo(Transporter, {
    foreignKey: "receiver_tax_id",
    targetKey: "tax_id",
    as: "receiver_transporter",
  });

  // -------------------------------------------------------------
  // 5. TOMADOR (Quem paga o frete)
  // -------------------------------------------------------------
  Cte.belongsTo(UnitBusiness, {
    foreignKey: "taker_tax_id",
    targetKey: "tax_id",
    as: "taker_unit_business",
  });

  Cte.belongsTo(Customer, {
    foreignKey: "taker_tax_id",
    targetKey: "tax_id",
    as: "taker_customer",
  });

  Cte.belongsTo(Supplier, {
    foreignKey: "taker_tax_id",
    targetKey: "tax_id",
    as: "taker_supplier",
  });

  Cte.belongsTo(Transporter, {
    foreignKey: "taker_tax_id",
    targetKey: "tax_id",
    as: "taker_transporter",
  });
}
