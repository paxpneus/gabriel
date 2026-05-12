/**
 * Arquivo de Associações do Sequelize
 * 
 * Configure este arquivo em seu config/sequelize.ts ou database.ts
 * e chame setupAssociations() após a inicialização do Sequelize
 */

import UnitBusiness from '../modules/warehouse/unit-business/unit-business.model';
import User from '../modules/warehouse/users/users/user.model';
import UserConfig from '../modules/warehouse/users/user_config/user_config.model';
import UserUnitBusiness from '../modules/warehouse/users/user_unit_business/user_unit_business.model';
import Role from '../modules/warehouse/users/roles/role.model';
import Transporter from '../modules/warehouse/transporter/transporter.model';
import ExpeditionBatch from '../modules/warehouse/expedition/batch/batch.model';
import ExpeditionBatchItems from '../modules/warehouse/expedition/batch-items/batch-items.model';
import ExpeditionBatchInvoice from '../modules/warehouse/expedition/batch-invoices/batch-invoices.model';
import ExpeditionScanLog from '../modules/warehouse/expedition/scan-logs/scan-logs.model';
import Invoice from '../modules/warehouse/entrance/invoice/invoice.model';
import InvoiceItems from '../modules/warehouse/entrance/invoice-items/invoice-items.model';
import EntranceScanLog from '../modules/warehouse/entrance/entrance-scan-logs/entrance-scan-logs.model';
import Product from '../modules/inventory/products/product.model';
import Stock from '../modules/inventory/stock/stock.model';
import SupplierMapping from '../modules/inventory/supplier-mapping/supplier-mapping.model';
import IntegrationMapping from '../modules/integrations/integration-mapping/integration-mapping.model';
import Integration from '../modules/integrations/integrations/integrations.model';
import ConfigToken from '../modules/integrations/config_tokens/config_tokens.model';
import Order from '../modules/sales/orders/order/orders.model';
import Customer from '../modules/sales/customers/customers.model';
import OrderHistory from '../modules/sales/orders/order_history/order_history.model';
import Store from '../modules/sales/stores/stores.model';
import OrderItems from '../modules/sales/orders/order_items/order_items.model';
import Step from '../modules/sales/steps/steps.model';
import InventoryBatch from '../modules/inventory/stock-inventory/inventory-batch/inventory-batch.model';
import InventoryBatchItems from '../modules/inventory/stock-inventory/inventory-batch-items/inventory-batch-items.model';
import InventoryBatchLogs from '../modules/inventory/stock-inventory/inventory-batch-logs/inventory-batch-logs.model';
import UnmappedInvoiceProduct from '../modules/inventory/unmapped-invoice-product/unmapped-invoice-product.model';
export function setupAssociations() {

  // 2. INTEGRATIONS 1:N ORDERS (PEDIDOS) ORDER SIDE

Order.belongsTo(Integration, { foreignKey: 'integrations_id', as: 'integration' });

// 3. CUSTOMER (CLIENTE) 1:N ORDERS (PEDIDOS)
Customer.hasMany(Order, { foreignKey: 'customer_id', as: 'orders' });
Order.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

// 4. ORDER (PEDIDO) 1:N ORDER_HISTORY (HISTORICO)
Order.hasMany(OrderHistory, { foreignKey: 'order_id', as: 'history' });
OrderHistory.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

// 5. STEP N:N ORDER (Via OrderHistory como tabela pivot)
// Isso permite saber todos os passos que um pedido já passou
Order.belongsToMany(Step, { 
    through: OrderHistory, 
    foreignKey: 'order_id', 
    otherKey: 'step_id',
    as: 'steps' 
});

Step.belongsToMany(Order, { 
    through: OrderHistory, 
    foreignKey: 'step_id', 
    otherKey: 'order_id',
    as: 'orders' 
});

// Relacionamento direto do Histórico com o Step (N:1)
OrderHistory.belongsTo(Step, { foreignKey: 'step_id', as: 'step' });
Step.hasMany(OrderHistory, { foreignKey: 'step_id', as: 'histories' });

// OrderItems N:1 Orders (Itens do pedido e pedido)
OrderItems.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
Order.hasMany(OrderItems, { foreignKey: 'order_id', as: 'items' })

// Store 1:N Orders (loja e pedido)
Order.belongsTo(Store, { foreignKey: 'store_id', as: 'store' });
Store.hasMany(Order, { foreignKey: 'store_id', as: 'orders' })

  
// 1. INTEGRATIONS 1:1 CONFIG_TOKENS
Integration.hasOne(ConfigToken, { foreignKey: 'integrations_id', as: 'tokens' });
ConfigToken.belongsTo(Integration, { foreignKey: 'integrations_id', as: 'integration' });

// 2. INTEGRATIONS 1:N ORDERS (PEDIDOS) INTEGRATION SIDE
Integration.hasMany(Order, { foreignKey: 'integrations_id', as: 'orders' });


  // ===== WAREHOUSE - UNIT BUSINESS =====
  
  // Unit Business -> Users
  UnitBusiness.hasMany(User, {
    foreignKey: 'unit_business_id',
    as: 'users',
  });
  User.belongsTo(UnitBusiness, {
    foreignKey: 'unit_business_id',
    as: 'unitBusiness',
  });

  User.hasOne(UserConfig, {
    foreignKey: 'user_id',
    as: 'config',
  });
  UserConfig.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user',
  });

  User.hasMany(UserUnitBusiness, {
    foreignKey: 'user_id',
    as: 'userUnitBusinesses',
  });
  UserUnitBusiness.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user',
  });
  UnitBusiness.hasMany(UserUnitBusiness, {
    foreignKey: 'unit_business_id',
    as: 'userUnitBusinesses',
  });
  UserUnitBusiness.belongsTo(UnitBusiness, {
    foreignKey: 'unit_business_id',
    as: 'unitBusiness',
  });
  User.belongsToMany(UnitBusiness, {
    through: UserUnitBusiness,
    foreignKey: 'user_id',
    otherKey: 'unit_business_id',
    as: 'availableUnitBusinesses',
  });
  UnitBusiness.belongsToMany(User, {
    through: UserUnitBusiness,
    foreignKey: 'unit_business_id',
    otherKey: 'user_id',
    as: 'availableUsers',
  });

  // Unit Business -> Expedition Batches
  UnitBusiness.hasMany(ExpeditionBatch, {
    foreignKey: 'unit_business_id',
    as: 'expeditionBatches',
  });
  ExpeditionBatch.belongsTo(UnitBusiness, {
    foreignKey: 'unit_business_id',
    as: 'unitBusiness',
  });

  // Unit Business -> Invoices
  UnitBusiness.hasMany(Invoice, {
    foreignKey: 'unit_business_id',
    as: 'invoices',
  });
  Invoice.belongsTo(UnitBusiness, {
    foreignKey: 'unit_business_id',
    as: 'unitBusiness',
  });

  // Unit Business -> Integration Mappings
  UnitBusiness.hasMany(IntegrationMapping, {
    foreignKey: 'unit_business_id',
    as: 'integrationMappings',
  });
  IntegrationMapping.belongsTo(UnitBusiness, {
    foreignKey: 'unit_business_id',
    as: 'unitBusiness',
  });

  // Unit Business -> Integrations
  UnitBusiness.belongsTo(Integration, {
    foreignKey: 'integrations_id',
    as: 'integration',
  });
  Integration.hasMany(UnitBusiness, {
    foreignKey: 'integrations_id',
    as: 'unitBusiness',
  });

  // ===== TRANSPORTER =====

  // Transporter -> Invoices
  Transporter.hasMany(Invoice, {
    foreignKey: 'transporter_id',
    as: 'invoices',
  });
  Invoice.belongsTo(Transporter, {
    foreignKey: 'transporter_id',
    as: 'transporter',
  });

  // ===== ROLES & USERS =====
  
  Role.hasMany(User, {
    foreignKey: 'role_id',
    as: 'users',
  });
  User.belongsTo(Role, {
    foreignKey: 'role_id',
    as: 'role',
  });

  // ===== PRODUCTS =====
  
  // Product -> Supplier Mappings
  Product.hasMany(SupplierMapping, {
    foreignKey: 'product_id',
    as: 'supplierMappings',
  });
  SupplierMapping.belongsTo(Product, {
    foreignKey: 'product_id',
    as: 'product',
  });

  // Product -> Stock
  Product.hasMany(Stock, {
    foreignKey: 'product_id',
    as: 'stocks',
  });
  Stock.belongsTo(Product, {
    foreignKey: 'product_id',
    as: 'product',
  });

  // Product -> Expedition Batch Items
  Product.hasMany(ExpeditionBatchItems, {
    foreignKey: 'product_id',
    as: 'expeditionBatchItems',
  });
  ExpeditionBatchItems.belongsTo(Product, {
    foreignKey: 'product_id',
    as: 'product',
  });

  // Product -> Invoice Items
  Product.hasMany(InvoiceItems, {
    foreignKey: 'product_id',
    as: 'invoiceItems',
  });
  InvoiceItems.belongsTo(Product, {
    foreignKey: 'product_id',
    as: 'product',
  });

  // ===== EXPEDITION BATCH =====
  
  // Expedition Batch -> Batch Items
  ExpeditionBatch.hasMany(ExpeditionBatchItems, {
    foreignKey: 'expedition_batch_id',
    as: 'items',
  });
  ExpeditionBatchItems.belongsTo(ExpeditionBatch, {
    foreignKey: 'expedition_batch_id',
    as: 'batch',
  });

  // Expedition Batch -> Batch Invoices
  ExpeditionBatch.hasMany(ExpeditionBatchInvoice, {
    foreignKey: 'expedition_batch_id',
    as: 'batchInvoices',
  });
  ExpeditionBatchInvoice.belongsTo(ExpeditionBatch, {
    foreignKey: 'expedition_batch_id',
    as: 'batch',
  });

  // Expedition Batch -> Integration
  ExpeditionBatch.belongsTo(Integration, {
    foreignKey: 'integrations_id',
    as: 'integration',
  });
  Integration.hasMany(ExpeditionBatch, {
    foreignKey: 'integrations_id',
    as: 'expeditionBatches',
  });

  // Expedition Batch -> Transporter

  ExpeditionBatch.belongsTo(Transporter, {
    foreignKey: 'transporters_id',
    as: 'transporter'
  })

  Transporter.hasMany(ExpeditionBatch, {
    foreignKey: 'transporters_id',
    as: 'expeditionBatches'
  })

  // ===== EXPEDITION BATCH ITEMS =====
  
  // Batch Items -> Scan Logs
  ExpeditionBatchItems.hasMany(ExpeditionScanLog, {
    foreignKey: 'expedition_batch_items_id',
    as: 'scanLogs',
  });
  ExpeditionScanLog.belongsTo(ExpeditionBatchItems, {
    foreignKey: 'expedition_batch_items_id',
    as: 'batchItem',
  });

  // Batch Invoices -> Scan Logs
  ExpeditionBatchInvoice.hasMany(ExpeditionScanLog, {
    foreignKey: 'expedition_batch_invoices_id',
    as: 'scanLogs',
  });
  ExpeditionScanLog.belongsTo(ExpeditionBatchInvoice, {
    foreignKey: 'expedition_batch_invoices_id',
    as: 'batchInvoice',
  });

  // ===== EXPEDITION SCAN LOGS =====
  
  // Scan Logs -> Users
  User.hasMany(ExpeditionScanLog, {
    foreignKey: 'user_id',
    as: 'expeditionScans',
  });
  ExpeditionScanLog.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user',
  });

  // ===== INVOICES =====
  
  // Invoice -> Batch Invoices
  Invoice.hasOne(ExpeditionBatchInvoice, {
  foreignKey: 'invoice_id',
  as: 'batchInvoice',
});

