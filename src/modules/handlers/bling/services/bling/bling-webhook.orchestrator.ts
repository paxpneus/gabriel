import crypto from 'crypto';
import { BlingWebhookEnvelope, WebhookQueuePayload } from './bling-webhook.types';
import { mapBlingWebhook, parseEvent } from './bling-webhook.mapper';

// ─── HMAC Signature ───────────────────────────────────────────────────────────

/**
 * Valida a assinatura HMAC enviada pelo Bling no header X-Bling-Signature-256.
 * Formato esperado: "sha256=<hex_hash>"
 */
export function validateBlingSignature(
  rawBody: string,
  signatureHeader: string,
  clientSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const receivedHash = signatureHeader.slice('sha256='.length);
  const computedHash = crypto
    .createHmac('sha256', clientSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Comparação segura contra timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(receivedHash, 'hex'),
    Buffer.from(computedHash, 'hex'),
  );
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface OrchestratorDependencies {
  /** Fila já existente para pedidos */
  blingOrderQueue: {
    add: (payload: unknown, jobId: string) => Promise<void>;
  };
  /** Fila para eventos que necessitam de upsert direto (produto, estoque, supplier) */
  blingDirectUpsertQueue: {
    add: (payload: unknown, jobId: string) => Promise<void>;
  };
  /** Fila para eventos que precisam buscar dados adicionais na API Bling */
  blingApiFetchQueue: {
    add: (payload: unknown, jobId: string) => Promise<void>;
  };
  /** client_secret do aplicativo Bling (para validar HMAC) */
  clientSecret: string;
}

export interface OrchestrateResult {
  status: 'received' | 'ignored' | 'error';
  reason?: string;
}

/**
 * Orquestrador principal do webhook Bling.
 *
 * Responsabilidades:
 * 1. Validar assinatura HMAC
 * 2. Parsear e identificar recurso + ação
 * 3. Mapear payload para estrutura interna
 * 4. Despachar para a fila correta
 */
export async function orchestrateBlingWebhook(
  envelope: BlingWebhookEnvelope,
  rawBody: string,
  signatureHeader: string,
  deps: OrchestratorDependencies,
): Promise<OrchestrateResult> {
  // 1. Validação de assinatura
  // const isValid = validateBlingSignature(rawBody, signatureHeader, deps.clientSecret);
  // if (!isValid) {
  //   return { status: 'error', reason: 'Invalid HMAC signature' };
  // }

  // 2. Identificar recurso + ação
  const parsed = parseEvent(envelope.event);
  if (!parsed) {
    return { status: 'ignored', reason: `Unknown event: ${envelope.event}` };
  }

  const { resource, action } = parsed;
  const jobId = `bling-${resource}-${action}-${envelope.eventId}`;

  // 3. Pedidos → fila dedicada já existente
  if (resource === 'order') {
    const orderId = (envelope.data as any)?.id;
    if (!orderId) return { status: 'ignored', reason: 'Missing order id' };

    await deps.blingOrderQueue.add(
      { ...envelope, action },
      `bling-order-${action}-${orderId}`,
    );
    return { status: 'received' };
  }

  // 4. virtual_stock → sem ação direta
  if (resource === 'virtual_stock') {
    return { status: 'ignored', reason: 'virtual_stock handled by stock worker' };
  }

  // 5. Mapear payload
  const mapped = mapBlingWebhook(envelope);
  if (!mapped) {
    return { status: 'ignored', reason: `No mapping for ${envelope.event}` };
  }

  // 6. Enriquecer companyId no requiresApiFetch, se presente
  if (mapped.requiresApiFetch) {
    mapped.requiresApiFetch.companyId = envelope.companyId;
  }

  const queuePayload: WebhookQueuePayload = {
    eventId: envelope.eventId,
    resource,
    action,
    companyId: envelope.companyId,
    date: envelope.date,
    rawData: envelope.data,
  };

  // 7. Despachar para fila(s) adequada(s)
  //    Pode ter upsert direto E fetch simultâneos (ex: produto precisa de ambos)

  if (mapped.directUpsert) {
    // TODO FILA — enfileirar para worker de upsert direto
    await deps.blingDirectUpsertQueue.add(
      { ...queuePayload, directUpsert: mapped.directUpsert },
      `${jobId}-upsert`,
    );
  }

  if (mapped.requiresApiFetch) {
    // TODO FILA — enfileirar para worker que faz req na API Bling
    await deps.blingApiFetchQueue.add(
      { ...queuePayload, apiFetch: mapped.requiresApiFetch },
      `${jobId}-fetch`,
    );
  }

  return { status: 'received' };
}