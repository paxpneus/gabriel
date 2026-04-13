/**
 * GUIA RÁPIDO - Como Usar os Novos Módulos
 * 
 * Este arquivo mostra exemplos práticos de como usar os modelos, services e controllers criados.
 */

// ============================================
// 1️⃣  IMPORTS BÁSICOS
// ============================================

// Modelos individuais
import UnitBusiness from './modules/warehouse/unit-business/unit-business.model';
import Product from './modules/inventory/products/product.model';
import ExpeditionBatch from './modules/warehouse/expedition/batch/batch.model';

// Services (já instantiados)
import UnitBusinessService from './modules/warehouse/unit-business/unit-business.service';
import ProductService from './modules/inventory/products/product.service';
import ExpeditionBatchService from './modules/warehouse/expedition/batch/batch.service';

// Controllers (já instantiados)
import UnitBusinessController from './modules/warehouse/unit-business/unit-business.controller';

// Tipos
import type { ProductAttributes, ProductCreationAttributes } from './modules/inventory/products/product.types';
import type { ExpeditionBatchAttributes } from './modules/warehouse/expedition/batch/batch.types';

// ============================================
// 2️⃣  USANDO SERVICES (Forma Recomendada)
// ============================================

// 📌 Criar um novo produto
async function createProduct() {
  const newProduct = await ProductService.create({
    name: 'Pneu Aro 17',
    sku: 'PNEU-AR17-XYZ',
    ean: '1234567890123'
  });
  console.log('Produto criado:', newProduct.id);
}

// 📌 Listar todos produtos
async function listProducts() {
  const products = await ProductService.findAll();
  console.log(`Total de produtos: ${products.length}`);
}

// 📌 Buscar um produto específico
async function getProduct(productId: string) {
  const product = await ProductService.findById(productId);
  if (product) {
    console.log(`Produto: ${product.name} (SKU: ${product.sku})`);
  }
}

// 📌 Atualizar um produto
async function updateProduct(productId: string) {
  const updated = await ProductService.update(productId, {
    name: 'Pneu Aro 18 - NOVO'
  });
  console.log('Produto atualizado:', updated);
}

// 📌 Deletar um produto
async function deleteProduct(productId: string) {
  await ProductService.delete(productId);
  console.log('Produto deletado');
}

// ============================================
// 3️⃣  TRANSACTIONS (Múltiplas Operações)
// ============================================

// 📌 Criar filial + usuário + role em uma transação
async function setupNewBranch() {
  try {
    // 1. Criar Role
    const role = await RoleService.create({
      name: 'Operador Scanner',
      permissions: ['SCANNER:WRITE', 'SCANNER:READ']
    });

    // 2. Criar Unit Business
    const unitBusiness = await UnitBusinessService.create({
      number: 'SP-001',
      name: 'Filial São Paulo',
      cnpj: '12345678000199',
      head_office: true
    });

    // 3. Criar User para essa filial
    const user = await UserService.create({
      name: 'João Scanner',
      cpf: '12345678900',
      email: 'joao@paxpneus.com',
      unit_business_id: unitBusiness.id,
      role_id: role.id
    });

    console.log('✅ Filial, role e usuário criados com sucesso');
  } catch (error) {
    console.error('❌ Erro ao setup:', error);
  }
}

// ============================================
// 4️⃣  LÓGICA ESPECÍFICA DE DOMÍNIO
// ============================================

// 📌 Criar um lote de separação (EXPEDITION BATCH)
async function createExpeditionBatch() {
  const batch = await ExpeditionBatchService.create({
    number: `BATCH-${Date.now()}`,
    status: 'OPEN',
    unit_business_id: 'filial-sp-uuid',
    total_volumes: 50
  });
  
  console.log(`Lote criado: ${batch.number}`);
  return batch;
}

// 📌 Adicionar itens ao lote
async function addItemsToBatch(batchId: string, productIds: string[]) {
  const items = [];
  
  for (const productId of productIds) {
    const item = await ExpeditionBatchItemsService.create({
      expedition_batch_id: batchId,
      product_id: productId,
      quantity: 100,
      quantity_scanned: 0
    });
    items.push(item);
  }
  
  return items;
}

// 📌 Registrar um scan (depende do label estar no formato CNPJ+NF+EAN+VOL)
async function registerScan(
  batchItemId: string,
  labelFullCode: string, // ex: "12345678000199-350123456789012-1234567890123-000001"
  volNumber: string,
  userId: string
) {
  try {
    // Validar formato
    const parts = labelFullCode.split('-');
    if (parts.length !== 4) {
      throw new Error('Label inválido: deve ter formato CNPJ-NF-EAN-VOL');
    }

    const scanLog = await ExpeditionScanLogService.create({
      expedition_batch_items_id: batchItemId,
      label_full_code: labelFullCode,
      vol_number: volNumber.slice(-6), // Últimos 6 dígitos
      user_id: userId
    });

    // Incrementar quantity_scanned
    const batchItem = await ExpeditionBatchItemsService.findById(batchItemId);
    await ExpeditionBatchItemsService.update(batchItemId, {
      quantity_scanned: batchItem.quantity_scanned + 1
    });

    console.log(`✅ Scan registrado: ${labelFullCode}`);
    return scanLog;
  } catch (error) {
    console.error(`❌ Erro ao registrar scan:`, error);
    throw error;
  }
}

// ============================================
// 5️⃣  INTEGRAÇÕES COM ERPS
// ============================================

