import { Op, WhereOptions } from "sequelize";
import { FullInvoiceAttributes } from "../../invoice.types";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { QueryParams, QueryConfig } from "../../../../../../../shared/query/query.types";
import { QueryParser } from "../../../../../../../shared/query/query.parser";
import SalesOrderItemSnapshot from "../../../../../../reports/daily-sales/sales-order-item-snapshot/sales-order-item-snapshot.model";
import KitComponent from "../../../../../../inventory/kit-components/kit-component.model";
import {
  buildTransferInvoiceQueryOptions,
  mapListedInvoice,
  withUnitBusinessNames,
  invoiceAttributesRepository,
  notInternalInvoiceWhere,
} from "../../shared";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";

// Queries dos relatórios de nota: desconto de fornecedor por pedido, componentes de kit e notas de transferência sem paginação.
export class InvoiceReportsRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  // `SalesOrderItemSnapshot` não tem repository/service próprio (mesma
  // situação de `InvoiceFiscalItem` — ver nota em invoice.service.ts),
  // então é consultado direto daqui. Usado pelos relatórios
  // (getInvoiceProductReport/getInvoiceSupplierReport) pra trazer o
  // desconto de fornecedor por linha: o snapshot é keyed por
  // (order_id, product_id), não por invoice_item_id, então quem chama
  // precisa casar cada item pelo par (invoice.order.id, item.product_id).
  async findSupplierDiscountsByOrderIds(
    orderIds: string[],
  ): Promise<
    Pick<
      InstanceType<typeof SalesOrderItemSnapshot>,
      | "order_id"
      | "product_id"
      | "supplier_discount_value"
      | "supplier_discount_rule_id"
    >[]
  > {
    if (!orderIds.length) return [];
    return SalesOrderItemSnapshot.findAll({
      where: { order_id: { [Op.in]: orderIds } },
      attributes: [
        "order_id",
        "product_id",
        "supplier_discount_value",
        "supplier_discount_rule_id",
      ],
      raw: true,
    });
  }

  // Uma venda por KIT vira, na nota fiscal, um item por produto COMPONENTE
  // (a NF-e não emite o "kit" abstrato, emite os pneus físicos) — mas
  // `sales_order_item_snapshots.product_id` continua sendo o produto KIT
  // vendido no pedido. Sem isso, `findSupplierDiscountsByOrderIds` nunca
  // bate com `invoice_items.product_id` pra vendas via kit (o caso normal
  // pra pneus, dado "a cada 2 pneus"). Usado por
  // `InvoiceService.buildSupplierDiscountLookup` pra expandir cada snapshot
  // de KIT pros ids dos seus componentes.
  async findKitComponentsByKitIds(
    kitProductIds: string[],
  ): Promise<
    Pick<
      InstanceType<typeof KitComponent>,
      "product_kit_id" | "product_component_id"
    >[]
  > {
    if (!kitProductIds.length) return [];
    return KitComponent.findAll({
      where: { product_kit_id: { [Op.in]: kitProductIds } },
      attributes: ["product_kit_id", "product_component_id"],
      raw: true,
    });
  }

  // Relatório de notas de transferência: mesmos filtros/inclusões/mapeamento
  // de `listTransferInvoices`, mas sem paginação — devolve de uma vez tudo
  // que bate no filtro (pensado pra exportação). `findPaginated`/`findAll`
  // do `BaseRepository` não servem aqui: o primeiro sempre limita por
  // page/perPage, o segundo (`this.findAll`) sobrescreve `where` com só o
  // resolvido pelo QueryParser, sem como combinar com o `forcedWhere` de CNPJ
  // — por isso monta a query direto contra o model, do mesmo jeito que
  // `findPaginated` monta (resolved.where + forcedWhere via `Op.and`).
  async findAllTransferInvoices(
    params: QueryParams,
    unitBusinessId: string | undefined,
    queryConfig: QueryConfig = {},
  ): Promise<FullInvoiceAttributes[]> {
    const [unitBusinessNames, internalOperationId] = await Promise.all([
      invoiceAttributesRepository.findUnitBusinessNamesByCnpj(),
      invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER),
    ]);

    const unitBusinessCnpjs = [...unitBusinessNames.keys()];
    const { extraOptions, forcedWhere } = buildTransferInvoiceQueryOptions(
      params,
      unitBusinessId,
    );

    // Mesmo recorte do listTransferInvoices: sem nota interna.
    const combinedForcedWhere: WhereOptions = {
      ...forcedWhere,
      sender_cnpj: { [Op.in]: unitBusinessCnpjs },
      receiver_cnpj: { [Op.in]: unitBusinessCnpjs },
      ...notInternalInvoiceWhere(internalOperationId),
    };

    const resolved = QueryParser.parse(params, queryConfig);
    const where = resolved.where
      ? { [Op.and]: [resolved.where, combinedForcedWhere] }
      : combinedForcedWhere;

    const rows = await this.model.findAll({
      ...extraOptions,
      where,
      order: resolved.order,
    });

    return withUnitBusinessNames(rows.map((invoice) => mapListedInvoice(invoice)), unitBusinessNames);
  }
}

export default new InvoiceReportsRepository();
