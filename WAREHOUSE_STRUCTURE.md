# 📦 Estrutura de Módulos - Hub Logístico

Esta documentação descreve a estrutura de módulos criada para gerenciar operações logísticas (entrada, saída, inventário) com múltiplas integrações ERP.

---

## 🏗️ Estrutura de Diretórios

```
src/modules/
├── warehouse/                          # Operações logísticas
│   ├── unit-business/                  # Filiais/unidades
│   ├── users/                          # Usuários e permissões
│   ├── expedition/                     # Operação de saída
│   │   ├── batch/                      # Lotes de separação
│   │   ├── batch-items/                # Itens dos lotes
│   │   ├── batch-invoices/             # Notas nos lotes
│   │   └── scan-logs/                  # Registro de leituras QR
│   └── entrance/                       # Operação de entrada
│       ├── invoice/                    # Notas fiscais
│       ├── invoice-items/              # Itens das notas
│       └── entrance-scan-logs/         # Registro de leituras de entrada
├── inventory/                          # Gestão de inventário
│   ├── products/                       # Catálogo de produtos
│   ├── stock/                          # Saldo por unidade
│   └── supplier-mapping/               # Mapeamento de fornecedores
└── integrations/                       # Sincronização com ERPs
    └── integration-mapping/            # Mapeamento de IDs (Bling, Tiny, etc)
```

---

## 🔧 Padrão de Arquivos em Cada Módulo

Cada módulo segue este padrão:

```
modulo/
├── modulo.types.ts        # Interfaces TypeScript
├── modulo.model.ts        # Schema Sequelize + Model
├── modulo.repository.ts   # Acesso ao BD
├── modulo.service.ts      # Lógica de negócio
├── modulo.controller.ts   # Controllers HTTP
└── modulo.routes.ts       # Definição de rotas
```

### Exemplo: Produto

**modulo/product.types.ts** - Define tipos
```typescript
export interface ProductAttributes {
  id: string;
  name: string;
  sku: string;
  ean: string;
}
```

**modulo/product.model.ts** - Schema do BD
```typescript
class Product extends Model<ProductAttributes, ProductCreationAttributes> {
  // Definição dos campos e relacionamentos
}
```

**modulo/product.repository.ts** - Queries
```typescript
export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }
}
```

**modulo/product.service.ts** - Lógica
```typescript
export class ProductService extends BaseService<Product, ProductRepository> {
  constructor() {
    super(productRepository);
  }
}
```

**modulo/product.controller.ts** - Endpoints
```typescript
async create(req: Request, res: Response) {
  const product = await ProductService.create(req.body);
  res.status(201).json(product);
}
```

**modulo/product.routes.ts** - Mapeamento
```typescript
router.post('/', ProductController.create.bind(ProductController));
```

---

## 📊 Modelos e Relacionamentos

### WAREHOUSE - Estrutura Organizacional

#### **UnitBusiness** (Filial)
```sql
id (UUID)
number (STRING) -- Código da filial
name (STRING)
cnpj (STRING)
integrations_id (STRING) -- Qual ERP usa
head_office (BOOLEAN)
```

#### **User** (Usuário)
```sql
id (UUID)
name (STRING)
cpf (STRING)
unit_business_id (FK) -- Qual filial trabalha
role_id (FK) -- Qual função tem
email (STRING)
```

#### **Role** (Função/Permissão)
```sql
id (UUID)
name (STRING) -- Ex: "Operador Scanner"
permissions (JSON) -- Ex: ["SCANNER:WRITE", "INVOICE:READ"]
```

---

### EXPEDITION - Operação de Saída (Picking & Packing)

#### **ExpeditionBatch** (Lote de Separação)
```sql
id (UUID)
number (STRING) -- Código único do lote
status (ENUM) -- OPEN, PENDING, FINISHED
unit_business_id (FK)
total_volumes (INTEGER)
integrations_id (STRING) -- Se veio de integração
id_system (STRING) -- ID para responder ao ERP
```

#### **ExpeditionBatchInvoice** (Notas no Lote)
```sql
id (UUID)
expedition_batch_id (FK)
invoice_id (FK)
-- Tabela de ligação: quais notas compõem este lote
```

