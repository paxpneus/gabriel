import { Op, WhereOptions } from "sequelize";
import { QueryParams } from "../../../../../../../shared/query/query.types";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import invoiceReportsRepository, { InvoiceReportsRepository } from "../repositories/reports.repository";
import { FullInvoiceAttributes } from "../../invoice.types";
import InvoiceItems from "../../../invoice-items/invoice-items.model";
import supplierDiscountRuleService from "../../../../../../inventory/supplier-discount-rules/supplier-discount-rule.service";
import { SupplierDiscountBypassItemInput } from "../../../../../../inventory/supplier-discount-rules/supplier-discount-rule.types";
import { toScaled, formatScaled } from "../../../../../../../shared/utils/normalizers/decimal";
import { Product, ProductConfig } from "../../../../../../inventory";
import Contact from "../../../../../../sales/contacts/contacts.model";
import Order from "../../../../../../sales/orders/order/orders.model";
import { BLING_CANCELLED_SITUACAO_ID } from "../../../../../../sales/orders/order/helpers/eligible-for-pdv-filters";
import InvoiceUnitBusinessAttributes from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import userService from "../../../../../../company/users/users/user.service";
import Brand from "../../../../../../inventory/brands/brands.model";
import Rim from "../../../../../../inventory/rims/rim.model";
import TireMeasure from "../../../../../../inventory/tire-measures/tire-measure.model";
import { invoiceQueryConfig } from "../../shared";

// Relatórios de nota (produto, fornecedor e transferência) e o lookup de desconto de fornecedor por linha.
export class InvoiceReportsService extends BaseService<Invoice, InvoiceReportsRepository> {
  constructor() {
    super(invoiceReportsRepository);

    this.queryConfig = invoiceQueryConfig;
  }

