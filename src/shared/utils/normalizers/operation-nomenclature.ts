import { Transaction } from 'sequelize'
import { Operations } from '../../../modules/warehouse'

const formatSequence = (num: number, digits = 4): string =>
  String(num).padStart(digits, '0')

export const generateOperationCode = async (
  fromUnitNumber: string,
  toUnitNumber: string,
  transaction?: Transaction,
): Promise<string> => {
  const total = await Operations.count({ transaction })

  return `${fromUnitNumber}_${toUnitNumber}_${formatSequence(total + 1)}`
}