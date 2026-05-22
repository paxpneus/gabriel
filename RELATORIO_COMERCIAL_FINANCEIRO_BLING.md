# Relatório Comercial e Financeiro com dados de ERP

Este documento descreve tudo que precisa ser alterado/adicionado no backend da PAX Pneus para gerar um relatório comercial e financeiro com visões por estado, geral, produto, loja e status, usando dados de ERPs integrados, XML de NF-e e custo médio do estoque.

A Bling é a primeira integração considerada neste desenho, mas a estrutura não deve ficar presa a ela. No futuro, o mesmo relatório deve receber dados da Tecinco ou de outro ERP sem alterar as tabelas analíticas principais. Por isso, os campos do domínio devem ser genéricos (`external_id`, `source_system`, `integration_id`) e cada conector deve traduzir seu payload para o mesmo modelo canônico.

O desenho segue o mesmo padrão do relatório diário operacional já existente em `src/modules/reports/daily-operation-report`:

- um job incremental com checkpoint em `report_job_checkpoints`;
- uma tabela de snapshot granular, congelando os dados derivados por pedido/item;
- tabelas de facts agregadas para consulta rápida;
- `ON CONFLICT DO UPDATE` para upsert idempotente;
- recalculo das chaves antigas e novas quando um pedido muda de data, loja, UF ou status.

## 1. Objetivo do relatório

O relatório precisa entregar estas visões.

### Por estado

- Número de pedidos.
- Quantidade de volumes.
- Valor total.
- Frete médio.
- Ticket médio.

### Geral

- Número de pedidos.
- Quantidade de volumes.
- Valor total.
- Frete.
- Ticket médio.

### Por produto

- Quantidade.
- Custo.
- Valor.
- Markup.

### Por loja

- Quantidade de pedidos.
- Ticket médio.
- Quantidade de volumes.
- Custo.
- Valor.
- Frete.
- Valor peça.
- Markup.
- Impostos.
- Taxas.
- Contribuição em valor.
- Contribuição em percentual.
- Quantidade e valor por status.

## 2. Regras importantes já definidas

### 2.1. Não confiar em volume de transportadora

Para este relatório, `transporte.quantidadeVolumes`, `produto.volumes` e volumes da transportadora não devem ser usados como quantidade vendida.

Para pneus, a quantidade de volumes/peças deve ser:

```txt
quantidade_volumes = SUM(itens.quantidade)
```

Ou seja, sempre usar a quantidade dos itens vendidos.

Exemplo:

```txt
Pedido com 1 item de pneu e quantidade 4
quantidade_volumes = 4
```

Mesmo se o ERP retornar `transporte.quantidadeVolumes = 0`, o relatório deve considerar 4 volumes/peças.

### 2.2. Custo deve ser custo médio

O relatório não deve usar diretamente o custo do fornecedor informado pelo ERP como custo definitivo da venda. Esse custo é útil para alimentar o cadastro e o estoque, mas a regra do relatório deve ser:

```txt
Custo Médio = Valor Total Gasto com o Estoque Atual / Quantidade Total de Itens no Estoque
```

No banco atual, a tabela `stocks` já tem:

```txt
stocks.total_price
stocks.quantity
```

Logo:

```txt
average_cost = stocks.total_price / stocks.quantity
```

Se `quantity = 0`, o custo médio deve cair para um fallback definido pela regra de negócio, como `products.supplier_cost_price`, e o snapshot deve marcar que houve fallback. Para relatórios históricos, o que manda é o snapshot do período: se no momento da venda havia estoque/custo médio, usa o custo médio daquela época; se não havia custo confiável, o pedido deve aparecer com `has_cost_fallback = true` para auditoria.

### 2.3. Congelar o custo no momento da venda

O custo médio muda quando entram novas compras, devoluções ou ajustes de estoque. Por isso, o relatório histórico não pode recalcular custo antigo usando o custo médio atual.

Cada item vendido precisa gravar um snapshot:

```txt
average_cost_snapshot
total_cost_snapshot = average_cost_snapshot * quantity
```

Sem esse snapshot, um relatório de janeiro pode mudar em março apenas porque o custo médio do estoque mudou.

### 2.4. Pedido é fonte comercial, NF-e/XML é fonte fiscal

Use cada ERP assim:

- Pedido de venda: total comercial, loja, status, itens, frete cobrado, taxas, data.
- Produto: cadastro, preço, fornecedor, custo do fornecedor, GTIN, marca, NCM/CEST, peso.
- Nota fiscal e XML: UF real do destinatário, valor fiscal, impostos, CFOP, NCM, chave, número da nota, frete fiscal.

## 3. Modelo canônico de integração

O sistema deve separar três camadas:

```txt
ERP externo, como Bling ou Tecinco
  -> adapter/conector de ingestão
  -> tabelas canônicas do sistema
  -> snapshots/facts do relatório
```

As tabelas de venda, produto, nota e relatório não devem ter colunas específicas como `bling_order_id` quando o campo representa um conceito comum a qualquer ERP. O padrão recomendado é:

```txt
integration_id       -> FK para integrations.id
source_system        -> identificador legível: BLING, TECINCO, etc.
external_id          -> id do registro no ERP de origem
external_number      -> número/código exibido pelo ERP de origem
external_status_id   -> id/código de status no ERP de origem
external_status_name -> nome normalizado/mapeado do status
source_payload       -> JSON bruto opcional para auditoria/debug
```

