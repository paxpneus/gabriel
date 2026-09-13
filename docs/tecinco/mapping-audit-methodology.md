# Metodologia — Auditoria de mapeamento local x catálogo de parceiro (Tecinco)

Guia de como reproduzir a auditoria completa de correspondência física entre
`products` (autointegration_node) e o catálogo de um parceiro de integração
(feita para Tecinco via `epctb_codigo`, mas o método se aplica a qualquer
integração que exponha um dump de catálogo com nome + id externo). Este
documento descreve o **processo**, não o resultado de uma rodada específica
— para o resultado da última rodada, ver o `.csv`/artefato gerado junto com
ela.

## Quando usar isso

Sempre que for preciso confirmar se cada produto local vinculado a um
catálogo externo (`integration_mappings`) é, de fato, o mesmo pneu
fisicamente — e corrigir os vínculos que não são. Situações típicas: dúvida
sobre a qualidade de um mapeamento em massa antigo, ou depois de uma mudança
grande no catálogo do parceiro.

## Passo 1 — Extrair os dados

**Mapeamentos já existentes** (join local x external_id):

```sql
SELECT p.id AS local_id, p.name AS local_name, p.type AS local_type,
       im.external_id
FROM integration_mappings im
JOIN products p ON p.id::text = im.internal_id
WHERE im.entity_type = 'PRODUCT'
  AND im.integrations_id = (SELECT id FROM integrations WHERE name = 'Tecinco');
```

**Catálogo completo do parceiro**: usar o dump já existente
(`src/scripts/tecinco/output/tecinco-catalog.json`, gerado por
`src/scripts/tecinco/dump-tecinco-catalog.ts`) ou gerar um novo. Cada item
tem `id_sistema` (= `external_id`), `nome`, `sku`, `coded`, `ean`, `grupo`,
`subgrupo`, `marca`. **Não confie no campo `marca` do catálogo** — já foi
confirmado incorreto em casos reais (ex. pneu General Tire listado com
`marca=Continental`); a marca deve ser lida do texto de `nome`.

**Catálogo local inteiro** (não só o que já está mapeado — necessário para
a busca de melhor correspondência no Passo 4):

```sql
SELECT id, name, type FROM products;
```

`type` distingue `UNIT` (pneu vendido individualmente) de `KIT` (pacote,
ex. "Kit 2 Pneus..."). Guarde essa coluna — ela é usada como filtro no
Passo 4.

## Passo 2 — Classificar cada par (local x parceiro)

Para cada linha do join do Passo 1, comparar o nome local com o nome do
parceiro e classificar em um dos 4 níveis:

- **OK** — mesmo pneu, nomes equivalentes ou com diferenças cosméticas.
- **ALERTA LEVE** — equivalente, mas com uma diferença que vale registrar
  (ex. abreviação incomum, mas ainda a mesma peça).
- **ALERTA CRÍTICO** — indício forte de pneu diferente, mas não 100% certo
  sem checar o catálogo/banco.
- **ERRO** — claramente pneus diferentes (medida, marca ou modelo
  incompatíveis).

**Regra central de comparação — usar raciocínio direto, nunca script de
similaridade textual.** Comparar cada par lendo e julgando tecnicamente,
não com jaccard/distância de edição/score de similaridade — esse tipo de
métrica confunde sistematicamente "pneu diferente" com "mesmo pneu escrito
diferente" (o inverso também acontece: dois nomes com alta similaridade de
texto podem ser produtos diferentes). Extração determinística de campos
específicos (medida, índice, presença de Run Flat) por regex é aceitável
como apoio mecânico — o que é proibido é usar uma métrica de similaridade
de texto para decidir "é o mesmo pneu".

### O que NÃO conta como divergência (é o mesmo pneu — Status OK/ALERTA LEVE)

- Erro de digitação leve (ex. `ENRGRIP` vs `ENERGRIP`).
- Palavras fora de ordem no nome.
- Omissão do nome de uma montadora/veículo de um dos lados (`Smart`, `Ford`,
  `VW`, ou o rótulo genérico `OE`).
- Abreviação plausível do catálogo do parceiro para o mesmo modelo (ex.
  `CPC2` = ContiPremiumContact 2 — confirme contra o padrão de nomenclatura
  do parceiro antes de aceitar uma abreviação como plausível).
