import { Router } from 'express'
import { Bonjour } from 'bonjour-service'
import ipp from 'ipp'
import fs from 'fs'
import path from 'path'
import os from 'os'

const router = Router()

// Lista impressoras via mDNS — funciona em Linux/Windows/Mac
router.get('/printers', async (req, res) => {
  const bonjour = new Bonjour()
  const found: any[] = []

  const browser = bonjour.find({ type: 'ipp' }, (service) => {
    found.push({
      name: service.name,
      ip: service.referer?.address,
      port: service.port,
    })
  })

  setTimeout(() => {
    browser.stop()
    bonjour.destroy()
    res.json(found)
  }, 3000)
})

// Imprime PDF via IPP direto na impressora pelo IP
router.post('/print', async (req, res) => {
  try {
    const { pdfBase64, printerIp, printerPort = 631 } = req.body
    const pdfBuffer = Buffer.from(pdfBase64, 'base64')

    const printer = new ipp.Printer(`http://${printerIp}:${printerPort}/ipp/print`)

    const msg: any = {
      'operation-attributes-tag': {
        'requesting-user-name': 'pax-system',
        'job-name': 'Romaneio',
        'document-format': 'application/pdf',
      },
      data: pdfBuffer,
    }

    printer.execute('Print-Job', msg, (err: any, response: any) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ success: true, jobId: response?.['job-attributes-tag']?.['job-id'] })
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router