Exemplos:

```txt
Bling pedido data.id        -> orders.external_id
Bling pedido data.numero    -> orders.external_number
Bling situacao.id           -> orders.external_status_id
Bling situacao.valor/status -> orders.external_status_name via mapping

Tecinco pedido id           -> orders.external_id
Tecinco pedido numero       -> orders.external_number
Tecinco status codigo       -> orders.external_status_id
Tecinco status descricao    -> orders.external_status_name via mapping
```

Se algum ERP tiver um campo muito específico que não existe nos outros, ele não deve poluir o modelo principal de relatório. Nesse caso, usar uma destas opções:

- salvar no `source_payload` JSON;
- criar tabela específica do conector, como `bling_order_details` ou `tecinco_order_details`;
- criar uma tabela de mapping se o campo for necessário para traduzir para o domínio canônico.

Decisão recomendada:

```txt
Não criar uma árvore de tabelas de relatório separada por ERP, como order_bling_report e order_tecinco_report.
Criar um modelo canônico único de vendas e relatórios.
Criar adapters por ERP para preencher esse modelo.
Criar tabelas específicas por ERP apenas para payload bruto, auditoria ou campos que não participam do relatório principal.
```

## 4. O que a Bling entrega

Esta seção documenta a Bling porque é a fonte atual. A Tecinco deve ter uma seção equivalente quando a integração for desenhada, sempre mapeando seus campos para o modelo canônico.

### 4.1. Pedido de venda

Campos úteis do pedido:

```txt
data.id
data.numero
data.numeroLoja
data.data
data.dataSaida
data.totalProdutos
data.total
data.contato.id
data.contato.nome
data.contato.tipoPessoa
data.contato.numeroDocumento
data.situacao.id
data.situacao.valor
data.loja.id
data.loja.unidadeNegocio.id
data.outrasDespesas
data.desconto.valor
data.desconto.unidade
data.notaFiscal.id
data.tributacao.totalICMS
data.tributacao.totalIPI
data.itens[].id
data.itens[].codigo
data.itens[].descricao
data.itens[].quantidade
data.itens[].valor
data.itens[].desconto
data.itens[].produto.id
data.itens[].comissao.base
data.itens[].comissao.aliquota
data.itens[].comissao.valor
data.transporte.fretePorConta
data.transporte.frete
data.transporte.quantidadeVolumes
data.transporte.pesoBruto
data.taxas.taxaComissao
data.taxas.custoFrete
data.taxas.valorBase
```

Pontos de atenção:

- `transporte.quantidadeVolumes` pode vir zerado. Não usar para volumes do relatório.
- `transporte.etiqueta.uf` pode vir vazio. Para UF, preferir NF-e/XML.
- `taxas.custoFrete` pode representar custo de frete pago pela operação, mas precisa ser validado contra a regra real de cada canal.
- `situacao.valor` isolado não é legível para usuário. Deve existir mapeamento para nome do status.

### 4.2. Nota fiscal

Campos úteis da nota:

```txt
data.id
data.situacao
data.numero
data.dataEmissao
data.dataOperacao
data.chaveAcesso
data.contato.endereco.uf
data.contato.endereco.municipio
data.loja.id
data.valorNota
data.valorFrete
data.xml
data.itens[].codigo
data.itens[].descricao
data.itens[].quantidade
data.itens[].valor
data.itens[].valorTotal
data.itens[].pesoBruto
data.itens[].pesoLiquido
data.itens[].classificacaoFiscal
data.itens[].cest
data.itens[].gtin
data.itens[].cfop
data.itens[].impostos.valorAproximadoTotalTributos
data.itens[].impostos.icms.aliquota
data.itens[].impostos.icms.valor
```

### 4.3. XML da NF-e

O XML é extremamente importante para relatório fiscal porque traz valores consolidados e detalhes tributários por item.

Campos úteis:

```txt
dest/enderDest/UF
dest/enderDest/xMun
ide/nNF
ide/serie
ide/dhEmi
det/prod/cProd
det/prod/xProd
det/prod/qCom
det/prod/vUnCom
det/prod/vProd
det/prod/NCM
det/prod/CEST
det/prod/CFOP
det/imposto/vTotTrib
det/imposto/ICMS/*/pICMS
det/imposto/ICMS/*/vICMS
det/imposto/ICMSUFDest/vICMSUFDest
det/imposto/IBSCBS/gIBSCBS/gIBSUF/vIBSUF
det/imposto/IBSCBS/gIBSCBS/gIBSMun/vIBSMun
det/imposto/IBSCBS/gIBSCBS/gCBS/vCBS
total/ICMSTot/vProd
total/ICMSTot/vFrete
total/ICMSTot/vDesc
total/ICMSTot/vOutro
total/ICMSTot/vNF
total/ICMSTot/vTotTrib
total/ICMSTot/vICMS
total/ICMSTot/vIPI
total/ICMSTot/vPIS
total/ICMSTot/vCOFINS
total/ICMSTot/vICMSUFDest
```

O projeto já possui `fast-xml-parser` e `xml2js` no `package.json`, então não é necessário adicionar dependência para parsear XML.