ExpeditionBatchInvoice.belongsTo(Invoice, {
  foreignKey: 'invoice_id',
  as: 'invoice',
});

  // Invoice -> Integration
  Invoice.belongsTo(Integration, {
    foreignKey: 'integrations_id',
    as: 'integration',
  });
  Integration.hasMany(Invoice, {
    foreignKey: 'integrations_id',
    as: 'invoices',
  });

  // Invoice -> Invoice Items
  Invoice.hasMany(InvoiceItems, {
    foreignKey: 'invoice_id',
    as: 'items',
  });
  InvoiceItems.belongsTo(Invoice, {
    foreignKey: 'invoice_id',
    as: 'invoice',
  });

  // Invoice -> Store
Invoice.belongsTo(Store, { foreignKey: 'store_id', as: 'store' });
Store.hasMany(Invoice, { foreignKey: 'store_id', as: 'invoices' });

  // ===== INVOICE ITEMS =====
  
  // Invoice Items -> Entrance Scan Logs
  InvoiceItems.hasMany(EntranceScanLog, {
    foreignKey: 'invoice_items_id',
    as: 'scanLogs',
  });
  EntranceScanLog.belongsTo(InvoiceItems, {
    foreignKey: 'invoice_items_id',
    as: 'invoiceItem',
  });

  // ===== ENTRANCE SCAN LOGS =====
  
  // Entrance Scan Logs -> Users
  User.hasMany(EntranceScanLog, {
    foreignKey: 'user_id',
    as: 'entranceScans',
  });
  EntranceScanLog.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user',
  });

  // ===== INTEGRATIONS =====

  // Integration Mapping -> Integration
  IntegrationMapping.belongsTo(Integration, {
    foreignKey: 'integrations_id',
    as: 'integration',
  });
  Integration.hasMany(IntegrationMapping, {
    foreignKey: 'integrations_id',
    as: 'mappings',
  });
}

