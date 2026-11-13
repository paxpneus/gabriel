import { Transaction } from "sequelize";
import sequelize from "../../../../../../../config/sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import transferReferenceRepository, { TransferReferenceRepository } from "../repositories/transfer-reference.repository";
import { extractTransferReferenceNumber, TransferReferenceInput, transferReferenceProblems } from "../helpers/transfer-reference";
import { buildInvoiceReferenceDescription } from "../helpers/reference-description";
import { transferInvoiceLinkAudit } from "../helpers/audit";
import auditLogService from "../../../../../../global/audit-logs/audit-log.service";
import { AuditOrigin } from "../../../../../../global/audit-logs/audit-log.types";
import roleService from "../../../../../../company/users/roles/role.service";

// Quem altera o vínculo: usuário (roleId pra regra de admin), link do PDV (sem usuário) ou sistema.
export interface TransferLinkActor {
  userId: string | null;
  roleId?: string | null;
  origin?: AuditOrigin;
}

// Validação do vínculo nota de venda → transferência (1 ↔ 1), usada por core, lote e PDV.
export class TransferReferenceService extends BaseService<Invoice, TransferReferenceRepository> {
  constructor() {
    super(transferReferenceRepository);
  }

  // 1 nota de venda ↔ 1 transferência: a transferência existe (real ou provisória) e, com checkAlreadyUsed (padrão), nenhuma
  // outra nota (banco ou lista) aponta pra ela. Ref com transferInvoiceId compara por id; sem id (nota antiga), pelo número.
  async assertTransferReferences(
    refs: TransferReferenceInput[],
    closingMessage: string,
    { checkAlreadyUsed = true }: { checkAlreadyUsed?: boolean } = {},
  ): Promise<void> {
    const transferIds = [
      ...new Set(refs.map((ref) => ref.transferInvoiceId).filter((id): id is string => !!id)),
    ];
    const transferNumbers = [
      ...new Set(
        refs
          .filter((ref) => !ref.transferInvoiceId)
          .map((ref) => extractTransferReferenceNumber(ref.reference))
          .filter((n): n is string => !!n),
      ),
    ];
    // Lista vazia = repository nem consulta.
    let idsToCheckUsage: string[] = [];
    let numbersToCheckUsage: string[] = [];
    if (checkAlreadyUsed) {
      idsToCheckUsage = transferIds;
      numbersToCheckUsage = transferNumbers;
    }
    const [transfers, existingNumbers, referencingById, referencingByNumber] = await Promise.all([
      this.repository.findTransfersByIds(transferIds),
      this.repository.findExistingTransferNumbers(transferNumbers),
      this.repository.findByTransferInvoiceIds(idsToCheckUsage),
      this.repository.findByTransferReferenceNumbers(numbersToCheckUsage),
    ]);
    const problem = transferReferenceProblems(
      refs,
      {
        transferNumberById: new Map(transfers.map((transfer) => [transfer.id, transfer.normalized_number])),
        existingNumbers,
        referencingById,
        referencingByNumber,
      },
      closingMessage,
    );
    if (problem) throw new Error(problem);
  }

  // Transferências de outra loja própria pra receiverCnpj, por id (vínculo novo) ou número (antigas, repository tira zeros à esquerda).
  async findTransfersToReceiver(lookup: { ids: string[]; numbers: string[] }, receiverCnpj: string) {
    return this.repository.findTransfersToReceiver(lookup, receiverCnpj);
  }

  // Nota de venda finalizada na loja emitente (alterar o vínculo exige admin) — usado pelo detalhe pro can_edit_transfer_invoice.
  async isFinishedAtSender(invoiceId: string): Promise<boolean> {
    const [invoice] = await this.repository.findForTransferLink([invoiceId]);
    return !!invoice?.finished_at_sender;
  }

  // Grava (ou remove, com null) a transferência vinculada nas notas de venda — único escritor do vínculo (PDV, tela da nota, lote):
  // nota finalizada na loja emitente só admin, 1 ↔ 1, "REF: <n>" pra exibição e auditoria na nota de venda, na transação do chamador.
  async linkTransferInvoice(
    invoiceIds: string[],
    transferInvoiceId: string | null,
    actor: TransferLinkActor,
    transaction?: Transaction,
  ): Promise<void> {
    const run = async (t: Transaction) => {
      const before = await this.repository.findForTransferLink(invoiceIds, t);
      if (!before.length) return;
      let reference: string | null = null;
      if (transferInvoiceId) {
        const [[transfer]] = await Promise.all([
          this.repository.findTransfersByIds([transferInvoiceId]),
          this.assertTransferReferences(
            before.map((invoice) => ({
              invoiceId: invoice.id,
              invoiceNumber: invoice.number_system,
              reference: null,
              transferInvoiceId,
            })),
            "Revise a nota de transferência informada.",
          ),
        ]);
        reference = buildInvoiceReferenceDescription(transfer.number_system);
      }

      const changed = before.filter(
        (invoice) => invoice.transfer_invoice_id !== transferInvoiceId || invoice.transfer_invoice_reference !== reference,
      );
      if (!changed.length) return;
      // Nota de venda finalizada na loja emitente: vincular/trocar/remover só admin logado.
      if (changed.some((invoice) => invoice.finished_at_sender) && !(actor.roleId && (await roleService.isAdminRole(actor.roleId)))) {
        throw new Error(
          `Apenas administradores podem alterar a nota de transferência de nota de venda finalizada: ${changed.filter((invoice) => invoice.finished_at_sender).map((invoice) => invoice.number_system).join(", ")}.`,
        );
      }

      const changedIds = changed.map((invoice) => invoice.id);
      await this.repository.updateTransferLink(
        changedIds,
        { transfer_invoice_id: transferInvoiceId, transfer_invoice_reference: reference },
        t,
      );
      const after = await this.repository.findForTransferLink(changedIds, t, false);
      const afterById = new Map(after.map((invoice) => [invoice.id, invoice]));
      await auditLogService.record(
        changed.flatMap((invoice) =>
          transferInvoiceLinkAudit({
            userId: actor.userId,
            origin: actor.origin ?? AuditOrigin.USER,
            invoiceId: invoice.id,
            invoiceNumber: invoice.number_system,
            before: invoice,
            after: afterById.get(invoice.id) ?? {},
          }),
        ),
        t,
      );
    };
    if (transaction) return run(transaction);
    await sequelize.transaction(run);
  }
}

export default new TransferReferenceService();
