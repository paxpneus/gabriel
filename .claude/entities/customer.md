# Customer (`customers`)

- Campos: `name`, `type` ENUM('F','J') NOT NULL, `document` STRING(14) UNIQUE nullable. `orders.customer_id` é NOT NULL → todo pedido Bling precisa resolver um customer.
- Origem: `BlingCustomerService` (`handlers/bling/services/bling-customers/`), chamado no create (`getOrCreateCustomer`) e update (`updateCustomer`) de pedido Bling.
- Bling pode mandar `contato.tipoPessoa: ""` e `numeroDocumento: ""` (ex.: pedido ML cancelado por "Documento não informado ou inválido"):
  - `type` vazio → inferido do documento (14 dígitos = `J`, senão `F`). Antes ia `""` direto pro enum e o job falhava.
  - documento vazio → grava `null` (não `""`, que pela UNIQUE juntaria todos os sem-documento numa linha só) e o lookup cai pra `document IS NULL AND name = contato.nome` (nome = nickname ML).
- Downstream: `cnpj.queue` já trata `customer.document` vazio/null.
