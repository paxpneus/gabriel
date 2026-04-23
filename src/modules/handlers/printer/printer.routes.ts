import { Router } from 'express'
import printer from 'pdf-to-printer'
import { Bonjour } from 'bonjour-service'
import fs from 'fs'
import path from 'path'
import os from 'os'

const router = Router()

router.get('/printers', async (req, res) => {
  const printers = await printer.getPrinters()
  res.json(printers)
})

router.get('/discover', async (req, res) => {
  const bonjour = new Bonjour()
  const found: any[] = []

  const browser = bonjour.find({ type: 'ipp' }, (service) => {
    found.push({
      name: service.name,
      ip: service.referer?.address,
      port: service.port,
      url: `ipp://${service.referer?.address}:${service.port}/ipp/print`,
    })
  })

  setTimeout(() => {
    browser.stop()
    bonjour.destroy()
    res.json(found)
  }, 3000)
})

router.post('/print', async (req, res) => {
  try {
    const { pdfBase64, printerName } = req.body
    const tempFile = path.join(os.tmpdir(), `romaneio-${Date.now()}.pdf`)

    fs.writeFileSync(tempFile, Buffer.from(pdfBase64, 'base64'))
    await printer.print(tempFile, { printer: printerName })
    fs.unlinkSync(tempFile)

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router