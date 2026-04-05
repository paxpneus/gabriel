// src/scripts/ml-login-manual.ts
import { chromium } from 'playwright-extra'
// @ts-ignore
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import * as path from 'path'
import * as fs from 'fs'

chromium.use(StealthPlugin())

const SESSION_DIR = path.resolve('./ml_session')
const SALES_URL = 'https://www.mercadolivre.com.br/vendas/omni/lista?filters=&subFilters=&search=&limit=300&offset=0&startPeriod=WITH_DATE_CLOSED_7D_OLD&pagingRequest=true&page=1&sort=DATE_CLOSED_DESC'

async function main() {
    fs.mkdirSync(SESSION_DIR, { recursive: true })

    const context = await chromium.launchPersistentContext(SESSION_DIR, {
        headless: false, // ← abre janela real
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const page = await context.newPage()
    await page.goto(SALES_URL)

    console.log('👉 Faça o login no browser. Quando estiver na página de vendas, pressione ENTER aqui.')
    process.stdin.resume()
    await new Promise(resolve => process.stdin.once('data', resolve))

    console.log('✅ Sessão salva em ./ml_session — pode fechar')
    await context.close()
    process.exit(0)
}

main()