### 4.4. Produto

Campos úteis do produto da Bling:

```txt
data.id
data.nome
data.codigo
data.preco
data.estoque.saldoVirtualTotal
data.unidade
data.pesoLiquido
data.pesoBruto
data.gtin
data.gtinEmbalagem
data.marca
data.fornecedor.id
data.fornecedor.contato.id
data.fornecedor.contato.nome
data.fornecedor.codigo
data.fornecedor.precoCusto
data.fornecedor.precoCompra
data.tributacao.ncm
data.tributacao.cest
```

Pontos de atenção:

- `fornecedor.precoCusto` pode alimentar o cadastro/produto.
- O custo do relatório deve ser custo médio do estoque.
- `estoque.saldoVirtualTotal` pode ajudar conciliação, mas o cálculo oficial deve usar o estoque interno se ele for a fonte de verdade. 

## 5. O que falta no sistema atual

### 5.1. `orders`

Hoje a tabela `orders` tem poucos campos para relatório financeiro. Ela guarda total, data, loja, cliente, status interno e números externos.

Faltam campos comerciais genéricos de ERP:

```txt
source_system
integration_id
external_id
external_number
external_store_order_number
external_status_id
external_status_name
external_invoice_id
source_payload
total_products
total_order
discount_value
discount_type
other_expenses
freight_charged
freight_cost
freight_by_account
gross_weight
external_store_id
external_unit_business_id
tax_commission
tax_base_value
marketplace_fee
payment_fee
```

Observação: não é obrigatório adicionar todos diretamente em `orders` se eles forem salvos em uma tabela nova de snapshot comercial. Porém, para sincronização e auditoria, é melhor persistir os principais no pedido.

### 5.2. `order_items`

Hoje a tabela tem:

```txt
order_id
name
sku
unit
quantity
price
```

Faltam:

```txt
product_id
source_system
integration_id
external_item_id
external_product_id
source_payload
unit_price
gross_total
discount_value
net_total
commission_base
commission_rate
commission_value
average_cost_snapshot
total_cost_snapshot
cost_source
```

`cost_source` pode ser:

```txt
STOCK_AVERAGE
PRODUCT_SUPPLIER_COST
ZERO_STOCK
MANUAL
UNKNOWN
```

### 5.3. `products`

Hoje a tabela tem:

```txt
id_system
name
sku
ean
ean_tribut
price
type
```

Faltam campos vindos do ERP e campos de custo:

```txt
source_system
integration_id
external_id
source_payload
unit
brand
gross_weight
net_weight
gtin
gtin_package
ncm
cest
supplier_external_id
supplier_contact_id
supplier_name
supplier_product_code
supplier_cost_price
supplier_purchase_price
stock_virtual_total
average_cost
average_cost_updated_at
```

`average_cost` pode ser armazenado para consulta rápida, mas a fonte calculável continua sendo:

```txt
stocks.total_price / stocks.quantity
```

### 5.4. `stocks`

Hoje `stocks` tem:

```txt
product_id
unit_business_id
total_price
quantity
```

Isso é suficiente para custo médio, desde que `total_price` represente o valor total gasto com o estoque atual.

Recomendações:

- Garantir que a unicidade seja composta por `(product_id, unit_business_id)`.
- Conferir se o banco real não está com `unique` separado em `product_id` e `unit_business_id`, pois isso quebraria estoque por filial.
- Padronizar atualizações de entrada/saída para manter `total_price` e `quantity` corretos.

### 5.5. `invoices`

Hoje `invoices` guarda dados operacionais, XML path, chave, emitente/destinatário, status e datas, mas não guarda os totais fiscais necessários para relatório comercial.

Faltam:

```txt
source_system
integration_id
external_id
invoice_number
invoice_series
invoice_key
invoice_value
invoice_products_value
invoice_freight_value
invoice_discount_value
invoice_other_value
invoice_total_tax_value
icms_value
ipi_value
pis_value
cofins_value
difal_value
ibs_value
cbs_value
destination_uf
destination_city
xml_url
source_payload
```

### 5.6. `invoice_items`

Hoje `invoice_items` é voltada para operação de recebimento/expedição. Ela não guarda valores fiscais por item.

Faltam campos, ou uma tabela nova separada, para:

```txt
sku
description
quantity
unit_price
total_value
ncm
cest
cfop
gtin
approx_tax_value
icms_rate
icms_value
ipi_value
pis_value
cofins_value
difal_value
ibs_value
cbs_value
```

Recomendação: criar uma tabela fiscal separada, por exemplo `invoice_fiscal_items`, para não misturar com o fluxo operacional de leitura.

## 6. Modelo recomendado de tabelas para o relatório

O relatório diário operacional atual usa:

```txt
invoice_operation_snapshots
daily_operation_facts
daily_transporter_facts
report_job_checkpoints
```

Para este relatório, recomendo criar estrutura equivalente:

```txt
sales_order_snapshots
sales_order_item_snapshots
daily_sales_facts
daily_sales_state_facts
daily_sales_store_facts
daily_sales_product_facts
daily_sales_status_facts
```

Também pode existir uma rota única `sales-report` que consulta essas facts.

## 7. Tabela `sales_order_snapshots`

Snapshot por pedido. Uma linha por pedido vendido.

Finalidade:

