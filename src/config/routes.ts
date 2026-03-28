import { Router } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()
const modulesPath = path.resolve(__dirname, '..', 'modules')

function loadModules(basePath: string) {
  const entries = fs.readdirSync(basePath)

  for (const entry of entries) {
    const entryPath = path.join(basePath, entry)

    if (!fs.statSync(entryPath).isDirectory()) continue

    const routeFile = fs.readdirSync(entryPath).find(f => f.endsWith('.routes.ts') || f.endsWith('.routes.js'))

    if (routeFile) {
      const { default: moduleRouter } = require(path.join(entryPath, routeFile))
      router.use(`/${entry}`, moduleRouter)
      console.log(`------------------- Rota registrada: /api/${entry} ------------------- `)
    } else {
     
      loadModules(entryPath)
    }
  }
}

loadModules(modulesPath)

export default router