// ===== STOCKS =====

// Stock -> UnitBusiness
Stock.belongsTo(UnitBusiness, { foreignKey: 'unit_business_id', as: 'unitBusiness' });
UnitBusiness.hasMany(Stock, { foreignKey: 'unit_business_id', as: 'stocks' });


// ===== STOCK INVENTORY =====

  // UnitBusiness -> InventoryBatch
  UnitBusiness.hasMany(InventoryBatch, { foreignKey: 'unit_business_id', as: 'inventoryBatches' });
  InventoryBatch.belongsTo(UnitBusiness, { foreignKey: 'unit_business_id', as: 'unitBusiness' });

  // InventoryBatch -> InventoryBatchItems
  InventoryBatch.hasMany(InventoryBatchItems, { foreignKey: 'inventory_batch_id', as: 'items' });
  InventoryBatchItems.belongsTo(InventoryBatch, { foreignKey: 'inventory_batch_id', as: 'batch' });

  // InventoryBatchItems -> InventoryBatchLogs
  InventoryBatchItems.hasMany(InventoryBatchLogs, { foreignKey: 'inventory_batch_item_id', as: 'logs' });
  InventoryBatchLogs.belongsTo(InventoryBatchItems, { foreignKey: 'inventory_batch_item_id', as: 'item' });

