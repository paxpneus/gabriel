/**
 * Arquivo de Associações do Sequelize
 * 
 * Configure este arquivo em seu config/sequelize.ts ou database.ts
 * e chame setupAssociations() após a inicialização do Sequelize
 */

import UnitBusiness from '../modules/warehouse/unit-business/unit-business.model';
import User from '../modules/warehouse/users/users/user.model';
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

export function setupAssociations() {
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

  // Unit Business -> Stock
  UnitBusiness.hasMany(Stock, {
    foreignKey: 'unit_business_id',
    as: 'stocks',
  });
  Stock.belongsTo(UnitBusiness, {
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
  Invoice.hasMany(ExpeditionBatchInvoice, {
    foreignKey: 'invoice_id',
    as: 'batchInvoices',
  });
  ExpeditionBatchInvoice.belongsTo(Invoice, {
    foreignKey: 'invoice_id',
    as: 'invoice',
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
}
