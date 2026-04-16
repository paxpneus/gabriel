import {
  BlingAction,
  BlingInvoicePayload,
  BlingProductPayload,
  BlingProductSupplierPayload,
  BlingResource,
  BlingStockPayload,
  BlingWebhookEnvelope,
  DirectUpsertPayload,
  MappedWebhookResult,
} from "./bling-webhook.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEvent(
  event: string,
): { resource: BlingResource; action: BlingAction } | null {
  const [resource, action] = event.split(".");
  const validResources: BlingResource[] = [
    "order",
    "product",
    "stock",
    "virtual_stock",
    "invoice",
    "consumer_invoice",
    "product_supplier",
  ];
  const validActions: BlingAction[] = ["created", "updated", "deleted"];

  if (!validResources.includes(resource as BlingResource)) return null;
  if (!validActions.includes(action as BlingAction)) return null;

  return { resource: resource as BlingResource, action: action as BlingAction };
}

/**
 * Mapeia a situação Bling (número) para o status interno de Invoice.
 * Situações Bling NF-e: 1 = Em digitação / 6 = Autorizada / 2 = Cancelada etc.
 * Ajuste conforme o enum real da Bling se necessário.
 */
function mapInvoiceSituacao(
  situacao?: number,
): "OPEN" | "PENDING" | "FINISHED" | "CANCELLED" {
  switch (situacao) {
    case 3: // Cancelada
      return "CANCELLED";
      case 5: // Rejeitada
      return "CANCELLED";
    default:
      return "OPEN";
  }
}

/**
 * Inferência simplificada de tipo de NF.
 * tipo 1 = entrada (INCOMING), tipo 2 = saída (OUTGOING).
 */
function mapInvoiceType(tipo?: number): "INCOMING" | "OUTGOING" {
  return tipo === 1 ? "INCOMING" : "OUTGOING";
}

// ─── Resource mappers ─────────────────────────────────────────────────────────

function mapProduct(
  action: BlingAction,
  data: BlingProductPayload,
): MappedWebhookResult {
  if (action === "deleted") {
    return {
      directUpsert: { table: "delete", resource: "product", blingId: data.id },
    };
  }

  // O webhook de produto NÃO traz EAN → precisa buscar na API Bling
  return {
    directUpsert: {
      table: "products",
      data: {
        blingId: data.id,
        name: data.nome ?? "",
        sku: data.codigo ?? "",
        // ean será preenchido pelo worker que consome a fila de API fetch
      },
    },
    requiresApiFetch: {
      resource: "product",
      blingId: data.id,
      action,
      companyId: "", // preenchido pelo orquestrador
    },
  };
}

function mapStock(
  action: BlingAction,
  data: BlingStockPayload,
): MappedWebhookResult {
  if (action === "deleted") {
    // No delete de lançamento de estoque usamos saldoFisicoTotal já informado
    return {
      directUpsert: {
        table: "stocks",
        data: {
          productBlingId: data.produto.id,
          quantity: data.saldoFisicoTotal ?? 0,
        },
      },
    };
  }

  // created / updated → usa saldoFisicoTotal do deposito
  return {
    directUpsert: {
      table: "stocks",
      data: {
        productBlingId: data.produto.id,
        // saldo físico total do depósito; unit_business_id será resolvido
        // pelo worker via depósito → empresa → unit_business
        quantity: data.deposito?.saldoFisico ?? data.saldoFisicoTotal ?? 0,
      },
    },
  };
}

function mapInvoice(
  resource: "invoice" | "consumer_invoice",
  action: BlingAction,
  data: BlingInvoicePayload,
): MappedWebhookResult {
  if (action === "deleted") {
    return {
      directUpsert: { table: "delete", resource, blingId: data.id },
    };
  }

  // O webhook não traz dados suficientes para preencher a Invoice completa
  // (faltam: customer_name, customer_document, key, sender/receiver, xml_path...)
  // → sempre busca na API Bling
  return {
    requiresApiFetch: {
      resource,
      blingId: data.id,
      action,
      companyId: "", // preenchido pelo orquestrador
      partialData: {
        blingId: data.id,
        id_system: String(data.id),
        type: 'OUTGOING',
        status: mapInvoiceSituacao(data.situacao),
      },
    },
  };
}

function mapProductSupplier(
  action: BlingAction,
  data: BlingProductSupplierPayload,
): MappedWebhookResult {
  if (action === "deleted") {
    return {
      directUpsert: {
        table: "delete",
        resource: "product_supplier",
        blingId: data.id,
      },
    };
  }

  if (!data.produto?.id || !data.fornecedor?.id) {
    // Sem produto ou fornecedor no payload → busca na API
    return {
      requiresApiFetch: {
        resource: "product_supplier",
        blingId: data.id,
        action,
        companyId: "",
      },
    };
  }

  return {
    directUpsert: {
      table: "product_supplier_maps",
      data: {
        productBlingId: data.produto.id,
        supplierBlingId: data.fornecedor.id,
        supplier_product_code: data.codigo ?? "",
      },
    },
    // Precisa do CNPJ do fornecedor → busca via API
    requiresApiFetch: {
      resource: "product_supplier",
      blingId: data.id,
      action,
      companyId: "",
    },
  };
}

// ─── Main mapper ──────────────────────────────────────────────────────────────

/**
 * Recebe o envelope bruto do webhook Bling e retorna o resultado mapeado.
 * Retorna null se o evento for ignorado (order → tratado pela fila existente,
 * virtual_stock → sem ação direta necessária além do stock).
 */
export function mapBlingWebhook(
  envelope: BlingWebhookEnvelope,
): MappedWebhookResult | null {
  const parsed = parseEvent(envelope.event);
  if (!parsed) return null;

  const { resource, action } = parsed;
  const data = envelope.data as any;

  switch (resource) {
    case "order":
      // Pedidos já possuem fila dedicada (BlingOrderQueue)
      return null;

    case "virtual_stock":
      // virtual_stock é derivado do stock; ativado automaticamente pelo Bling
      // quando stock é habilitado. Sem ação direta — o worker de stock já trata.
      return null;

    case "product":
      return mapProduct(action, data as BlingProductPayload);

    case "stock":
      return mapStock(action, data as BlingStockPayload);

    case "invoice":
    case "consumer_invoice":
      return mapInvoice(resource, action, data as BlingInvoicePayload);

    case "product_supplier":
      return mapProductSupplier(action, data as BlingProductSupplierPayload);

    default:
      return null;
  }
}

export { parseEvent };
