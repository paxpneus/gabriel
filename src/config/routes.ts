import { Router } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()
const modulesPath = path.resolve(__dirname, '..', 'modules')

export const ROUTE_TO_TABLE: Record<string, string> = {}

// Rotas que não precisam de verificação de permissão
const EXCLUDED_ROUTES = new Set([
  'integration-mapping',
  'bling',
  'bling-orders',
  'stores',
])

function findFile(dir: string, pattern: RegExp): string | undefined {
  return fs.readdirSync(dir).find(f => pattern.test(f))
}

function loadModules(basePath: string) {
  for (const entry of fs.readdirSync(basePath)) {
    const entryPath = path.join(basePath, entry)
    if (!fs.statSync(entryPath).isDirectory()) continue

    const routeFile = findFile(entryPath, /\.routes\.(ts|js)$/)

    if (routeFile) {
      const { default: moduleRouter } = require(path.join(entryPath, routeFile))
      router.use(`/${entry}`, moduleRouter)

      const modelFile = findFile(entryPath, /\.model\.(ts|js)$/)
      if (modelFile) {
        try {
          const { default: model } = require(path.join(entryPath, modelFile))
          const raw = model?.getTableName?.()
          if (raw) {
            ROUTE_TO_TABLE[entry] = typeof raw === 'string' ? raw : raw.tableName
          }
        } catch {
          console.warn(`[routes] Sem model em: ${entryPath}`)
        }
      }

      console.log(`Rota: /api/${entry} → tabela: ${ROUTE_TO_TABLE[entry] ?? '(sem model)'}`)
    } else {
      loadModules(entryPath)
    }
  }
}

loadModules(modulesPath)

export default router

// ─── helpers exportados para o middleware ────────────────────────────────────

function getApiBaseSegment(originalUrl: string): string | null {
  const segments = originalUrl.split('?')[0].split('/').filter(Boolean)
  const apiIndex = segments.indexOf('api')
  return apiIndex === -1
    ? (segments[0] ?? null)
    : (segments[apiIndex + 1] ?? null)
}

/**
 * Retorna o tableName mapeado para a rota, ou null se:
 *  - rota excluída (sem necessidade de permissão)
 *  - rota desconhecida
 */
export function resolveEntityFromRoute(originalUrl: string): string | null {
  const base = getApiBaseSegment(originalUrl)
  if (!base) return null
  if (EXCLUDED_ROUTES.has(base)) return null
  return ROUTE_TO_TABLE[base] ?? null
}