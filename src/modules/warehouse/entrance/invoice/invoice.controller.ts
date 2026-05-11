import { LabelService } from './invoice-label.service';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import Invoice from './invoice.model';
import InvoiceService from './invoice.service';
import { Request, Response } from 'express';
import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from '../../../../middlewares/user-permissions';
import { gerarPDF } from '@alexssmusica/node-pdf-nfe';
import archiver from 'archiver';
import { decryptXml, isEncrypted } from '../../../../shared/utils/xml/xml-cipher';
import { PassThrough } from 'stream'
import { PDFDocument } from 'pdf-lib'
import { Op } from 'sequelize';
import { InvoiceAttributes } from './invoice.types';
import multer from 'multer';
import { BlingApiFetchQueue } from '../../../handlers/bling/services/bling/queues/bling-api-fetch.queue';

const upload = multer({ storage: multer.memoryStorage() });

export class InvoiceController extends BaseController<Invoice, typeof InvoiceService> {

  private labelService: LabelService

  constructor() {
    super(InvoiceService);

    this.labelService = new LabelService()

    this.router.get(
      '/labels/data',
      ...this.mw('getLabelData'),
      this.getLabelData,
    )
    this.router.get(
      '/danfe/data',
      ...this.mw('getDanfeBatch'),
      this.getDanfeBatch,
    )
    this.router.get(
      '/full/:id',
      ...this.mw('getFullInvoice'),
      this.getFullInvoice,
    )
    this.router.post(
      '/bulk/open',
      ...this.mw('updateInvoicesOpen'),
      this.updateInvoicesOpen,
    )
    this.router.put(
      '/schedule/invoice/:id',
      ...this.mw('scheduleInvoice'),
      this.scheduleInvoice,
    )
    this.router.post(
  '/import/xml',
  upload.single('xml'),        
  ...this.mw('importXML'),
  this.importXML,
)
  }

  protected registerCustomRoutes(): void {
}

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],

      getFullInvoice: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      login: [authenticate, userPermissions],

      getLabelData: [authenticate, userPermissions],
      getDanfeBatch: [authenticate, userPermissions],

      updateInvoicesOpen: [authenticate, userPermissions],
      scheduleInvoice: [authenticate, userPermissions],

      importXML: [authenticate, userPermissions],
    };
  }

     getFullInvoice = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {id} = req.params
      console.log(id, req.params)
    const data = await this.service.findByIdFull(id as string)

    return res.json({data})
  } catch (err: any) {
      return res.status(500).json({ error: err.message })
    }
  }

  getLabelData = async (req: Request, res: Response): Promise<Response> => {
    try {
    let ids: string[] = [];
 
    if (Array.isArray(req.query.invoiceIds)) {
      ids = req.query.invoiceIds as string[];
    } else if (typeof req.query.invoiceIds === 'string') {
      ids = req.query.invoiceIds.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const data = await this.labelService.getLabelData(ids)

    return res.json({data})
  } catch (err: any) {
      return res.status(500).json({ error: err.message })
    }
  }

  getDanfeBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      let ids: string[] = []
      if (Array.isArray(req.query.invoiceIds)) {
        ids = req.query.invoiceIds as string[]
      } else if (typeof req.query.invoiceIds === 'string') {
        ids = req.query.invoiceIds.split(',').map(s => s.trim()).filter(Boolean)
      }

      if (!ids.length) {
        res.status(400).json({ error: 'Nenhum ID informado' })
        return
      }

      const invoices = await Invoice.findAll({ where: { id: ids } })

      if (!invoices.length) {
        res.status(404).json({ error: 'Nenhuma nota encontrada' })
        return
      }

      const mergedPdf = await PDFDocument.create()

      for (const invoice of invoices) {
        let xml = (invoice as any).xml_path

        if (!xml || xml.startsWith('http')) {
          console.warn(`Invoice ${invoice.id}: XML não disponível, pulando.`)
          continue
        }

        if (isEncrypted(xml)) xml = decryptXml(xml)

        try {
          const doc = await gerarPDF(xml, { cancelada: false })

          const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            const pass = new PassThrough()
            const chunks: Buffer[] = []
            pass.on('data', (chunk: Buffer) => chunks.push(chunk))
            pass.on('end', () => resolve(Buffer.concat(chunks)))
            pass.on('error', reject)
            doc.pipe(pass)
          })

          const invoicePdf = await PDFDocument.load(pdfBuffer)
          const pages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices())
          pages.forEach(p => mergedPdf.addPage(p))

          console.log(`[DANFE] invoice=${invoice.id} adicionada ao PDF mesclado`)
        } catch (err: any) {
          console.error(`[DANFE] Erro invoice ${invoice.id}:`, err.message)
        }
      }

      const mergedBytes = await mergedPdf.save()

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="danfes-${Date.now()}.pdf"`)
      res.send(Buffer.from(mergedBytes))
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message })
      }
    }
  }

   updateInvoicesOpen = async (req: Request, res: Response): Promise<void> => {
    console.log(req.body)
  try { 
    const  ids  = req.body
    await Invoice.update({ status: 'PENDING' }, {
      where: { 
        id: { [Op.in]: ids },
        status: 'OPEN'
      }
    })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

scheduleInvoice = async (req: Request, res: Response): Promise<void> => {
  try { 
    const  { expectedDate}  = req.body
    const {id} = req.params
    
    await this.service.scheduleInvoice(id as string, expectedDate)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

importXML = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo XML enviado' })
      return
    }

    const xmlContent = req.file.buffer.toString('utf-8')

    if (!xmlContent.trim()) {
      res.status(400).json({ error: 'Arquivo XML vazio' })
      return
    }

    const queue = req.app.locals.BlingApiFetchQueue as BlingApiFetchQueue
    await queue.upsertInvoiceFromXml(xmlContent)

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
}

export default new InvoiceController();