// 📌 Mapear um produto no Bling
async function mapProductToBling(productId: string, blingId: string) {
  const mapping = await IntegrationMappingService.create({
    entity_type: 'PRODUCT',
    internal_id: productId,
    integration_id: 'bling',
    external_id: blingId,
    unit_business_id: 'filial-sp-uuid'
  });

  console.log(`Produto ${productId} mapeado no Bling como ${blingId}`);
  return mapping;
}

// 📌 Buscar ID externo de um produto
async function getExternalProductId(productId: string, integrationId: string) {
  const mappings = await IntegrationMappingService.findAll({
    where: {
      entity_type: 'PRODUCT',
      internal_id: productId,
      integration_id: integrationId
    }
  });

  return mappings.length > 0 ? mappings[0].external_id : null;
}

// ============================================
// 6️⃣  CONSULTAS COM RELACIONAMENTOS
// ============================================

// 📌 Listar lotes com todos os itens
async function getBatchWithItems(batchId: string) {
  const batch = await ExpeditionBatch.findByPk(batchId, {
    include: [
      { association: 'items', include: [{ association: 'scanLogs' }] },
      { association: 'batchInvoices' },
      { association: 'unitBusiness' }
    ]
  });

  return batch;
}

// 📌 Listar produtos por fornecedor
async function getProductsBySupplier(supplierCnpj: string) {
  const mappings = await SupplierMappingService.findAll({
    where: { supplier_cnpj: supplierCnpj },
    include: [{
      model: Product,
      as: 'product'
    }]
  });

  return mappings.map(m => m.product);
}

// 📌 Listar estoque de uma filial
async function getStockByUnitBusiness(unitBusinessId: string) {
  const stocks = await StockService.findAll({
    where: { unit_business_id: unitBusinessId },
    include: [{
      model: Product,
      as: 'product'
    }]
  });

  return stocks;
}

// ============================================
// 7️⃣  VALIDAÇÕES E ERROS
// ============================================

// 📌 Validar CNPJ antes de criar filial
function isValidCNPJ(cnpj: string): boolean {
  return /^\d{14}$/.test(cnpj);
}

// 📌 Validar EAN (13 dígitos)
function isValidEAN(ean: string): boolean {
  return /^\d{13}$/.test(ean);
}

// 📌 Validar formato de chave NF (44 dígitos)
function isValidNFKey(key: string): boolean {
  return /^\d{44}$/.test(key);
}

// 📌 Criar produto com validações
async function createProductWithValidation(data: any) {
  if (!isValidEAN(data.ean)) {
    throw new Error('EAN deve ter 13 dígitos');
  }

  if (!data.sku || data.sku.length === 0) {
    throw new Error('SKU é obrigatório');
  }

  return await ProductService.create(data);
}

// ============================================
// 8️⃣  EXEMPLO: WORKFLOW COMPLETO
// ============================================

async function completeWarehouseWorkflow() {
  try {
    // 1. Configurar nova filial
    console.log('📦 1. Criando filial São Paulo...');
    const unitBusiness = await UnitBusinessService.create({
      number: 'SP-002',
      name: 'Armazém SP',
      cnpj: '12345678000199',
      head_office: false
    });

    // 2. Criar usuário para leitura de scanner
    console.log('👤 2. Criando operador...');
    const role = await RoleService.create({
      name: 'Scanner Operator',
      permissions: ['SCANNER:WRITE']
    });

    const operator = await UserService.create({
      name: 'Maria Armazém',
      cpf: '98765432100',
      email: 'maria@paxpneus.com',
      unit_business_id: unitBusiness.id,
      role_id: role.id
    });

    // 3. Criar produtos
    console.log('🛍️ 3. Cadastrando produtos...');
    const product1 = await ProductService.create({
      name: 'Pneu 205/60/16',
      sku: 'PNEU-205-60-16',
      ean: '1234567890123'
    });

    // 4. Criar lote de separação
    console.log('📋 4. Criando lote de separação...');
    const batch = await ExpeditionBatchService.create({
      number: `BATCH-${Date.now()}`,
      status: 'OPEN',
      unit_business_id: unitBusiness.id,
      total_volumes: 10
    });

    // 5. Adicionar itens ao lote
    console.log('📦 5. Adicionando itens...');
    const batchItem = await ExpeditionBatchItemsService.create({
      expedition_batch_id: batch.id,
      product_id: product1.id,
      quantity: 10,
      quantity_scanned: 0
    });

    // 6. Simular scans
    console.log('📱 6. Registrando scans...');
    for (let i = 1; i <= 5; i++) {
      await registerScan(
        batchItem.id,
        `12345678000199-350123456789012-1234567890123-00000${i}`,
        `00000${i}`,
        operator.id
      );
    }

    // 7. Consultar resultado
    console.log('✅ 7. Consultando resultado final...');
    const finalBatch = await getBatchWithItems(batch.id);
    console.log('Lote finalizado:', {
      numero: finalBatch.number,
      status: finalBatch.status,
      itens: finalBatch.items.length,
      scans: finalBatch.items.reduce((acc, i) => acc + i.scanLogs.length, 0)
    });

    console.log('\n🎉 Workflow completado com sucesso!');
  } catch (error) {
    console.error('❌ Erro no workflow:', error);
  }
}

// ============================================
// 9️⃣  EXCUTANDO EXEMPLOS
// ============================================

// Descomente para testar:
// await completeWarehouseWorkflow();
