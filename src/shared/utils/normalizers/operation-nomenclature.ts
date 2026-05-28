import { Transaction, literal } from 'sequelize'
import { Operations } from '../../../modules/warehouse'

const formatSequence = (num: number, digits = 4): string =>
  String(num).padStart(digits, '0')

const extractSeq = (code: string): number => {
  const part = code.split('_').pop()
  return part ? parseInt(part, 10) : 0
}

export const generateOperationCode = async (
  fromUnitNumber: string,
  toUnitNumber: string,
  transaction?: Transaction,
): Promise<string> => {
  const last = await Operations.findOne({
    order: [literal(`LENGTH(code) DESC, code DESC`)],
    transaction,
  })

  const nextSeq = last?.code ? extractSeq(last.code) + 1 : 1

  return `${fromUnitNumber}_${toUnitNumber}_${formatSequence(nextSeq)}`
}