- **Sufixo que parece variante de geração, mas nenhum dos dois catálogos o
  usa de forma consistente.** Antes de aceitar "é só abreviação/variação
  de nome" para um sufixo tipo letra (ex. `Bravuris 5` vs `Bravuris 5HM`),
  **não assuma — verifique**: liste todas as medidas dessa linha de
  produto nos dois catálogos (parceiro inteiro e banco local inteiro, não
  só os pares já mapeados) e confira (1) se em alguma medida as duas
  variantes aparecem como dois cadastros concorrentes ao mesmo tempo (se
  sim, é uma distinção real, tipo `SportContact 5` vs `5P` — os dois lados
  oferecem ambas as opções lado a lado) e (2) se cada catálogo usa a
  sigla de forma consistente dentro de si mesmo. Se nenhuma medida tem as
  duas variantes concorrendo, e cada catálogo alterna entre as duas
  grafias de forma aparentemente arbitrária (não é o parceiro que sempre
  usa uma forma e o local que sempre usa outra — os dois flutuam), é
  inconsistência de nomenclatura, não produto físico diferente — trate
  como o mesmo produto. Essa checagem é o que diferencia com segurança um
  caso tipo Bravuris 5/5HM (mesmo produto, nomenclatura inconsistente nos
  dois catálogos) de um caso tipo SportContact 5/5P (produtos realmente
  diferentes, oferecidos lado a lado) — os dois *parecem* idênticos à
  primeira vista (sufixo de uma letra/duas letras no nome do modelo).
- `LRE` (Load Range E) de um lado e `LT` do outro — ambos indicam a mesma
  classe de construção reforçada; não é omissão unilateral.
- **Sigla `LT` ausente de um lado, mas comprovada pelo índice de carga
  duplo.** Se um lado tem `LT` na medida (ex. `205/70R15LT`) e o outro não
  (`205/70R15`), mas os dois têm o **mesmo índice de carga duplo** (ex.
  `96/93S`), o índice duplo já prova a carcaça reforçada — índice duplo só
  existe em pneu com essa capacidade de montagem; `LT` é redundante com
  ele, não uma informação adicional que só um dos lados capturou. O mesmo
  vale, mesmo sem índice duplo, quando a medida está em **notação de
  flutuação** (ex. `31X10.50R15`) — essa notação só é usada para pneu
  Light Truck/off-road, então `LT` já está implícito na própria forma de
  escrever a medida. Confirme índice (duplo ou, no caso de flutuação, o
  índice simples) idêntico nos dois lados antes de aplicar esta isenção —
  ela não dispensa checar o resto da especificação.

### O que SEMPRE conta como divergência física real (Status ALERTA CRÍTICO/ERRO)

- Índice de carga e/ou velocidade diferente (`94T` vs `96T`, `91Y` vs
  `91W`) — mesmo quando é só uma letra ou um dígito.
- Letra de carga comercial / construção diferente (`205/70R15` vs
  `205/70R15C`) — **cheque esse critério isoladamente em todo o dataset**,
  não só nos itens que já pareciam suspeitos por outro motivo; ele pode
  passar despercebido quando todo o resto do nome bate.
- Geração/variante de desenho de banda diferente (`SportContact 5` vs
  `5P`; `EcoContact 6` vs `6Q`).
- Run Flat presente em só um dos lados (`SSR`/`RFT`/`ROF`/`ZP`).
- Código de homologação formal diferente (`MO` vs `AO` vs `N0` vs `MO1`) —
  isso é diferente de omissão genérica de veículo; são aprovações técnicas
  distintas da montadora.
- Marca ou linha de produto (modelo) realmente diferentes.

## Passo 3 — Para cada ALERTA CRÍTICO/ERRO: buscar a melhor correspondência real

Não repita o mesmo produto local já vinculado como a resposta — **busque em
todo o catálogo local** (Passo 1, catálogo local inteiro) por um cadastro
tecnicamente idêntico: mesma medida/aro, marca, geração/desenho de banda e
índices exatos.

- **Filtre por `type = 'UNIT'` — nunca sugira um produto `type = 'KIT'`**,
  mesmo que seja a única correspondência exata na medida/construção/índice.
  Um kit é uma unidade de venda em par/pacote, não o produto individual que
  a integração espera mapear.
- Se encontrar um cadastro `UNIT` local tecnicamente idêntico → ação
  `Mudar Mapeamento`, apontando pra esse `ID Local`. Se esse `ID Local` já
  estiver vinculado a outro `external_id`, sinalize o conflito
  explicitamente (múltiplos `external_id` para o mesmo produto físico são
  normais em catálogos de parceiro como a Tecinco — não é
  necessariamente um erro, mas precisa aparecer na justificativa).
- Se não encontrar nenhum cadastro `UNIT` local com a especificação exata
  → ação `Cadastrar Novo Produto`.

### Regra crítica — nunca "Manter Mapeamento Atual" para divergência real

Depois de confirmada uma divergência física real (Passo 2), é **proibido**
concluir "Manter Mapeamento Atual" com a justificativa de "não há opção
melhor no banco, mantido e sinalizado". Essa combinação (divergência real +
manter porque não tem pra onde trocar) é sempre um erro de análise — a
divergência real já provou que o vínculo atual está errado; "não ter opção
melhor" só decide *qual das duas ações* tomar (`Mudar Mapeamento` ou
`Cadastrar Novo Produto`), nunca justifica manter um vínculo sabidamente
incorreto. Isso foi um erro real cometido numa rodada desta análise (ver
exemplo abaixo) e corrigido depois.