#### **ExpeditionBatchItems** (Itens a Separar)
```sql
id (UUID)
expedition_batch_id (FK)
product_id (FK)
quantity (INTEGER) -- Total esperado
quantity_scanned (INTEGER) -- O que já foi validado
```

#### **ExpeditionScanLog** (Cada "Bip" do Scanner)
```sql
id (UUID)
expedition_batch_items_id (FK)
label_full_code (STRING) -- CNPJ + NF + EAN + VOL (para validação)
vol_number (STRING) -- Últimos 6 dígitos (para rastreio)
user_id (FK) -- Quem escaneou
created_at (TIMESTAMP)
```

---

### ENTRANCE - Operação de Entrada (Recebimento)

#### **Invoice** (Nota Fiscal)
```sql
id (UUID)
customer_name (STRING)
customer_cnpj_cpf (STRING)
key (STRING) -- Chave de 44 dígitos (identificador único)
xml_path (TEXT) -- Caminho para o XML
unit_business_id (FK)
sender_cnpj (STRING)
sender_name (STRING)
receiver_cnpj (STRING)
receiver_name (STRING)
transporter_id (FK)
integrations_id (STRING)
id_system (STRING) -- ID para responder ao ERP
```

#### **InvoiceItems** (Itens da Nota)
```sql
id (UUID)
invoice_id (FK)
product_id (FK)
quantity_expected (INTEGER)
quantity_received (INTEGER)
status (ENUM) -- PENDING, FINISHED
```

#### **EntranceScanLog** (Cada "Bip" de Entrada)
```sql
id (UUID)
invoice_items_id (FK)
label_full_code (STRING) -- Mesmo formato de validação
vol_number (STRING)
user_id (FK)
created_at (TIMESTAMP)
```

---

### INVENTORY - Gestão de Inventário

#### **Product** (Catálogo)
```sql
id (UUID)
name (STRING)
sku (STRING) -- Código interno
ean (STRING) -- Código universal (13 dígitos)
```

#### **Stock** (Saldo por Filial)
```sql
id (UUID)
unit_business_id (FK)
product_id (FK)
quantity (INTEGER)
-- Índice único: (unit_business_id, product_id)
```

#### **SupplierMapping** (De-Para de Fornecedores)
```sql
id (UUID)
product_id (FK)
supplier_cnpj (STRING)
supplier_product_code (STRING)
-- Resolve: quando o fornecedor envia código diferente do seu SKU
```

---

### INTEGRATIONS - Sincronização com ERPs

#### **IntegrationMapping** (Mapeamento de IDs)
```sql
id (UUID)
entity_type (ENUM) -- PRODUCT ou INVOICE
internal_id (STRING) -- ID no seu BD
integration_id (STRING) -- Qual ERP (Bling, Tiny, etc)
external_id (STRING) -- ID que o ERP usa
unit_business_id (FK)
-- Índice único: (entity_type, internal_id, integration_id, unit_business_id)
```

Exemplo:
```json
{
  "entity_type": "PRODUCT",
  "internal_id": "550e8400-e29b-41d4-a716-446455440000", // ID no seu BD
  "integration_id": "bling",
  "external_id": "12345", // ID no Bling
  "unit_business_id": "filial-sp"
}
```

---

## 🔗 Associações Sequelize

Execute `setupAssociations()` no seu arquivo de configuração para relacionar os modelos:

```typescript
import { setupAssociations } from './config/sequelize-associations';

// Em seu arquivo de inicialização
setupAssociations();
```

Isto criará relacionamentos automáticos entre:
- UnitBusiness → Users, Batches, Invoices, Stocks
- Products → SupplierMappings, Stocks, BatchItems, InvoiceItems
- ExpeditionBatch → BatchItems, BatchInvoices, ScanLogs
- Invoice → InvoiceItems, EntranceScanLogs
- Users → ScanLogs (expedição e entrada)

---

## 📡 API Endpoints

