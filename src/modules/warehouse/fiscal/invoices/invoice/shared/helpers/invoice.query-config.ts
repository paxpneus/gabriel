import { Op, Sequelize } from "sequelize";
import { QueryConfig } from "../../../../../../../shared/query/query.types";
import sequelize from "../../../../../../../config/sequelize";
import { BLING_CANCELLED_SITUACAO_ID } from "../../../../../../sales/orders/order/helpers/eligible-for-pdv-filters";
import {
  pendingMercadoLivreWhere,
  allTodayMercadoLivreWhere,
  finishedMercadoLivreWhere,
  dispatchedMercadoLivreWhere,
  productRimWhere,
  productBrandWhere,
  supplierDiscountMatchWhere,
  pendingCancellationWhere,
} from "./custom-filters";
import { deliveryNoteGeneratedWhere } from "./delivery-note";

// Config de query (filtros/ordenação/busca) da listagem de notas, compartilhada por core e reports.
export const invoiceQueryConfig: QueryConfig = {
  stringFields: ["receiver_cnpj", "sender_cnpj", "customer_document"],
  defaults: {
    perPage: 20,
    sortBy: ["number_system"],
    sortDir: ["ASC", "ASC"],
  },
  // Campos para busca textual (LIKE)
  searchFields: ["customer_name", "sender_name", "number_system"],
  // Campos permitidos para filtros exatos (WHERE field = value)
  // ADICIONADO: 'type' e 'customer_name' aqui
  filterableFields: [
    "transporter_id",
    "receiver_cnpj",
    "receiver_name",
    "sender_name",
    "sender_cnpj",
    "printed_label",
    "emitted_at",
    "store_id",
    "supplier_id",
  ],
  sortableFields: [
    "customer_name",
    "createdAt",
    "emitted_at",
    "received_at",
    "expected_receiving",

    "printed_label",

    "number_system",
  ],
  customSort: {
    status: (dir) => ["unitBusinessAttributes", "status", dir],
    type: (dir) => ["unitBusinessAttributes", "type", dir],
    batch_generated: (dir) => [
      "unitBusinessAttributes",
      "batch_generated",
      dir,
    ],
  },
  customFields: {
    // Marca vem do request — escapada pelo Sequelize, nunca interpolada crua.
    brand: (value) => ({
      [Op.and]: [
        Sequelize.literal(`EXISTS (
  SELECT 1
  FROM invoice_items ii
  JOIN products p ON p.id = ii.product_id
  WHERE ii.invoice_id = "Invoice"."id"
    AND p.brand ${
      Array.isArray(value)
        ? `IN (${value.map((v: string) => sequelize.escape(v)).join(", ")})`
        : `= ${sequelize.escape(String(value))}`
    }
)`),
      ],
    }),
    batchStatus: (value) => ({
      "$batchInvoice.batch.status$": Array.isArray(value)
        ? { [Op.in]: value }
        : value,
    }),
    processStatus: (value) => {
      // Status do processo — "Todos" (sem filtro) se valor vazio/desconhecido
      if (value === "pendingProcess") {
        // Nota ainda não chegou num estado terminal
        return {
          status: { [Op.notIn]: ["FINISHED", "CANCELLED"] },
        };
      }

      if (value === "finishedProcess") {
        // Tudo concluído
        return {
          batch_generated: true,
          status: { [Op.in]: ["FINISHED", "CANCELLED"] },
        };
      }

      if (value === "notStartedProcess") {
        // Processo ainda não iniciado: status inicial e lote não gerado
        return {
          status: { [Op.in]: ["OPEN", "PENDING"] },
          batch_generated: false,
        };
      }

      return {};
    },
    status: (value) => ({
      "$unitBusinessAttributes.status$": Array.isArray(value)
        ? { [Op.in]: value }
        : value,
    }),

    type: (value) => ({
      "$unitBusinessAttributes.type$": Array.isArray(value)
        ? { [Op.in]: value }
        : value,
    }),

    batch_generated: (value) => ({
      "$unitBusinessAttributes.batch_generated$": value === "true",
    }),

    // Marcado por `getDanfeBatch` na unit business resolvida.
    danfe_printed: (value) => ({
      "$unitBusinessAttributes.danfe_printed$":
        (Array.isArray(value) ? value[0] : value) === "true",
    }),

    unit_business_id: (value) => ({
      "$unitBusinessAttributes.unit_business_id$": Array.isArray(value)
        ? { [Op.in]: value }
        : value,
    }),

    // Romaneio gerado em qualquer ponta da transferência (remetente OU
    // destinatária) — ver `helpers/delivery-note.ts`.
    delivery_note_generated: (value) =>
      deliveryNoteGeneratedWhere(
        (Array.isArray(value) ? value[0] : value) === "true",
      ),

    // Fila de embarque Mercado Livre: 4 abas mutuamente exclusivas da
    // mesma tela ("o que precisa/já foi embarcado hoje"). Todas exigem
    // loja MercadoLivre + pedido (`order`, via Invoice.hasOne) — "hoje"
    // aqui não é só `collection_date` de hoje: uma nota já emitida
    // (antes do horário-limite de embarque) ou com lote finalizado hoje
    // também conta, mesmo com `collection_date` num dia futuro. Ver
    // `helpers/custom-filters.ts` pra definição completa de cada uma.
    pending_mercado_livre: (value) =>
      value === "true" ? pendingMercadoLivreWhere("MercadoLivre") : {},

    all_today_mercado_livre: (value) =>
      value === "true" ? allTodayMercadoLivreWhere("MercadoLivre") : {},

    finished_mercado_livre: (value) =>
      value === "true" ? finishedMercadoLivreWhere("MercadoLivre") : {},

    dispatched_mercado_livre: (value) =>
      value === "true" ? dispatchedMercadoLivreWhere("MercadoLivre") : {},

    // Card "Pendente Cancelamentos" do resumo de pedidos: pedido cancelado, nota não.
    pending_cancellation: (value) =>
      value === "true" ? pendingCancellationWhere() : {},

    // Notas com algum item cujo produto tem um dos aros informados —
    // aceita um id só ou array (qualquer um dos aros, não todos).
    rim: (value) =>
      productRimWhere(
        (Array.isArray(value) ? value : [value]).filter(Boolean),
      ),

    // Notas com algum item cujo produto tem uma das marcas (`Brand`) informadas —
    // por id; o `brand` acima compara o texto legado `products.brand`.
    brand_id: (value) =>
      productBrandWhere(
        (Array.isArray(value) ? value : [value]).filter(Boolean),
      ),

    // Notas com algum item que REALMENTE recebeu o desconto de uma das
    // regras informadas (não só "se encaixaria no escopo dela") — ver
    // `supplierDiscountMatchWhere` pra detalhe.
    supplier_discount: (value) =>
      supplierDiscountMatchWhere(
        (Array.isArray(value) ? value : [value]).filter(Boolean),
      ),
  },
};
