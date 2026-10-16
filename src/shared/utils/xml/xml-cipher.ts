// src/shared/utils/crypto/xml-cipher.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY = Buffer.from(process.env.XML_ENCRYPTION_KEY!, 'hex')

export function encryptXml(xml: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(xml, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('base64')}`
}

export function decryptXml(encrypted: string): string {
  const [ivHex, content] = encrypted.split(':')
  const iv = Buffer.from(ivHex!, 'hex')
  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(content!, 'base64')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

export function isEncrypted(value: string): boolean {
  return /^[a-f0-9]{32}:.+/.test(value)
}


// Só o início da nota: CBC decifra bloco a bloco, então dá pra ler o cabeçalho sem a nota inteira.
export function decryptXmlHead(encrypted: string): string {
  const [ivHex, content] = encrypted.split(':')
  const base64 = content!.slice(0, content!.length - (content!.length % 4))
  const buffer = Buffer.from(base64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex!, 'hex'))
  decipher.setAutoPadding(false)
  return decipher.update(buffer.subarray(0, buffer.length - (buffer.length % 16))).toString('utf8')
}