  // Usado pelos relatórios (getInvoiceProductReport/getInvoiceSupplierReport)
  // pra trazer o desconto de fornecedor por linha. O snapshot
  // (SalesOrderItemSnapshot, sem repository/service próprio — ver nota em
  // invoice.repository.ts) é keyed por (order_id, product_id), não por
  // invoice_item_id, então a chave do lookup precisa ser essa mesma
  // combinação — quem chama monta a chave `${orderId}|${productId}` pra
  // consultar o Map devolvido.
  private async buildSupplierDiscountLookup(
    orderIds: (string | undefined)[],
  ): Promise<
    Map<
      string,
      { value: number; ruleId: string | null; ruleName: string | null }
    >
  > {
    const uniqueOrderIds = [
      ...new Set(orderIds.filter((id): id is string => !!id)),
    ];
    if (!uniqueOrderIds.length) return new Map();

    const discountRows =
      await this.repository.findSupplierDiscountsByOrderIds(uniqueOrderIds);

    const ruleIds = [
      ...new Set(
        discountRows
          .map((row) => row.supplier_discount_rule_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const rules = ruleIds.length
      ? await supplierDiscountRuleService.findManyDetailedByIds(ruleIds)
      : [];
    const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));

    // Uma venda por KIT é registrada em `sales_order_item_snapshots` com o
    // `product_id` do KIT, mas a nota fiscal emite o(s) produto(s)
    // COMPONENTE (a NF-e não tem "kit" como item, tem os pneus físicos) —
    // sem isso, nenhuma venda via kit encontraria seu desconto aqui, que é
    // o caso normal pra pneus (regras de desconto são tipicamente "a cada 2
    // pneus", vendidos como kit). Expande cada linha de kit pros ids dos
    // seus componentes, apontando pro mesmo valor/regra.
    const kitProductIds = [
      ...new Set(
        discountRows
          .map((row) => row.product_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const kitComponents = kitProductIds.length
      ? await this.repository.findKitComponentsByKitIds(kitProductIds)
      : [];
    const componentIdsByKitId = new Map<string, string[]>();
    for (const kc of kitComponents) {
      const arr = componentIdsByKitId.get(kc.product_kit_id) ?? [];
      arr.push(kc.product_component_id);
      componentIdsByKitId.set(kc.product_kit_id, arr);
    }

    const lookup = new Map<
      string,
      { value: number; ruleId: string | null; ruleName: string | null }
    >();
    for (const row of discountRows) {
      if (!row.product_id) continue;
      const entry = {
        value: Number(row.supplier_discount_value ?? 0),
        ruleId: row.supplier_discount_rule_id ?? null,
        ruleName: row.supplier_discount_rule_id
          ? (ruleNameById.get(row.supplier_discount_rule_id) ?? null)
          : null,
      };
      lookup.set(`${row.order_id}|${row.product_id}`, entry);
      for (const componentId of componentIdsByKitId.get(row.product_id) ?? []) {
        lookup.set(`${row.order_id}|${componentId}`, entry);
      }
    }
    return lookup;
  }

  // Relatório (sem paginação) das mesmas notas de `listTransferInvoices` —
  // mesmos filtros, mesma linha por nota.
  async getTransferInvoicesReport(
    params: QueryParams,
    unitBusinessId?: string,
  ): Promise<FullInvoiceAttributes[]> {
    return this.repository.findAllTransferInvoices(
      params,
      unitBusinessId,
      this.queryConfig,
    );
  }

  async getInvoiceProductReport(params: QueryParams, unitBusinessId: string) {
    // `supplier_discount` sai do `where` da query e vira filtro pós-fetch
    // (mais abaixo) — o customField padrão só bate no desconto REAL
    // (`sales_order_item_snapshots`), que excluiria de cara qualquer nota
    // que só se qualifica via o bypass "ignora unit_business" deste
    // relatório. Sem tirar daqui, uma nota fora do escopo de loja da regra
    // nunca chegaria a ser buscada pra o bypass sequer ter a chance de
    // calcular seu desconto.
    const rawSupplierDiscountFilter = params.filters?.supplier_discount;
    const supplierDiscountRuleIdsFilter = (
      Array.isArray(rawSupplierDiscountFilter)
        ? rawSupplierDiscountFilter
        : rawSupplierDiscountFilter
          ? [rawSupplierDiscountFilter]
          : []
    ).filter(Boolean);

    // Neste relatório `filters[brand]` são ids de `Brand` (não o texto legado do
    // customField `brand`); filtra no include do produto, então só sai linha de item da marca.
    const rawBrandFilter = params.filters?.brand;
    const brandIdsFilter = (
      Array.isArray(rawBrandFilter) ? rawBrandFilter : [rawBrandFilter]
    ).filter(Boolean);
    let productWhere: WhereOptions | undefined;
    if (brandIdsFilter.length > 0) {
      productWhere = { brand_id: { [Op.in]: brandIdsFilter } };
    }

    const {
      supplier_discount: _supplierDiscountFilter,
      brand: _brandFilter,
      ...restFilters
    } = params.filters ?? {};
    const queryParams: QueryParams = {
      ...params,
      filters: restFilters,
    };

    const fetchedRows = await this.findAll(
      {
        subQuery: false,
        attributes: [
          "id",
          "id_system",
          "destination_city",
          "receiver_name",
          "number_system",
          "seller_id",
          "invoice_value",
          // Só pro `total_products_value` do `summary`.
          "invoice_products_value",
          "emitted_at",
          "xml_key",
          "sender_name",
        ],
        include: [
          {
            model: InvoiceUnitBusinessAttributes,
            as: "unitBusinessAttributes",
            required: true,
            attributes: [],
            where: {
              unit_business_id: unitBusinessId,
              type: params.filters?.type ?? "OUTGOING",
              // Nota cancelada na loja do relatório não entra.
              status: { [Op.ne]: "CANCELLED" },
            },
          },
          {
            model: Contact,
            as: "seller",
            attributes: ["id", "name", "id_system"],
          },
          {
            model: InvoiceItems,
            as: "items",
            attributes: ["quantity_expected"],
            required: true,
            include: [
              {
                model: Product,
                as: "product",
                // `id` precisa estar explícito aqui — um include com
                // `attributes` explícito não traz a PK de graça (achado
                // testando o `supplier_discount_value`/nome da regra: sem
                // isso, `item.product.id` vinha `undefined` e a correlação
                // com o desconto nunca batia).
                attributes: ["id", "line"],
                where: productWhere,
                required: true,
                include: [
                  // SKU do produto na loja do relatório (Loja 21 = SKU do Bling).
                  {
                    model: ProductConfig,
                    as: "productConfigs",
                    attributes: ["sku"],
                    where: { unit_business_id: unitBusinessId },
                    required: false,
                  },
                  {
                    model: Brand,
                    as: "brandRegister",
                    required: false,
                  },
                  {
                    model: Rim,
                    as: "rimRegister",
                    required: false,
                  },
                  {
                    model: TireMeasure,
                    as: "measureRegister",
                    required: false,
                  },
                ],
              },
            ],
          },
          // Só pra permitir o customField `supplier_discount` filtrar por
          // `$order.unit_business_id$`/`$order.date$` — LEFT JOIN
          // inofensivo quando o filtro não está em uso, igual o de
          // `invoice.repository.ts`'s `listInvoices`.
          {
            model: Order,
            as: "order",
            attributes: ["id", "date", "unit_business_id", "actual_situation"],
          },
        ],
      },
      queryParams,
      this.queryConfig,
    );

    // Pedido cancelado no Bling (situação 12) tira a nota do relatório; nota sem pedido ou com qualquer outro status entra.
    // Pós-fetch porque o findAll com params sobrescreve o `where` (e condição no include só esconderia o pedido).
    const rows = fetchedRows.filter(
      (invoice) =>
        (invoice as Invoice & { order?: Order | null }).order?.actual_situation !==
        BLING_CANCELLED_SITUACAO_ID,
    );

    const supplierDiscountLookup = await this.buildSupplierDiscountLookup(
      rows.map(
        (invoice) => (invoice as Invoice & { order?: Order | null }).order?.id,
      ),
    );

    // Regra específica DESTE relatório, pedido explícito do usuário: mesmo
    // fora do escopo de unit_business da regra, ou sem Order vinculado (ou
    // com Order mas sem desconto real registrado), mostra o desconto que a
    // nota TERIA recebido — pool por NOTA (não por pedido), só regras REAL.
    // Dado só de leitura: não persiste nada, não afeta o motor real de
    // desconto/vendas. Só entra em jogo quando `supplierDiscountLookup`
    // (acima) não achou um valor > 0 pra esse item — nunca sobrescreve um
    // desconto real já encontrado. Ver
    // `supplierDiscountRuleService.resolveRealDiscountsIgnoringUnitBusiness`.
    const bypassItems: SupplierDiscountBypassItemInput[] = [];
    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        items?: (InvoiceItems & { product?: Product | null })[];
        order?: Order | null;
      };
      // Vigência da regra conta pela emissão da nota (pedido só se a nota não tiver data).
      const referenceDate =
        invoice.emitted_at ?? invoiceWithRelations.order?.date;
      if (!referenceDate) continue;

      for (const item of invoiceWithRelations.items ?? []) {
        if (!item.product?.id) continue;
        bypassItems.push({
          item_id: `${invoice.id}|${item.product.id}`,
          pool_id: invoice.id,
          brand_id: item.product.brandRegister?.id ?? null,
          rim_id: item.product.rimRegister?.id ?? null,
          measure_id: item.product.measureRegister?.id ?? null,
          reference_date: referenceDate,
          real_quantity: item.quantity_expected,
        });
      }
    }
    const supplierDiscountBypassLookup =
      await supplierDiscountRuleService.resolveRealDiscountsIgnoringUnitBusiness(
        bypassItems,
      );

    const default_report_seler = await userService.findOne({
      where: {
        name: "Rafael Minetto",
      },
    });

    const default_seller_body = {
      id: default_report_seler!.id,
      name: default_report_seler!.name,
      id_system: "",
    };

    const result: {
      number_system: string | undefined;
      xml_key: string | null;
      corporate_name: string | null;
      sku: string | null;
      seller: {
        id: string;
        name: string;
        id_system: string;
      } | null;
      customer: {
        name: string | null;
        city: string | null;
      };
      date: Date | null;
      measure: string | null;
      quantity: number;
      rim: string | null;
      line: string | null;
      brand: string | null;
      value: number | null;
      supplier_discount_value: number;
      supplier_discount_rule_name: string | null;
    }[] = [];
    // Notas com pelo menos uma linha no resultado (após os filtros pós-fetch), pros totais da nota no `summary`.
    const invoicesInResult = new Map<string, Invoice>();

    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        seller?: Contact | null;
        items?: (InvoiceItems & {
          product?: (Product & { productConfigs?: ProductConfig[] }) | null;
        })[];
        order?: Order | null;
      };

      const orderId = invoiceWithRelations.order?.id;

      for (const item of invoiceWithRelations.items ?? []) {
        const discount =
          orderId && item.product?.id
            ? supplierDiscountLookup.get(`${orderId}|${item.product.id}`)
            : undefined;
        const bypassDiscount = item.product?.id
          ? supplierDiscountBypassLookup.get(`${invoice.id}|${item.product.id}`)
          : undefined;
        // Só usa o bypass quando o lookup "real" não achou nada com valor
        // > 0 — nunca sobrescreve um desconto real já encontrado.
        const effectiveDiscount =
          discount && discount.value > 0 ? discount : bypassDiscount;

        // Filtro `supplier_discount` aplicado aqui (pós-fetch), não no
        // `where` da query — ver comentário no início do método. Com o
        // filtro ativo, só entra no resultado o item cujo desconto
        // efetivo (real OU bypass) veio de uma das regras selecionadas.
        if (
          supplierDiscountRuleIdsFilter.length > 0 &&
          !(
            effectiveDiscount?.ruleId &&
            supplierDiscountRuleIdsFilter.includes(effectiveDiscount.ruleId)
          )
        ) {
          continue;
        }

        invoicesInResult.set(invoice.id, invoice);
        result.push({
          number_system: invoice.number_system,
          xml_key: invoice.xml_key ?? null,
          // Razão social do emitente (ex.: PAX COMERCIO DE PNEUS LTDA).
          corporate_name: invoice.sender_name ?? null,
          sku: item.product?.productConfigs?.[0]?.sku ?? null,
          seller: invoiceWithRelations.seller
            ? {
                id: invoiceWithRelations.seller.id,
                name: invoiceWithRelations.seller.name,
                // contacts.id_system is optional (m344); keep the string contract of this response.
                id_system: invoiceWithRelations.seller.id_system ?? "",
              }
            : default_seller_body,
          customer: {
            name: invoice.receiver_name ?? null,
            city: invoice.destination_city ?? null,
          },
          date: invoice.emitted_at ?? null,
          measure: item.product?.measureRegister?.value ?? null,
          rim: item.product?.rimRegister?.value ?? null,
          quantity: item.quantity_expected,
          line: item.product?.line ?? null,
          brand: item.product?.brandRegister?.name ?? null,
          value: invoice.invoice_value ?? null,
          supplier_discount_value: effectiveDiscount?.value ?? 0,
          supplier_discount_rule_name: effectiveDiscount?.ruleName ?? null,
        });
      }
    }

    // Totais em memória, escala fixa pra não perder centavo. Valor da nota conta uma vez por nota e é o da nota
    // inteira (mesmo da coluna `value`), mesmo com filtro de marca; desconto = o exibido em cada linha (real ou bypass).
    const sumScaled = (values: (string | number | null | undefined)[]) =>
      values.reduce<bigint>((acc, value) => acc + (toScaled(value) ?? 0n), 0n);
    const toAmount = (scaled: bigint) => Number(formatScaled(scaled));
    const resultInvoices = [...invoicesInResult.values()];

    const summary = {
      invoices_count: resultInvoices.length,
      items_quantity: toAmount(sumScaled(result.map((row) => row.quantity))),
      total_invoice_value: toAmount(
        sumScaled(resultInvoices.map((invoice) => invoice.invoice_value)),
      ),
      total_products_value: toAmount(
        sumScaled(resultInvoices.map((invoice) => invoice.invoice_products_value)),
      ),
      total_supplier_discount: toAmount(
        sumScaled(result.map((row) => row.supplier_discount_value)),
      ),
    };

    return { rows: result, summary };
  }