- Congelar dados comerciais, fiscais e financeiros do pedido.
- Permitir agregações rápidas por data, loja, UF e status.
- Evitar que mudanças futuras no ERP/produto/estoque alterem o histórico.

Campos recomendados:

```txt
id UUID PK
order_id UUID UNIQUE FK orders.id
invoice_id UUID NULL FK invoices.id
integration_id UUID NULL FK integrations.id
customer_id UUID NULL FK customers.id
store_id UUID NULL FK stores.id
unit_business_id UUID NULL FK unit_businesses.id

source_system VARCHAR(50)
external_order_id VARCHAR(100)
external_order_number VARCHAR(100)
external_invoice_id VARCHAR(100)
invoice_number VARCHAR(100)
invoice_key VARCHAR(255)

order_date DATE NOT NULL
invoice_date DATE NULL
emitted_at TIMESTAMP NULL

destination_uf VARCHAR(2)
destination_city VARCHAR(100)

status_id VARCHAR(50)
status_name VARCHAR(100)
status_value VARCHAR(50)
snapshot_status VARCHAR(30)

items_quantity INTEGER DEFAULT 0

total_products NUMERIC(14,2) DEFAULT 0
total_order NUMERIC(14,2) DEFAULT 0
discount_value NUMERIC(14,2) DEFAULT 0
other_expenses NUMERIC(14,2) DEFAULT 0

freight_charged NUMERIC(14,2) DEFAULT 0
freight_cost NUMERIC(14,2) DEFAULT 0
freight_paid_by_company BOOLEAN DEFAULT FALSE
freight_by_account INTEGER NULL

total_cost NUMERIC(14,2) DEFAULT 0
total_taxes NUMERIC(14,2) DEFAULT 0
total_fees NUMERIC(14,2) DEFAULT 0

tax_commission NUMERIC(14,2) DEFAULT 0
marketplace_fee NUMERIC(14,2) DEFAULT 0
payment_fee NUMERIC(14,2) DEFAULT 0

icms_value NUMERIC(14,2) DEFAULT 0
ipi_value NUMERIC(14,2) DEFAULT 0
pis_value NUMERIC(14,2) DEFAULT 0
cofins_value NUMERIC(14,2) DEFAULT 0
difal_value NUMERIC(14,2) DEFAULT 0
ibs_value NUMERIC(14,2) DEFAULT 0
cbs_value NUMERIC(14,2) DEFAULT 0
approx_tax_value NUMERIC(14,2) DEFAULT 0

contribution_value NUMERIC(14,2) DEFAULT 0
contribution_pct NUMERIC(8,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

has_cost_fallback BOOLEAN DEFAULT FALSE
has_invoice_data BOOLEAN DEFAULT FALSE
source_payload JSONB NULL
last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Índices/constraints:

```txt
UNIQUE(order_id)
INDEX(order_date)
INDEX(order_date, store_id)
INDEX(order_date, unit_business_id)
INDEX(order_date, destination_uf)
INDEX(order_date, status_id)
INDEX(invoice_id)
```

### Fórmulas no snapshot do pedido

```txt
items_quantity = SUM(sales_order_item_snapshots.quantity)
total_cost = SUM(sales_order_item_snapshots.total_cost)
total_taxes = icms + ipi + pis + cofins + difal + ibs + cbs
total_fees = tax_commission + marketplace_fee + payment_fee
```

Frete:

```txt
freight_charged = valor de frete cobrado do cliente
freight_cost = custo de frete pago pela empresa
```

Contribuição:

```txt
contribution_value =
  total_order
  - total_cost
  - CASE WHEN freight_paid_by_company THEN freight_cost ELSE 0 END
  - total_taxes
  - total_fees
```

Percentual de contribuição:

```txt
contribution_pct =
  CASE WHEN total_order = 0 THEN 0
  ELSE contribution_value / total_order * 100
  END
```

Markup:

```txt
markup_pct =
  CASE WHEN total_cost = 0 THEN 0
  ELSE (total_order - total_cost) / total_cost * 100
  END
```

## 8. Tabela `sales_order_item_snapshots`

Snapshot por item vendido. Uma linha por item do pedido.

Campos recomendados:

```txt
id UUID PK
order_snapshot_id UUID FK sales_order_snapshots.id
order_id UUID FK orders.id
order_item_id UUID NULL FK order_items.id
product_id UUID NULL FK products.id
store_id UUID NULL FK stores.id
unit_business_id UUID NULL FK unit_businesses.id

order_date DATE NOT NULL
destination_uf VARCHAR(2)

source_system VARCHAR(50)
external_item_id VARCHAR(100)
external_product_id VARCHAR(100)
sku VARCHAR(100)
description VARCHAR(255)
unit VARCHAR(20)

quantity NUMERIC(14,4) DEFAULT 0
unit_price NUMERIC(14,4) DEFAULT 0
gross_total NUMERIC(14,2) DEFAULT 0
discount_value NUMERIC(14,2) DEFAULT 0
net_total NUMERIC(14,2) DEFAULT 0

average_cost_snapshot NUMERIC(14,4) DEFAULT 0
total_cost_snapshot NUMERIC(14,2) DEFAULT 0
cost_source VARCHAR(30)

markup_pct NUMERIC(8,2) DEFAULT 0

