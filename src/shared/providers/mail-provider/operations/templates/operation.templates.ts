import { JobsOptions } from "bullmq";
import SMTPTransport from "nodemailer/lib/smtp-transport";

// ─── NODEMAILER & QUEUE TYPES ────────────────────────────────────────────────

export type sendMailDto = {
  to: string;
  subject?: string;
  text?: string;
  html?: string;
};

export interface IMailProvider {
  send(data: sendMailDto): Promise<SMTPTransport.SentMessageInfo | any>;
}

export interface IMailNext {
  add: (
    data: sendMailDto,
    jobId?: string,
    opts?: JobsOptions
  ) => Promise<any>;
}

export interface mailerQueueMethods {
  add: {
    jobId: string;
    data: sendMailDto;
  };
}

// ─── ALERT TYPES ─────────────────────────────────────────────────────────────

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM";

export interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  context?: Record<string, any>;
  error?: Error | unknown;
}

// ─── OPERATION NOTIFICATION PAYLOADS ─────────────────────────────────────────

/**
 * Payload para Nova Solicitação (Operations + OperationsItens)
 * Se o item tiver produto, usamos o name (vinda do join), 
 * caso contrário, usamos a description do item.
 */
export interface OperationRequestEmailPayload {
  fromUnitName: string;
  toUnitName: string;
  code: string;
  items: {
    nameOrDescription: string; // Lógica: item.product.name ?? item.description
    quantity: number;
    code?: string;
  }[];
}

/**
 * Payload para Nota Fiscal Vinculada (Operations)
 */
export interface InvoiceLinkedEmailPayload {
  code: string;
  invoiceNumber: string;
}

/**
 * Payload para Nova Mensagem (OperationComment)
 */
export interface NewMessageEmailPayload {
  senderName: string;
  senderUnitName: string;
  operationCode: string;
  comment: string; // Campo 'comment' do modelo OperationComment
  date: Date;
}

// ─── TEMPLATE HELPERS ────────────────────────────────────────────────────────

export const baseStyle = `font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a`;

export function footer() {
  return `
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="color:#999;font-size:12px;margin:0">
      Enviado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
      · PAX Pneus
    </p>
  `;
}

export function header(title: string, color = '#111827') {
  return `
    <div style="background:${color};padding:16px 24px;border-radius:6px 6px 0 0">
      <h2 style="color:#fff;margin:0;font-size:16px;font-weight:600">${title}</h2>
    </div>
  `;
}

export function card(content: string) {
  return `
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 6px 6px">
      ${content}
    </div>
  `;
}

// ─── TEMPLATE BUILDERS ───────────────────────────────────────────────────────

export function buildOperationRequestHtml(payload: OperationRequestEmailPayload): string {
  const itemsHtml = payload.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px">${item.nameOrDescription}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:center">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;font-family:monospace">${item.code ?? '—'}</td>
      </tr>
    `
    )
    .join('');

  return `
    <div style="${baseStyle}">
      ${header('📦 Nova Solicitação de Estoque')}
      ${card(`
        <p style="margin:0 0 16px;font-size:15px">Uma nova transferência de estoque foi registrada.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr><td style="padding:4px 0;font-size:13px;color:#6b7280">De:</td><td style="padding:4px 0;font-size:14px;font-weight:600">${payload.fromUnitName}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Para:</td><td style="padding:4px 0;font-size:14px;font-weight:600">${payload.toUnitName}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Código:</td><td style="padding:4px 0;font-size:14px;font-family:monospace">${payload.code}</td></tr>
        </table>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb">
          <thead style="background:#f9fafb">
            <tr>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280">Item</th>
              <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280">Qtd</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280">SKU</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        ${footer()}
      `)}
    </div>
  `;
}

export function buildInvoiceLinkedHtml(payload: InvoiceLinkedEmailPayload): string {
  return `
    <div style="${baseStyle}">
      ${header('🧾 Nota Fiscal Vinculada', '#1d4ed8')}
      ${card(`
        <p style="margin:0 0 16px;font-size:15px">
          Uma nota fiscal foi vinculada à sua solicitação de estoque.
        </p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280;width:40%">
              Código da solicitação
            </td>
            <td style="padding:8px 12px;font-size:14px;font-family:monospace;font-weight:600">
              ${payload.code}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280">
              Número da NF
            </td>
            <td style="padding:8px 12px;font-size:14px;font-family:monospace">
              ${payload.invoiceNumber}
            </td>
          </tr>
        </table>

        <p style="font-size:13px;color:#6b7280;margin:16px 0 0">
          Você já pode prosseguir com a conferência ou os próximos passos da operação no sistema.
        </p>

        ${footer()}
      `)}
    </div>
  `;
}

export function buildNewMessageHtml(payload: NewMessageEmailPayload): string {
  return `
    <div style="${baseStyle}">
      ${header('💬 Novo Comentário na Operação', '#6d28d9')}
      ${card(`
        <p style="margin:0 0 16px;font-size:15px"><b>${payload.senderName}</b> (${payload.senderUnitName}) enviou uma mensagem na solicitação <b>${payload.operationCode}</b>:</p>
        <div style="background:#f9fafb;border-left:4px solid #6d28d9;padding:16px;font-size:14px;line-height:1.6;font-style:italic">
          "${payload.comment}"
        </div>
        ${footer()}
      `)}
    </div>
  `;
}