  async getInvoiceSupplierReport(params: QueryParams, unitBusinessId: string) {
    const type = params.filters?.type ?? "OUTGOING";
    const rows = await this.findAll(
      {
        subQuery: false,
        attributes: [
          "id",
          "number_system",
          "emitted_at",
          "xml_key",
          // Só pro `total_products_value` do `summary`.
          "invoice_products_value",
        ],
        include: [
          {
            model: InvoiceUnitBusinessAttributes,
            as: "unitBusinessAttributes",
            required: true,
            attributes: [],
            where: {
              unit_business_id: unitBusinessId,
              type,
            },
          },
          {
            model: InvoiceItems,
            as: "items",
            attributes: ["quantity_expected"],
            required: true,
            include: [
              {
                model: Product,
                as: "product",
                // `id` explícito — sem isso `item.product.id` vem
                // `undefined` e a correlação com o desconto nunca bate
                // (mesmo achado de getInvoiceProductReport).
                attributes: ["id", "name", "brand"],
                required: true,
                include: [
                  {
                    model: ProductConfig,
                    as: "productConfigs",
                    attributes: ["sku"],
                    where: unitBusinessId
                      ? { unit_business_id: unitBusinessId }
                      : undefined,
                    required: false,
                  },
                ],
              },
            ],
          },
          // Só pra permitir o customField `supplier_discount` filtrar por
          // `$order.unit_business_id$`/`$order.date$` — LEFT JOIN
          // inofensivo quando o filtro não está em uso, igual o de
          // `invoice.repository.ts`'s `listInvoices`.
          {
            model: Order,
            as: "order",
            attributes: ["id", "date", "unit_business_id"],
          },
        ],
      },
      params,
      this.queryConfig,
    );

    const supplierDiscountLookup = await this.buildSupplierDiscountLookup(
      rows.map(
        (invoice) => (invoice as Invoice & { order?: Order | null }).order?.id,
      ),
    );

    const result: {
      number_system: string | undefined;
      date: Date | null;
      xml_key: string | null;
      sku: string | null;
      description: string | null;
      quantity: number;
      brand: string | null;
      supplier_discount_value: number;
      supplier_discount_rule_name: string | null;
    }[] = [];

    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        items?: (InvoiceItems & {
          product?:
            | (Product & {
                productConfigs?: ProductConfig[];
                brand?: string | null;
                source_payload?: { descricaoCurta?: string } | null;
              })
            | null;
        })[];
        order?: Order | null;
      };

