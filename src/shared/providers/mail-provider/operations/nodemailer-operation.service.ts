import nodemailerService from "../../mail-provider/nodemailer.service";
import { 
  OperationRequestEmailPayload, 
  InvoiceLinkedEmailPayload, 
  NewMessageEmailPayload,
  buildOperationRequestHtml,
  buildInvoiceLinkedHtml,
  buildNewMessageHtml 
} from '../operations/templates/operation.templates'

class OperationMailService {
  /**
   * Notifica a unidade de destino sobre uma nova solicitação de estoque
   */
  async notifyNewOperationRequest(to: string, payload: OperationRequestEmailPayload) {
    const html = buildOperationRequestHtml(payload);
    
    return await nodemailerService.send({
      to,
      subject: `📦 Nova Solicitação de Estoque - ${payload.code}`,
      html,
      text: `Nova solicitação de estoque criada da unidade ${payload.fromUnitName} para ${payload.toUnitName}. Código: ${payload.code}`,
    });
  }

  /**
   * Notifica sobre a vinculação de uma nota fiscal a uma operação
   */
  async notifyInvoiceLinked(to: string, payload: InvoiceLinkedEmailPayload) {
    const html = buildInvoiceLinkedHtml(payload);
    
    return await nodemailerService.send({
      to,
      subject: `🧾 Nota Fiscal Vinculada - Ref: ${payload.code}`,
      html,
      text: `Uma nota fiscal (${payload.invoiceNumber}) foi vinculada à solicitação ${payload.code}.`,
    });
  }

  /**
   * Notifica sobre uma nova mensagem no chat da operação
   */
  async notifyNewMessage(to: string, payload: NewMessageEmailPayload) {
    const html = buildNewMessageHtml(payload);
    
    return await nodemailerService.send({
      to,
      subject: `💬 Nova Mensagem na Solicitação ${payload.operationCode}`,
      html,
      text: `${payload.senderName} enviou uma mensagem sobre a solicitação ${payload.operationCode}`,
    });
  }
}

export default new OperationMailService();