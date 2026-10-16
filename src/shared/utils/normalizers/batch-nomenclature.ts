import { ModelStatic, Transaction, WhereOptions, fn, literal } from "sequelize"
import sequelize from "../../../config/sequelize"
import InventoryBatch from "../../../modules/inventory/stock-inventory/inventory-batch/inventory-batch.model"
import { ExpeditionBatch } from "../../../modules/warehouse"
import { getBrazilDate } from "./date"
import {
  EXPEDITION_BATCH_SEQUENCE_SQL_PATTERN,
  buildExpeditionBatchNumber,
  formatBatchSequence,
} from "./expedition-batch-number"

type batchType = 'INVENTORY' | 'ENTRANCE' | 'EXPEDITION' | 'DIVERGENCY'

// "INV_LOJA21_0005_16102026" → 5 (sequência fica antes da data).
const INVENTORY_BATCH_SEQUENCE_SQL_PATTERN = '_LOJA[0-9]+_([0-9]+)_[0-9]+$'

// Serializa concorrência na geração de número: sem isso, leitura da sequência + insert não são atômicos
// e duas transações concorrentes podem calcular a mesma sequência (mesmo com transportadores/números finais diferentes).
const acquireBatchNumberLock = async (
  key: string,
  transaction: Transaction,
): Promise<void> => {
  await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(?))", {
    replacements: [key],
    transaction,
  })
}

// MAX da sequência, não count(): count cai quando um lote é excluído e repetia número com outra transportadora.
const getMaxSequence = async (
  model: ModelStatic<any>,
  where: WhereOptions,
  sequencePattern: string,
  transaction?: Transaction
): Promise<number> => {
  const row = await model.findOne({
    attributes: [
      [fn("MAX", literal(`CAST(substring("number" from '${sequencePattern}') AS integer)`)), "max_sequence"],
    ],
    where,
    raw: true,
    transaction,
  }) as { max_sequence: number | string | null } | null

  return Number(row?.max_sequence ?? 0)
}

const getNextAvailableNumber = async (
  model: ModelStatic<any>,
  buildNumber: (seq: number) => string,
  startFrom: number,
  transaction?: Transaction
): Promise<string> => {
  let seq = startFrom
  while (true) {
    const candidate = buildNumber(seq)
    const exists = await model.findOne({ attributes: ["id"], where: { number: candidate }, transaction })
    if (!exists) return candidate
    seq++
  }
}

export const setBatchNumber = async (
  type: string,
  unitBusinessNumber: string,
  unitBusinessId: string,
  transporter_name?: string | null,
  transaction?: Transaction
): Promise<string> => {

  if (transaction) {
    await acquireBatchNumberLock(`${type}:${unitBusinessId}`, transaction)
  }

  switch (type) {
    case 'ENTRANCE':
    case 'EXPEDITION': {
      const maxSequence = await getMaxSequence(
        ExpeditionBatch,
        { type: type === 'ENTRANCE' ? 'INCOMING' : 'OUTGOING', unit_business_id: unitBusinessId },
        EXPEDITION_BATCH_SEQUENCE_SQL_PATTERN,
        transaction
      )
      return getNextAvailableNumber(
        ExpeditionBatch,
        (seq) => buildExpeditionBatchNumber(transporter_name, unitBusinessNumber, seq),
        maxSequence + 1,
        transaction
      )
    }

    case 'INVENTORY':
    case 'DIVERGENCY': {
      const maxSequence = await getMaxSequence(
        InventoryBatch,
        { unit_business_id: unitBusinessId, type: type === 'INVENTORY' ? 'REGULAR' : 'DIVERGENCY' },
        INVENTORY_BATCH_SEQUENCE_SQL_PATTERN,
        transaction
      )
      const prefix = type === 'INVENTORY' ? 'INV' : 'DIV'
      return getNextAvailableNumber(
        InventoryBatch,
        (seq) => `${prefix}_LOJA${unitBusinessNumber}_${formatBatchSequence(seq)}_${getBrazilDate()}`,
        maxSequence + 1,
        transaction
      )
    }

    default:
      return `LOTE_LOJA${unitBusinessNumber}_0001`
  }
}
