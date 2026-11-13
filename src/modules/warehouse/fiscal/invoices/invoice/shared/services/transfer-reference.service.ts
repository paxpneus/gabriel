import { Transaction, WhereOptions } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import transferReferenceRepository, { TransferReferenceRepository } from "../repositories/transfer-reference.repository";
import { extractTransferReferenceNumber, TransferReferenceInput, transferReferenceProblems } from "../helpers/transfer-reference";

// Validação de transfer_invoice_reference (1 nota de venda ↔ 1 transferência), usada por core, lifecycle e lote.
export class TransferReferenceService extends BaseService<Invoice, TransferReferenceRepository> {
  constructor() {
    super(transferReferenceRepository);
  }

  // 1 nota de venda ↔ 1 transferência: a referência tem número, existe nota de TRANSFERÊNCIA entre lojas com ele (real ou
  // provisória) e, com checkAlreadyUsed
  // (padrão), nenhuma outra nota (banco ou lista) aponta pra ela. Escritas checam tudo; o romaneio CD 12/17 só existência.
  async assertTransferReferences(
    refs: TransferReferenceInput[],
    closingMessage: string,
    { checkAlreadyUsed = true }: { checkAlreadyUsed?: boolean } = {},
  ): Promise<void> {
    const transferNumbers = [
      ...new Set(refs.map((ref) => extractTransferReferenceNumber(ref.reference)).filter((n): n is string => !!n)),
    ];
    // Lista vazia = repository nem consulta.
    let numbersToCheckUsage: string[] = [];
    if (checkAlreadyUsed) numbersToCheckUsage = transferNumbers;
    const [existing, referencing] = await Promise.all([
      this.repository.findExistingTransferNumbers(transferNumbers),
      this.repository.findByTransferReferenceNumbers(numbersToCheckUsage),
    ]);
    const problem = transferReferenceProblems(refs, existing, referencing, closingMessage);
    if (problem) throw new Error(problem);
  }

  // Notas de transferência de outra loja própria pra receiverCnpj com esses números (repository normaliza zeros à esquerda).
  async findTransfersToReceiverByNumbers(numbers: string[], receiverCnpj: string) {
    return this.repository.findTransfersToReceiverByNumbers(numbers, receiverCnpj);
  }

  // Escrita de transfer_invoice_reference (PUT /:id, PUT /bulk, lote): valida as notas alvo; limpar (vazio/null) passa direto.
  async assertTransferReferenceWrite(
    data: { transfer_invoice_reference?: string | null },
    where: WhereOptions,
    transaction?: Transaction,
  ): Promise<void> {
    const reference = data.transfer_invoice_reference;
    if (typeof reference !== "string" || !reference.trim()) return;
    const targets = await this.findAll({ where, attributes: ["id", "number_system"], transaction });
    await this.assertTransferReferences(
      targets.map((invoice) => ({ invoiceId: invoice.id, invoiceNumber: invoice.number_system, reference })),
      "Revise a nota de transferência informada.",
    );
  }
}

export default new TransferReferenceService();