**Exemplo real do erro e da correção**: um produto local "Barum Bravuris
4x4 205/70R15 94T" estava mapeado a um item Tecinco "BRAVURIS 4X4
205/70R15 96T" — divergência real de índice de carga (94T vs 96T). A
análise inicial concluiu "Manter Mapeamento Atual" porque não havia
nenhum "Bravuris 4x4 96T" no banco local para trocar. Isso está errado: ao
reconsultar o banco, existe sim um "96T" no mesmo tamanho, mas é um modelo
diferente ("Bravuris **AT**", não "Bravuris **4x4**") — ou seja, mesmo
existindo *um* produto 96T, ele não é tecnicamente equivalente (linha de
produto diferente), então a ação correta é `Cadastrar Novo Produto`, nunca
manter o vínculo com o 94T.

## Passo 4 — Reaplicar critérios isolados a TODO o dataset, não só ao subconjunto já sinalizado

Um critério de divergência introduzido ou refinado depois da primeira
passada (ex. a letra de carga comercial C/LT) pode não ter sido checado
isoladamente nos itens que já pareciam OK por outros motivos — refaça a
checagem desse critério específico em **todos** os pares, não só nos que já
estavam sinalizados. Foi assim que se descobriram, numa rodada desta
análise, 21 casos novos que antes constavam como OK.

## Passo 5 — Consolidar e produzir a tabela final

Formato de saída (8 colunas), um CSV com todos os pares e, separadamente,
um CSV só com os que mudaram de ação:

`ID Local Atual | External ID | Nome Sistema Local | Nome Tecinco Catalog | Novo Status | Sugestão de Ação | ID Local Sugerido | Nome do Produto Sugerido | Justificativa / Alerta de Conflito`

- **Sempre inclua o nome do produto sugerido, não só o ID** — quem revisa a
  planilha precisa reconhecer o produto sem abrir o banco.
- Casos sistêmicos (o mesmo padrão de divergência repetido em várias linhas,
  ex. uma linha inteira de pneus onde o sistema local nunca registra "LT")
  merecem uma nota explícita na justificativa dizendo que é provavelmente
  uma convenção de nomenclatura, não N produtos física e independentemente
  ausentes — isso muda a decisão de negócio (corrigir a convenção vs.
  cadastrar N produtos novos) e não deve ficar escondido em N linhas
  repetidas sem contexto.

## Passo 6 (opcional) — Publicar como artefato interativo

Para uma planilha grande (centenas/milhares de linhas), publicar um
artefato HTML com cards (não tabela de colunas — quebra mal em telas
estreitas e some informação): cada card mostra local ⇄ parceiro lado a
lado, badges de status/ação, e a justificativa por extenso. Incluir filtro
por nível/ação e paginação. Um rodapé de metodologia no próprio artefato,
resumindo as regras acima e citando os números da rodada, ajuda quem abre o
link sem contexto da conversa.

## Erros já cometidos nesta análise (não repetir)

- Tratar `SportContact 5` e `SportContact 5P` (ou qualquer outra letra de
  variante de geração) como a mesma coisa por "quase bater" — geração
  diferente é sempre divergência real, mesmo que o resto do nome seja
  idêntico.
- Confiar no campo estruturado `marca` do dump do parceiro em vez do texto
  do nome — já confirmado inconsistente em casos reais.
- Marcar como divergência a mesma medida escrita com/sem zero à direita
  (ex. `35X12.50` vs `35X12.5`) — é formatação, não divergência física;
  não deixe esse tipo de regex de extração gerar falso positivo.
- Sugerir um produto `type = 'KIT'` como correspondência — mesmo sendo
  exato na medida/construção/índice, não é um candidato válido.
- Concluir "Manter Mapeamento Atual" para uma divergência física real só
  porque não existe opção melhor (ver Passo 3) — a ação correta nesse caso
  é sempre `Cadastrar Novo Produto`.
- Tratar a sigla `LT` ausente de um lado como divergência sem checar se o
  índice de carga duplo (ou a notação de flutuação da medida) já a
  comprova — isso gerou 16 casos reais marcados incorretamente como
  `Cadastrar Novo Produto` numa rodada desta análise (linha Speedmax
  Pangea/SPM101; ver isenção correspondente no Passo 2). O padrão
  sistêmico da linha já tinha sido notado nessa rodada, mas a ação não foi
  corrigida mesmo assim — notar o padrão sistêmico não substitui aplicar a
  isenção.
- Aceitar "é só abreviação" para um sufixo de geração (ex. `5` vs `5HM`)
  sem verificar contra o catálogo inteiro dos dois lados (ver isenção
  correspondente no Passo 2) — o veredito pode até sair certo por sorte,
  mas sem essa checagem não há como distinguir esse caso de um
  `SportContact 5` vs `5P`, que é o tipo de erro oposto (aceitar como
  igual algo que é realmente diferente).
