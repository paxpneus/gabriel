import { Op, Transaction } from "sequelize"
import sequelize from "../../../config/sequelize"
import InventoryBatch from "../../../modules/inventory/stock-inventory/inventory-batch/inventory-batch.model"
import { ExpeditionBatch } from "../../../modules/warehouse"
import { getBrazilDate } from "./date"
import { buildExpeditionBatchNumber, formatBatchSequence } from "./expedition-batch-number"

type batchType = 'INVENTORY' | 'ENTRANCE' | 'EXPEDITION' | 'DIVERGENCY'

// Serializa concorrência na geração de número: sem isso, count() + insert não são atômicos
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

const getNextAvailableExpeditionNumber = async (
  buildNumber: (seq: number) => string,
  startFrom: number,
  transaction?: Transaction
): Promise<string> => {
  let seq = startFrom
  while (true) {
    const candidate = buildNumber(seq)
    const exists = await ExpeditionBatch.findOne({ where: { number: candidate }, transaction })
    if (!exists) return candidate
    seq++
  }
}

const getNextAvailableInventoryNumber = async (
  buildNumber: (seq: number) => string,
  startFrom: number,
  transaction?: Transaction
): Promise<string> => {
  let seq = startFrom
  while (true) {
    const candidate = buildNumber(seq)
    const exists = await InventoryBatch.findOne({ where: { number: candidate }, transaction })
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
    case 'ENTRANCE': {
      const count = await ExpeditionBatch.count({
        where: { type: 'INCOMING', unit_business_id: unitBusinessId },
        transaction
      })
      return getNextAvailableExpeditionNumber(
        (seq) => buildExpeditionBatchNumber(transporter_name, unitBusinessNumber, seq),
        count + 1,
        transaction
      )
    }

    case 'EXPEDITION': {
      const count = await ExpeditionBatch.count({
        where: { type: 'OUTGOING', unit_business_id: unitBusinessId },
        transaction
      })
      return getNextAvailableExpeditionNumber(
        (seq) => buildExpeditionBatchNumber(transporter_name, unitBusinessNumber, seq),
        count + 1,
        transaction
      )
    }

    case 'INVENTORY': {
      const count = await InventoryBatch.count({
        where: { unit_business_id: unitBusinessId, type: 'REGULAR' },
        transaction
      })
      return getNextAvailableInventoryNumber(
        (seq) => `INV_LOJA${unitBusinessNumber}_${formatBatchSequence(seq)}_${getBrazilDate()}`,
        count + 1,
        transaction
      )
    }

    case 'DIVERGENCY': {
      const count = await InventoryBatch.count({
        where: { unit_business_id: unitBusinessId, type: 'DIVERGENCY' },
        transaction
      })
      return getNextAvailableInventoryNumber(
        (seq) => `DIV_LOJA${unitBusinessNumber}_${formatBatchSequence(seq)}_${getBrazilDate()}`,
        count + 1,
        transaction
      )
    }

    default:
      return `LOTE_LOJA${unitBusinessNumber}_0001`
  }
}