commission_base NUMERIC(14,2) DEFAULT 0
commission_rate NUMERIC(8,4) DEFAULT 0
commission_value NUMERIC(14,2) DEFAULT 0

ncm VARCHAR(20)
cest VARCHAR(20)
cfop VARCHAR(20)
gtin VARCHAR(20)

approx_tax_value NUMERIC(14,2) DEFAULT 0
icms_rate NUMERIC(8,4) DEFAULT 0
icms_value NUMERIC(14,2) DEFAULT 0
ipi_value NUMERIC(14,2) DEFAULT 0
pis_value NUMERIC(14,2) DEFAULT 0
cofins_value NUMERIC(14,2) DEFAULT 0
difal_value NUMERIC(14,2) DEFAULT 0
ibs_value NUMERIC(14,2) DEFAULT 0
cbs_value NUMERIC(14,2) DEFAULT 0

source_payload JSONB NULL
last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Índices:

```txt
INDEX(order_snapshot_id)
INDEX(order_date, product_id)
INDEX(order_date, sku)
INDEX(order_date, store_id)
INDEX(order_date, destination_uf)
```

### Fórmulas por item

Quantidade:

```txt
quantity = ERP pedido itens[].quantidade
```

Valor:

```txt
gross_total = unit_price * quantity
net_total = gross_total - discount_value
```

Custo:

```txt
average_cost_snapshot = stocks.total_price / stocks.quantity
total_cost_snapshot = average_cost_snapshot * quantity
```

Markup:

```txt
markup_pct =
  CASE WHEN total_cost_snapshot = 0 THEN 0
  ELSE (net_total - total_cost_snapshot) / total_cost_snapshot * 100
  END
```

## 9. Tabelas agregadas de facts

### 9.1. `daily_sales_facts`

Uma linha por dia e unidade de negócio.

Campos:

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL

orders_count INTEGER DEFAULT 0
items_quantity NUMERIC(14,4) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
total_freight NUMERIC(14,2) DEFAULT 0
average_freight NUMERIC(14,2) DEFAULT 0
average_ticket NUMERIC(14,2) DEFAULT 0

total_cost NUMERIC(14,2) DEFAULT 0
total_taxes NUMERIC(14,2) DEFAULT 0
total_fees NUMERIC(14,2) DEFAULT 0
contribution_value NUMERIC(14,2) DEFAULT 0
contribution_pct NUMERIC(8,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id)
```

### 9.2. `daily_sales_state_facts`

Uma linha por dia, unidade e UF.

Campos:

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL
destination_uf VARCHAR(2) NOT NULL

orders_count INTEGER DEFAULT 0
items_quantity NUMERIC(14,4) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
total_freight NUMERIC(14,2) DEFAULT 0
average_freight NUMERIC(14,2) DEFAULT 0
average_ticket NUMERIC(14,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id, destination_uf)
```

### 9.3. `daily_sales_store_facts`

Uma linha por dia, unidade e loja.

Campos:

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL
store_id UUID NOT NULL

orders_count INTEGER DEFAULT 0
items_quantity NUMERIC(14,4) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
total_freight NUMERIC(14,2) DEFAULT 0
average_ticket NUMERIC(14,2) DEFAULT 0

