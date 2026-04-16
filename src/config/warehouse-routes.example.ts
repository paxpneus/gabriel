/**
 * Exemplo de como integrar as novas rotas no config/routes.ts
 * 
 * Importe este arquivo em sua config/routes.ts ou app.ts
 */

import { Router } from 'express';

// Warehouse Routes
import unitBusinessRoutes from '../modules/warehouse/unit-business/unit-business.routes';
import userRoutes from '../modules/warehouse/users/users/user.routes';
import roleRoutes from '../modules/warehouse/users/roles/role.routes';
import transporterRoutes from '../modules/warehouse/transporter/transporter.routes';
import batchRoutes from '../modules/warehouse/expedition/batch/batch.routes';
import batchItemsRoutes from '../modules/warehouse/expedition/batch-items/batch-items.routes';
import batchInvoicesRoutes from '../modules/warehouse/expedition/batch-invoices/batch-invoices.routes';
import scanLogsRoutes from '../modules/warehouse/expedition/scan-logs/scan-logs.routes';
import invoiceRoutes from '../modules/warehouse/entrance/invoice/invoice.routes';
import invoiceItemsRoutes from '../modules/warehouse/entrance/invoice-items/invoice-items.routes';
import entranceScanLogsRoutes from '../modules/warehouse/entrance/entrance-scan-logs/entrance-scan-logs.routes';

// Inventory Routes
import productRoutes from '../modules/inventory/products/product.routes';
import stockRoutes from '../modules/inventory/stock/stock.routes';
import supplierMappingRoutes from '../modules/inventory/supplier-mapping/supplier-mapping.routes';

// Integration Routes
import integrationMappingRoutes from '../modules/integrations/integration-mapping/integration-mapping.routes';

const router = Router();

// Warehouse Endpoints
router.use('/warehouse/unit-businesses', unitBusinessRoutes);
router.use('/warehouse/users', userRoutes);
router.use('/warehouse/roles', roleRoutes);
router.use('/warehouse/transporters', transporterRoutes);
router.use('/warehouse/expedition/batches', batchRoutes);
router.use('/warehouse/expedition/batch-items', batchItemsRoutes);
router.use('/warehouse/expedition/batch-invoices', batchInvoicesRoutes);
router.use('/warehouse/expedition/scan-logs', scanLogsRoutes);
router.use('/warehouse/entrance/invoices', invoiceRoutes);
router.use('/warehouse/entrance/invoice-items', invoiceItemsRoutes);
router.use('/warehouse/entrance/scan-logs', entranceScanLogsRoutes);

// Inventory Endpoints
router.use('/inventory/products', productRoutes);
router.use('/inventory/stock', stockRoutes);
router.use('/inventory/supplier-mappings', supplierMappingRoutes);

// Integration Endpoints
router.use('/integrations/mappings', integrationMappingRoutes);

export default router;

/**
 * Estrutura de endpoints criados:
 * 
 * WAREHOUSE
 * POST   /api/warehouse/unit-businesses
 * GET    /api/warehouse/unit-businesses
 * GET    /api/warehouse/unit-businesses/:id
 * PUT    /api/warehouse/unit-businesses/:id
 * DELETE /api/warehouse/unit-businesses/:id
 * 
 * POST   /api/warehouse/users
 * GET    /api/warehouse/users
 * GET    /api/warehouse/users/:id
 * PUT    /api/warehouse/users/:id
 * DELETE /api/warehouse/users/:id
 * 
 * POST   /api/warehouse/expedition/batches
 * GET    /api/warehouse/expedition/batches
 * GET    /api/warehouse/expedition/batches/:id
 * PUT    /api/warehouse/expedition/batches/:id
 * DELETE /api/warehouse/expedition/batches/:id
 * 
 * POST   /api/warehouse/entrance/invoices
 * GET    /api/warehouse/entrance/invoices
 * GET    /api/warehouse/entrance/invoices/:id
 * PUT    /api/warehouse/entrance/invoices/:id
 * DELETE /api/warehouse/entrance/invoices/:id
 * 
 * INVENTORY
 * POST   /api/inventory/products
 * GET    /api/inventory/products
 * GET    /api/inventory/products/:id
 * PUT    /api/inventory/products/:id
 * DELETE /api/inventory/products/:id
 * 
 * POST   /api/inventory/stock
 * GET    /api/inventory/stock
 * GET    /api/inventory/stock/:id
 * PUT    /api/inventory/stock/:id
 * DELETE /api/inventory/stock/:id
 * 
 * POST   /api/inventory/supplier-mappings
 * GET    /api/inventory/supplier-mappings
 * GET    /api/inventory/supplier-mappings/:id
 * PUT    /api/inventory/supplier-mappings/:id
 * DELETE /api/inventory/supplier-mappings/:id
 * 
 * INTEGRATIONS
 * POST   /api/integrations/mappings
 * GET    /api/integrations/mappings
 * GET    /api/integrations/mappings/:id
 * PUT    /api/integrations/mappings/:id
 * DELETE /api/integrations/mappings/:id
 */