      const orderId = invoiceWithRelations.order?.id;

      for (const item of invoiceWithRelations.items ?? []) {
        const product = item.product;
        const productConfig = product?.productConfigs?.[0];
        const discount =
          orderId && product?.id
            ? supplierDiscountLookup.get(`${orderId}|${product.id}`)
            : undefined;

        result.push({
          number_system: invoice.number_system,
          date: invoice.emitted_at ?? null,
          xml_key: invoice.xml_key ?? null,
          sku: productConfig?.sku ?? null,
          description: product?.name ?? "",
          quantity: item.quantity_expected,
          brand: product?.brand ?? null,
          supplier_discount_value: discount?.value ?? 0,
          supplier_discount_rule_name: discount?.ruleName ?? null,
        });
      }
    }

    // Totais somados em memória sobre as notas já buscadas (valor de produtos uma vez
    // por nota, quantidade por linha); escala fixa pra não perder centavo.
    const sumScaled = (values: (string | number | null | undefined)[]) =>
      values.reduce<bigint>((acc, value) => acc + (toScaled(value) ?? 0n), 0n);
    const toAmount = (scaled: bigint) => Number(formatScaled(scaled));

    const summary = {
      invoices_count: rows.length,
      items_quantity: toAmount(sumScaled(result.map((row) => row.quantity))),
      total_products_value: toAmount(
        sumScaled(rows.map((invoice) => invoice.invoice_products_value)),
      ),
    };

    return { rows: result, summary };
  }
}

export default new InvoiceReportsService();
