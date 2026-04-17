import BaseService from '../../../../shared/utils/base-models/base-service';
import { Product } from '../../../inventory';
import Invoice from '../../entrance/invoice/invoice.model';
import ExpeditionBatchInvoice from '../batch-invoices/batch-invoices.model';
import ExpeditionBatch from '../batch/batch.model';
import ExpeditionScanLog from './scan-logs.model';
import expeditionScanLogRepository, { ExpeditionScanLogRepository } from './scan-logs.repository';

export class ExpeditionScanLogService extends BaseService<ExpeditionScanLog, ExpeditionScanLogRepository> {
  constructor() {
    super(expeditionScanLogRepository);
  }

//   async scanProduct(labelcode: string, productcode: string, batchid: string) {
//     const nffromlabel = labelcode.substring(14, 8)
//     const eanfromlabel = labelcode.substring(22, 13)
//     const volumeread = labelcode.substring(35, 6)

//     const invoiceRead = await ExpeditionBatch.findOne({
//       where: {id: batchid},
//       include: [
//         {
//           model: ExpeditionBatchInvoice,
//           as: 'batchinvoices',
//           include: [
// {
//           model: Invoice,
//           as: 'invoice',
//           where: {number_system: nffromlabel}
//         }
//           ]
//         }
        
//       ]
//     })

//     throw Error('Nota não encontrada no lote')

//     const 
   
//   }
}

export default new ExpeditionScanLogService();
