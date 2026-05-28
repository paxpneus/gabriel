import { Op } from 'sequelize'
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
  fromUnitId: string,
  toUnitId: string,
  transaction?: any,
): Promise<string> => {
  const prefix = `${fromUnitNumber}_${toUnitNumber}_`

  const last = await Operations.findOne({
    where: {
      from_unit: fromUnitId,
      to_unit:   toUnitId,
      code:      { [Op.like]: `${prefix}%` },
    },
    order: [['code', 'DESC']],
    transaction,
  })

  const nextSeq = last ? extractSeq(last.code!) + 1 : 1

  return `${prefix}${formatSequence(nextSeq)}`
}