// ===== INVENTORY BATCH SELF RELATION (DIVERGENCY) =====

// Um batch ORIGINAL tem vários batches de divergência
InventoryBatch.hasMany(InventoryBatch, {
  foreignKey: 'batch_id_for_divergency',
  as: 'divergencies',
});

// Um batch de divergência pertence a um batch ORIGINAL
InventoryBatch.belongsTo(InventoryBatch, {
  foreignKey: 'batch_id_for_divergency',
  as: 'originalBatch',
});

  // Relacionamentos com Entidades Externas:
  
  // Items -> Product
  Product.hasMany(InventoryBatchItems, { foreignKey: 'product_id', as: 'inventoryItems' });
  InventoryBatchItems.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

  // Items -> Stock
  Stock.hasMany(InventoryBatchItems, { foreignKey: 'stock_id', as: 'inventoryItems' });
  InventoryBatchItems.belongsTo(Stock, { foreignKey: 'stock_id', as: 'stock' });

  // Logs -> User (Quem realizou a leitura)
  User.hasMany(InventoryBatchLogs, { foreignKey: 'user_id', as: 'inventoryLogs' });
  InventoryBatchLogs.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  // ─── Adicionar dentro de setupAssociations(), junto ao bloco ===== INVOICES ===
// Invoice -> Unmapped Invoice Products
Invoice.hasMany(UnmappedInvoiceProduct, {
  foreignKey: 'invoice_id',
  as: 'unmappedProducts',
});
UnmappedInvoiceProduct.belongsTo(Invoice, {
  foreignKey: 'invoice_id',
  as: 'invoice',
});