### Warehouse
```
POST   /api/warehouse/unit-businesses
GET    /api/warehouse/unit-businesses
GET    /api/warehouse/unit-businesses/:id
PUT    /api/warehouse/unit-businesses/:id
DELETE /api/warehouse/unit-businesses/:id

POST   /api/warehouse/users
GET    /api/warehouse/users
GET    /api/warehouse/users/:id
PUT    /api/warehouse/users/:id
DELETE /api/warehouse/users/:id

POST   /api/warehouse/expedition/batches
GET    /api/warehouse/expedition/batches
GET    /api/warehouse/expedition/batches/:id
PUT    /api/warehouse/expedition/batches/:id
DELETE /api/warehouse/expedition/batches/:id

POST   /api/warehouse/entrance/invoices
GET    /api/warehouse/entrance/invoices
GET    /api/warehouse/entrance/invoices/:id
PUT    /api/warehouse/entrance/invoices/:id
DELETE /api/warehouse/entrance/invoices/:id
```

### Inventory
```
POST   /api/inventory/products
GET    /api/inventory/products
GET    /api/inventory/products/:id
PUT    /api/inventory/products/:id
DELETE /api/inventory/products/:id

POST   /api/inventory/stock
GET    /api/inventory/stock
GET    /api/inventory/stock/:id
PUT    /api/inventory/stock/:id
DELETE /api/inventory/stock/:id

POST   /api/inventory/supplier-mappings
GET    /api/inventory/supplier-mappings
GET    /api/inventory/supplier-mappings/:id
PUT    /api/inventory/supplier-mappings/:id
DELETE /api/inventory/supplier-mappings/:id
```

### Integrations
```
POST   /api/integrations/mappings
GET    /api/integrations/mappings
GET    /api/integrations/mappings/:id
PUT    /api/integrations/mappings/:id
DELETE /api/integrations/mappings/:id
```

---

## 🚀 Como Estender Módulos

Se precisar adicionar métodos customizados (ex: filtros, cálculos), faça na **Service**:

```typescript
// warehouse/expedition/batch/batch.service.ts
export class ExpeditionBatchService extends BaseService {
  async findByStatus(status: string) {
    return this.repository.findAll({
      where: { status }
    });
  }

  async finalizeBatch(batchId: string) {
    const batch = await this.findById(batchId);
    // Validar se todos itens foram escaneados
    // Atualizar estoque
    // Avisar ERP
    await this.update(batchId, { status: 'FINISHED' });
  }
}
```

---

## 📝 Exemplo de Fluxo Completo

### Entrada (Recebimento de Nota)
1. **POST /api/warehouse/entrance/invoices** → Cria Invoice no BD
2. **POST /api/warehouse/entrance/invoices/{id}/items** → Adiciona items esperados
3. Operador lê label no scanner → **POST /api/warehouse/entrance/scan-logs**
4. Sistema valida EAN + NF → Incrementa `quantity_received`
5. Todos items recebidos? → Status = FINISHED
6. Sistema atualiza **Stock** (+ quantidade na filial)
7. Responde ao ERP via **IntegrationMapping**

### Saída (Lote de Separação)
1. **POST /api/warehouse/expedition/batches** → Cria Batch
2. **POST /api/warehouse/expedition/batches/{id}/invoices** → Adiciona notas
3. Sistema gera **ExpeditionBatchItems** (consolidado por produto)
4. Operadores separam e leem labels → **POST /api/warehouse/expedition/scan-logs**
5. Sistema valida e incrementa `quantity_scanned`
6. Tudo pronto? → Status = FINISHED
7. Sistema atualiza **Stock** (- quantidade na filial)
8. Responde ao ERP

---

## 🔐 Próximos Passos Recomendados

- [ ] Criar migrations Sequelize para cada modelo
- [ ] Adicionar validações nos models (ex: CNPJ, CPF, EAN)
- [ ] Implementar autenticação/autorização baseada em Roles
- [ ] Adicionar indices no BD para queries frequentes
- [ ] Criar jobs para sincronizar com ERPs (BullMQ/Redis)
- [ ] Adicionar logs de auditoria (quem/quando/o quê foi alterado)
- [ ] Validar label_full_code no scanner
- [ ] Testes unitários dos services
