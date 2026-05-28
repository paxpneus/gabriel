// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface OperationRequestEmailPayload {
  fromUnit: string
  toUnit: string
  code: string
  items: { name: string; quantity: number; description?: string }[]
}

export interface InvoiceLinkedEmailPayload {
  code: string
  invoiceNumber: string
}

export interface NewMessageEmailPayload {
  senderName: string
  senderUnit: string
  operationCode: string
  message: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseStyle = `font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a`

function footer() {
  return `
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="color:#999;font-size:12px;margin:0">
      Enviado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
      · Sistema de Gestão de Estoque
    </p>
  `
}

function header(title: string, color = '#111827') {
  return `
    <div style="background:${color};padding:16px 24px;border-radius:6px 6px 0 0">
      <h2 style="color:#fff;margin:0;font-size:16px;font-weight:600">${title}</h2>
    </div>
  `
}

function card(content: string) {
  return `
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 6px 6px">
      ${content}
    </div>
  `
}

// ─── Template 1: Nova Solicitação ─────────────────────────────────────────────

export function buildOperationRequestHtml(payload: OperationRequestEmailPayload): string {
  const itemsHtml = payload.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px">${item.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:center">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280">${item.description ?? '—'}</td>
      </tr>
    `
    )
    .join('')

  return `
    <div style="${baseStyle}">
      ${header('📦 Nova Solicitação de Estoque')}
      ${card(`
        <p style="margin:0 0 16px;font-size:15px">
          Foi criada uma nova solicitação de transferência de estoque para a sua loja.
        </p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280;width:40%">De</td>
            <td style="padding:8px 12px;font-size:14px">${payload.fromUnit}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280">Para</td>
            <td style="padding:8px 12px;font-size:14px">${payload.toUnit}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280">Código</td>
            <td style="padding:8px 12px;font-size:14px;font-family:monospace;font-weight:600">${payload.code}</td>
          </tr>
        </table>

        <p style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px">Itens solicitados</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px 12px;font-size:12px;text-align:left;color:#6b7280;font-weight:600">Produto</th>
              <th style="padding:8px 12px;font-size:12px;text-align:center;color:#6b7280;font-weight:600">Qtd</th>
              <th style="padding:8px 12px;font-size:12px;text-align:left;color:#6b7280;font-weight:600">Descrição</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        ${footer()}
      `)}
    </div>
  `
}

// ─── Template 2: Nota Fiscal Vinculada ───────────────────────────────────────

export function buildInvoiceLinkedHtml(payload: InvoiceLinkedEmailPayload): string {
  return `
    <div style="${baseStyle}">
      ${header('🧾 Nota Fiscal Vinculada', '#1d4ed8')}
      ${card(`
        <p style="margin:0 0 16px;font-size:15px">
          Uma nota fiscal foi vinculada à sua solicitação de estoque.
        </p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280;width:40%">Código da solicitação</td>
            <td style="padding:8px 12px;font-size:14px;font-family:monospace;font-weight:600">${payload.code}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280">Nota Fiscal</td>
            <td style="padding:8px 12px;font-size:14px;font-family:monospace">${payload.invoiceNumber}</td>
          </tr>
        </table>

        <p style="font-size:13px;color:#6b7280;margin:16px 0 0">
          Acompanhe o andamento da solicitação pelo sistema.
        </p>

        ${footer()}
      `)}
    </div>
  `
}

// ─── Template 3: Nova Mensagem ────────────────────────────────────────────────

export function buildNewMessageHtml(payload: NewMessageEmailPayload): string {
  return `
    <div style="${baseStyle}">
      ${header('💬 Nova Mensagem na Solicitação', '#6d28d9')}
      ${card(`
        <p style="margin:0 0 16px;font-size:15px">
          Você recebeu uma nova mensagem relacionada a uma solicitação de estoque.
        </p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280;width:40%">De</td>
            <td style="padding:8px 12px;font-size:14px">${payload.senderName}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280">Loja</td>
            <td style="padding:8px 12px;font-size:14px">${payload.senderUnit}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;font-size:13px;font-weight:600;color:#6b7280">Solicitação</td>
            <td style="padding:8px 12px;font-size:14px;font-family:monospace;font-weight:600">${payload.operationCode}</td>
          </tr>
        </table>

        <p style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px">Mensagem</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;font-size:14px;line-height:1.6;color:#374151">
          ${payload.message}
        </div>

        <p style="font-size:13px;color:#6b7280;margin:16px 0 0">
          Acesse o sistema para responder à mensagem.
        </p>

        ${footer()}
      `)}
    </div>
  `
}