total_cost NUMERIC(14,2) DEFAULT 0
piece_average_value NUMERIC(14,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

total_taxes NUMERIC(14,2) DEFAULT 0
total_fees NUMERIC(14,2) DEFAULT 0
contribution_value NUMERIC(14,2) DEFAULT 0
contribution_pct NUMERIC(8,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id, store_id)
```

Fórmulas:

```txt
average_ticket = total_value / orders_count
piece_average_value = total_value / items_quantity
markup_pct = (total_value - total_cost) / total_cost * 100
contribution_pct = contribution_value / total_value * 100
```

### 9.4. `daily_sales_product_facts`

Uma linha por dia, unidade e produto.

Campos:

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL
product_id UUID NULL
sku VARCHAR(100) NOT NULL
description VARCHAR(255)

quantity NUMERIC(14,4) DEFAULT 0
total_cost NUMERIC(14,2) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint sugerida:

```txt
UNIQUE(fact_date, unit_business_id, sku)
```

Use `sku` como parte da chave porque pode haver pedido antigo sem `product_id` mapeado.

### 9.5. `daily_sales_status_facts`

Uma linha por dia, unidade e status.

Campos:

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL
status_id VARCHAR(50) NOT NULL
status_name VARCHAR(100) NOT NULL

orders_count INTEGER DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id, status_id)
```

Exemplo de retorno:

```txt
Atendido (1229/1428) valor total: 1701
```

Para esse formato:

```txt
orders_count_por_status = 1229
orders_count_total_do_dia = 1428
total_value_por_status = 1701
```

## 10. Campos de domínio auxiliares

### 10.1. `external_order_status_mappings`

Para não depender só do formato de status de cada ERP, criar uma tabela genérica de mapeamento de status.

Campos:

```txt
id UUID PK
integration_id UUID FK integrations.id
source_system VARCHAR(50)
external_status_id VARCHAR(50)
external_status_value VARCHAR(100)
normalized_status VARCHAR(100)
display_name VARCHAR(100)
is_cancelled BOOLEAN DEFAULT FALSE
is_final BOOLEAN DEFAULT FALSE
created_at
updated_at
```

Constraint:

```txt
UNIQUE(integration_id, external_status_id)
```

O snapshot grava `status_id` e `status_name` já normalizados. Se o nome do ERP mudar depois, o histórico continua legível.

### 10.2. Tabela fiscal opcional `invoice_fiscal_items`

Se não quiser adicionar campos fiscais em `invoice_items`, criar:

```txt
id UUID PK
invoice_id UUID FK invoices.id
product_id UUID NULL FK products.id
sku VARCHAR(100)
description VARCHAR(255)
quantity NUMERIC(14,4)
unit_price NUMERIC(14,4)
total_value NUMERIC(14,2)
ncm VARCHAR(20)
cest VARCHAR(20)
cfop VARCHAR(20)
gtin VARCHAR(20)
approx_tax_value NUMERIC(14,2)
icms_rate NUMERIC(8,4)
icms_value NUMERIC(14,2)
ipi_value NUMERIC(14,2)
pis_value NUMERIC(14,2)
cofins_value NUMERIC(14,2)
difal_value NUMERIC(14,2)
ibs_value NUMERIC(14,2)
cbs_value NUMERIC(14,2)
created_at
updated_at
```

Constraint:

```txt
UNIQUE(invoice_id, sku, cfop)
```

Se houver risco de SKU repetido na mesma nota, incluir `item_number` do XML.

## 11. Fluxo do job incremental

Criar módulo:

```txt
src/modules/reports/sales-report/
├── sales-report.controller.ts
├── sales-report.queue.ts
├── sales-report.repository.ts
├── sales-report.routes.ts
├── sales-report.service.ts
└── sales-report.types.ts
```

Também criar models/types para as novas tabelas:

```txt
src/modules/reports/sales-order-snapshot/
src/modules/reports/sales-order-item-snapshot/
src/modules/reports/daily-sales-fact/
src/modules/reports/daily-sales-state-fact/
src/modules/reports/daily-sales-store-fact/
src/modules/reports/daily-sales-product-fact/
src/modules/reports/daily-sales-status-fact/
```

### 11.1. Checkpoint

Usar `report_job_checkpoints` com:

```txt
job_name = 'sales_report'
```

Seguir a mesma regra do relatório operacional:

- capturar `jobStartTime` no começo;
- buscar `last_processed_at`;
- marcar running;
- processar;
- ao final salvar `last_processed_at = jobStartTime`;
- nunca usar `NOW()` no final como novo checkpoint.

### 11.2. Encontrar pedidos afetados

O repository deve ter algo como:

```txt
findAffectedOrderIds(lastProcessedAt)
```

Fontes de alteração:

```txt
orders.updated_at >= lastProcessedAt
order_items.updated_at >= lastProcessedAt
invoices.updated_at >= lastProcessedAt
invoice fiscal items updated_at >= lastProcessedAt
products.updated_at >= lastProcessedAt
stocks.updated_at >= lastProcessedAt
```

Ponto importante sobre custo médio:

- Se `stocks` de um produto mudar, não se deve recalcular custo de todos os pedidos antigos indiscriminadamente.
- O custo do item vendido deve ser congelado no momento da venda.
- Alteração de `stocks` deve afetar novos snapshots ainda sem custo, pedidos recentes em aberto ou reprocessamento manual controlado.

Recomendação:

- Job incremental normal recalcula pedidos alterados.
- Backfill/reprocessamento de custo histórico deve ser um comando separado e explícito.

### 11.3. Buscar chaves antigas antes do upsert

Igual ao `daily-operation-report.service.ts`, antes de atualizar snapshots:

```txt
previousFactKeys = findAffectedFactKeys(orderIds)
previousStateKeys = findAffectedStateFactKeys(orderIds)
previousStoreKeys = findAffectedStoreFactKeys(orderIds)
previousProductKeys = findAffectedProductFactKeys(orderIds)
previousStatusKeys = findAffectedStatusFactKeys(orderIds)
```

Depois do `upsertSnapshots(orderIds)`, buscar as chaves atuais e unir com as antigas.

Isso é necessário porque um pedido pode mudar:

- de data;
- de loja;
- de UF;
- de status;
- de unidade de negócio;
- de produto mapeado.

Sem recalcular as chaves antigas, a fact antiga fica com lixo acumulado.

### 11.4. Upsert de snapshots

Etapas:

1. Montar dados comerciais a partir de `orders` e `order_items`.
2. Associar produto por `product_id`, `sku`, `id_system` ou `external_product_id`.
3. Buscar custo médio em `stocks`.
4. Buscar dados fiscais em `invoices` e XML/tabela fiscal.
5. Gravar `sales_order_item_snapshots`.
6. Agregar itens e gravar `sales_order_snapshots`.

Pseudo-SQL do custo médio:

```sql
CASE
  WHEN s.quantity > 0 THEN ROUND((s.total_price::numeric / s.quantity::numeric), 4)
  WHEN p.supplier_cost_price IS NOT NULL THEN p.supplier_cost_price
  ELSE 0
END AS average_cost_snapshot
```

Fonte do custo:

```sql
CASE
  WHEN s.quantity > 0 THEN 'STOCK_AVERAGE'
  WHEN p.supplier_cost_price IS NOT NULL THEN 'PRODUCT_SUPPLIER_COST'
  ELSE 'UNKNOWN'
END AS cost_source
```

### 11.5. Upsert das facts

Depois dos snapshots, recalcular agregados somente das chaves afetadas:

```txt
upsertDailySalesFacts(keys)
upsertDailySalesStateFacts(keys)
upsertDailySalesStoreFacts(keys)
upsertDailySalesProductFacts(keys)
upsertDailySalesStatusFacts(keys)
```

Todas devem usar `ON CONFLICT DO UPDATE`, como no relatório operacional.

## 12. Cálculos das visões

### 12.1. Por estado

Fonte:

```txt
daily_sales_state_facts
```

Fórmulas:

```txt
Numero de pedidos = orders_count
Quantidade de volumes = items_quantity
Valor total = total_value
Frete medio = total_freight / orders_count
Ticket medio = total_value / orders_count
```

UF:

```txt
destination_uf = NF-e contato.endereco.uf ou XML dest/enderDest/UF
```

Não usar UF da etiqueta de transporte se a NF-e existir.

### 12.2. Geral

Fonte:

```txt
daily_sales_facts
```

Fórmulas:

```txt
Numero de pedidos = orders_count
Quantidade de volumes = items_quantity
Valor total = total_value
Frete = total_freight
Ticket medio = total_value / orders_count
```

### 12.3. Por produto

Fonte:

```txt
daily_sales_product_facts
```

Fórmulas:

```txt
Quantidade = quantity
Custo = total_cost
Valor = total_value
Markup = (total_value - total_cost) / total_cost * 100
```

### 12.4. Por loja

Fonte:

```txt
daily_sales_store_facts
```

Fórmulas:

```txt
Quantidade de pedidos = orders_count
Ticket medio = total_value / orders_count
Quantidade de volumes = items_quantity
Custo = total_cost
Valor = total_value
Frete = total_freight
Valor peça = total_value / items_quantity
Markup = (total_value - total_cost) / total_cost * 100
Impostos = total_taxes
Taxas = total_fees
$ contribuição = contribution_value
% contribuição = contribution_value / total_value * 100
```

### 12.5. Por status

Fonte:

```txt
daily_sales_status_facts
```

Fórmulas:

```txt
Quantidade por status = orders_count do status
Quantidade total = SUM(orders_count) do dia/unidade
Valor total do status = total_value
```

Formato:

```txt
Atendido (1229/1428) valor total: 1701
```

## 13. API sugerida

Criar rota:

```txt
GET /sales-report
```

Filtros:

```txt
dateFrom
dateTo
unitBusinessId
storeId
state
productId
sku
statusId
drillDown
```

Retorno sugerido:

```json
{
  "period": {
    "dateFrom": "2026-05-01",
    "dateTo": "2026-05-21"
  },
  "general": {},
  "byState": [],
  "byProduct": [],
  "byStore": [],
  "byStatus": [],
  "orders": []
}
```

`orders` só deve vir quando `drillDown = true`, buscando de `sales_order_snapshots`.

## 14. Sincronização dos ERPs

Cada ERP deve ter um adapter/conector que converte o payload externo para o modelo canônico do sistema. Bling e Tecinco não devem gerar tabelas de relatório diferentes; devem alimentar as mesmas tabelas (`orders`, `order_items`, `products`, `invoices`, snapshots e facts).

### 14.1. Produto

Ao sincronizar produto de qualquer ERP:

1. Upsert em `products`.
2. Salvar `integration_id`, `source_system`, `external_id` e campos canônicos.
3. Atualizar `supplier_cost_price` e `supplier_purchase_price`.
4. Opcionalmente atualizar `stock_virtual_total` para conciliação.

Não substituir custo médio oficial apenas com o custo informado pelo ERP, exceto se a regra da empresa definir aquele ERP como fonte de estoque/custo.

### 14.2. Pedido

Ao sincronizar pedido:

1. Upsert em `orders`.
2. Upsert em `order_items`.
3. Salvar status externo e status normalizado via `external_order_status_mappings`.
4. Salvar totais, frete, desconto, despesas e taxas.
5. Se o ERP informar uma nota vinculada, preencher `external_invoice_id` e enfileirar busca da NF-e.

Na Bling esse vínculo vem como `notaFiscal.id`. Na Tecinco, o nome do campo pode ser diferente; o adapter deve preencher o mesmo campo canônico `external_invoice_id`.

### 14.3. Nota fiscal e XML

Ao sincronizar nota:

1. Upsert em `invoices`.
2. Salvar `valorNota`, `valorFrete`, chave, número, data, UF e cidade.
3. Baixar/parsear XML.
4. Salvar totais fiscais da NF-e.
5. Salvar itens fiscais em `invoice_fiscal_items` ou campos equivalentes.
6. Enfileirar/reprocessar `sales_report` para os pedidos afetados.

## 15. Ordem recomendada de implementação

### Fase 1: base de dados

1. Criar migrations para campos faltantes em `products`, `orders`, `order_items`, `invoices`.
2. Criar tabela fiscal `invoice_fiscal_items`.
3. Criar tabelas de snapshots/facts de venda.
4. Criar constraints e índices.

### Fase 2: ingestão dos ERPs

1. Atualizar sincronização de produtos da Bling usando campos canônicos.
2. Atualizar sincronização de pedidos da Bling usando campos canônicos.
3. Atualizar sincronização de notas da Bling usando campos canônicos.
4. Implementar parser do XML da NF-e.
5. Salvar status externo em tabela auxiliar genérica.
6. Quando a Tecinco entrar, criar apenas o adapter dela para alimentar o mesmo modelo.

### Fase 3: relatório

1. Criar módulo `sales-report`.
2. Implementar checkpoint `sales_report`.
3. Implementar `findAffectedOrderIds`.
4. Implementar `upsertSnapshots`.
5. Implementar upsert das facts.
6. Criar endpoint de consulta.
7. Adicionar fila recorrente com `BaseQueueService`, igual ao relatório diário operacional.

### Fase 4: validação

1. Validar pedido real com NF-e e XML.
2. Conferir se quantidade de volumes bate com soma dos itens.
3. Conferir custo médio por produto/unidade.
4. Conferir markup por produto.
5. Conferir contribuição por loja.
6. Conferir status e totais.

## 16. Exemplo com os dados informados

Produto:

```txt
Produto: Pneu 185/65R14 86H UltraContact Continental
SKU: 03151550000
Preço de venda NF-e: 449.90
Quantidade: 4
Fornecedor preço custo Bling: 335.605
```

Se o estoque interno estiver:

```txt
stocks.total_price = 5369.68
stocks.quantity = 16
```

Custo médio:

```txt
5369.68 / 16 = 335.605
```

Item vendido:

```txt
Valor = 449.90 * 4 = 1799.60
Custo = 335.605 * 4 = 1342.42
Markup = ((1799.60 - 1342.42) / 1342.42) * 100 = 34.06%
```

Quantidade de volumes:

```txt
SUM(itens.quantidade) = 4
```

Mesmo que a Bling retorne:

```txt
transporte.quantidadeVolumes = 0
produto.volumes = 0
```

o relatório deve usar:

```txt
quantidade_volumes = 4
```

UF:

```txt
XML dest/enderDest/UF = SP
```

Logo o pedido entra no agrupamento por estado `SP`.

## 17. Riscos e decisões pendentes

### 17.1. Frete pago pela empresa

A Bling traz:

```txt
pedido.transporte.frete
pedido.taxas.custoFrete
nota.valorFrete
XML total/ICMSTot/vFrete
```

É preciso definir:

- qual campo representa frete cobrado do cliente;
- qual campo representa frete pago pela PAX;
- em quais canais o frete deve entrar como despesa na contribuição.

Recomendação:

```txt
freight_charged = pedido.transporte.frete ou nota.valorFrete, conforme canal
freight_cost = pedido.taxas.custoFrete quando preenchido
freight_paid_by_company = regra por fretePorConta/canal/loja
```

### 17.2. Taxas

A Bling traz algumas taxas no pedido:

```txt
taxas.taxaComissao
taxas.valorBase
itens[].comissao.valor
```

Mas marketplace/payment podem precisar vir de outra integração, planilha ou configuração por loja/canal.

Até existir fonte melhor:

```txt
total_fees = taxaComissao + SUM(item.comissao.valor)
```

### 17.3. Impostos

Para relatório gerencial, pode-se usar:

```txt
total_taxes = vTotTrib
```

Mas para contribuição fiscal real, talvez seja melhor usar:

```txt
ICMS + IPI + PIS + COFINS + DIFAL + IBS + CBS
```

Essa decisão deve ser alinhada com o fiscal/contábil.

Recomendação técnica:

- salvar ambos;
- deixar claro no relatório qual métrica está sendo usada.

### 17.4. Pedidos sem NF-e

Pedido pode existir antes da emissão da NF-e.

Regra sugerida:

- entrar no relatório comercial usando dados do pedido;
- `has_invoice_data = false`;
- UF pode ficar nula ou vir do contato/endereço do pedido se disponível;
- impostos ficam 0 até a NF-e chegar;
- quando a NF-e/XML chegar, o job recalcula snapshots/facts.

### 17.5. Custo sem estoque

Se `stocks.quantity = 0` ou não existir estoque para produto/unidade:

1. usar `products.supplier_cost_price` como fallback;
2. marcar `cost_source = PRODUCT_SUPPLIER_COST`;
3. marcar `has_cost_fallback = true`;
4. expor isso no drill-down para auditoria.

## 18. Checklist final

Para o relatório funcionar corretamente, o sistema precisa ter:

- Produto sincronizado do ERP com `integration_id`, `source_system`, `external_id`, custo fornecedor, NCM, CEST, GTIN, marca e pesos.
- Estoque interno com `total_price` e `quantity` confiáveis.
- Cálculo de custo médio por produto/unidade.
- Pedido sincronizado com totais, loja, status, taxas, frete e itens.
- Item de pedido com produto mapeado e quantidade.
- NF-e sincronizada com UF, valor, frete, chave e XML.
- XML parseado e impostos salvos.
- Snapshot de pedido com custo, impostos, taxas, frete e contribuição congelados.
- Snapshot de item com custo médio congelado.
- Facts diárias por geral, estado, loja, produto e status.
- Job incremental com checkpoint e `ON CONFLICT DO UPDATE`.
- Drill-down para auditar pedido/item quando algum número não bater.
