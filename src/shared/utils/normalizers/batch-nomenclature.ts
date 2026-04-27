import InventoryBatch from "../../../modules/inventory/stock-inventory/inventory-batch/inventory-batch.model"
import { ExpeditionBatch } from "../../../modules/warehouse"
import { getBrazilDate } from "./date"
type batchType = 'INVENTORY' | 'ENTRANCE' | 'EXPEDITION'

export const setBatchNumber = async (type: string, unitBusinessNumber: string, unitBusinessId: string): Promise<string> => {
  let sequence: string = '0001'

  switch (type) {
    case 'ENTRANCE':
      const count = await ExpeditionBatch.count({
        where: { type: 'INCOMING', unit_business_id: unitBusinessId }
      })
      sequence = formatSequence(count + 1) 
      break

    case 'INVENTORY':
      const invCount = await InventoryBatch.count({
        where: {
            unit_business_id: unitBusinessId
        }
      })
      sequence = formatSequence(invCount + 1)
      break

    case 'EXPEDITION':
        const expeditionCount = await ExpeditionBatch.count({
            where: {
                type: 'OUTGOING',
                unit_business_id: unitBusinessId
            }
        })
        sequence = formatSequence(expeditionCount + 1)
        

  }

  const setBody = `${type.substring(0, 3)}_LOJA${unitBusinessNumber}_${sequence}_${getBrazilDate()}`
  return setBody
}

const formatSequence = (num: number, digits: number = 4): string => {
  return String(num).padStart(digits, '0')
}

// formatSequence(1)      // "0001"
// formatSequence(10)     // "0010"
// formatSequence(1000)   // "1000"
// formatSequence(10000)  // "10000" → ultrapassa 4 dígitos, não trunca