// mercado-livre-scraping.service.ts
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { BrowserContext, Page } from 'playwright';
// @ts-ignore
import { chromium as chromiumExtra } from 'playwright-extra';
// @ts-ignore
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { MLExcelRow } from './mercado-livre.types';

chromiumExtra.use(StealthPlugin());

// ─── Configurações ────────────────────────────────────────────────────────────
const SESSION_DIR  = path.resolve('./ml_session');
const DOWNLOAD_DIR = path.resolve('./ml_downloads');

const LOGIN_URL = 'https://www.mercadolivre.com/jms/mlb/lgz/msl/login/H4sIAAAAAAAEAz2P0W7DMAhF_8XPVVpF6lLlcT9ikZikaDj2MIk3Vf334U7bGxzuvcDDcVpp8_qd0Y0u4AI7qzu5zKBLkugpGI9sqJDiXzs1CQhEVJTixkfLWTG8o5laksqOpoFd737hVA29Nhmj4vHLbBuwrzgdhG26AJd_h-DnjsU0NqDtAKbgX-vMviaDd9VcxvO51tpFlBlCYjoEuznFbhL3PFlgUa8C84cb2zV2TM5MMyil7fePt_52uQz9MFhxvfY39_wBUeUbRhABAAA/user';
const SALES_URL    = 'https://www.mercadolivre.com.br/vendas/omni/lista?filters=TAB_NEXT_DAYS&subFilters=&search=&limit=50&offset=0&startPeriod=';

const DOWNLOAD_BTN_SELECTOR = 'button.report-link:has-text("Baixar arquivo Excel de vendas")';
const MAX_DOWNLOAD_ATTEMPTS = 3;

// Headless: false localmente para depurar login/CAPTCHA, true no servidor
const IS_HEADLESS = process.env.NODE_ENV === 'production' || process.env.ML_HEADLESS === 'true';

const COLLECTION_DATE_REGEX = /coleta do dia (\d{1,2}) de (\w+)/i;

const MONTHS: Record<string, number> = {
    janeiro: 0, fevereiro: 1, março: 2, abril: 3,
    maio: 4, junho: 5, julho: 6, agosto: 7,
    setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

export class MLScrapingService {

    // ─────────────────────────────────────────────────────────────────────────
    // Ponto de entrada público
    // ─────────────────────────────────────────────────────────────────────────

    async downloadAndParseExcel(): Promise<MLExcelRow[]> {
        fs.mkdirSync(SESSION_DIR,  { recursive: true });
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

        const context = await this.launchContext();
        const page    = await context.newPage();

        try {
            const loggedIn = await this.ensureLoggedIn(context, page);

            if (!loggedIn) {
                // TODO: parar fila, deixar jobs em waiting, mandar email pro Gabriel
                console.log('[MLScraping] TODO — login manual necessário: pausar fila + enviar email');
                throw new Error('[MLScraping] Login manual necessário — verificação humana detectada');
            }

            const filePath = await this.downloadExcelWithRetry(page);
            const rows     = this.parseExcel(filePath);
            fs.unlinkSync(filePath);
            return rows;

        } finally {
            await page.close();
            await context.close();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Browser
    // ─────────────────────────────────────────────────────────────────────────

    private async launchContext(forceHeadless?: boolean): Promise<BrowserContext> {
        const headless = forceHeadless ?? IS_HEADLESS;

        console.log(`[MLScraping] Iniciando browser — headless: ${headless} (${IS_HEADLESS ? 'servidor' : 'local'})`);

        return chromiumExtra.launchPersistentContext(SESSION_DIR, {
            headless,
            acceptDownloads: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                // Necessário no servidor para headless sem GPU
                ...(headless ? ['--disable-gpu', '--single-process'] : []),
            ],
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Login
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Verifica sessão. Se expirada:
     *   - Local: abre headless:false para o operador resolver manualmente e aguarda
     *   - Servidor: tenta login automático via Google; se falhar (CAPTCHA/2FA) retorna false
     */
    private async ensureLoggedIn(context: BrowserContext, page: Page): Promise<boolean> {
        await page.goto(SALES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        if (!this.isLoginWall(page)) {
            console.log('[MLScraping] Sessão ativa — sem necessidade de login');
            return true;
        }

        console.log('[MLScraping] Sessão expirada — iniciando login automático via Google');
        return this.doGoogleLogin(context, page);
    }

    private isLoginWall(page: Page): boolean {
        return page.url().includes('/lgz/') || page.url().includes('/login');
    }

    private async doGoogleLogin(context: BrowserContext, page: Page): Promise<boolean> {
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        // Clica no botão "Fazer login com Google"
        const googleBtn = await page.waitForSelector(
            '[class*="nsm7Bb-HzV7m-LgbsSe"]',
            { timeout: 15_000 }
        );
        await googleBtn.click();

        // O popup do Google abre em nova aba
        const popup = await context.waitForEvent('page', { timeout: 20_000 });
        await popup.waitForLoadState('domcontentloaded');

        // Seleciona a primeira conta listada
        const firstAccount = await popup.waitForSelector('[jsname="MBVUVe"]', { timeout: 15_000 });
        await firstAccount.click();

        // Aguarda popup fechar e ML processar o login
        await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(4_000);

        // Confirma se está logado
        await page.goto(SALES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(2_000);

        if (this.isLoginWall(page)) {
            if (!IS_HEADLESS) {
                // Local: abre janela visível para o operador resolver e aguarda até 5 minutos
                return this.waitForManualLoginLocal(context, page);
            }

            console.error('[MLScraping] Login automático falhou — possível CAPTCHA ou 2FA');
            return false;
        }

        console.log('[MLScraping] Login via Google realizado com sucesso');
        return true;
    }

    /**
     * Apenas em ambiente local (headless: false).
     * Reabre o browser visível para o operador resolver o login manualmente.
     * Polling a cada 5s por até 5 minutos.
     */
    private async waitForManualLoginLocal(context: BrowserContext, page: Page): Promise<boolean> {
        console.warn('[MLScraping] [LOCAL] Login automático falhou — aguardando login manual na janela aberta...');
        console.warn('[MLScraping] [LOCAL] Você tem 5 minutos para completar o login no browser.');

        const deadline = Date.now() + 5 * 60 * 1_000;

        while (Date.now() < deadline) {
            await page.waitForTimeout(5_000);
            await page.goto(SALES_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});

            if (!this.isLoginWall(page)) {
                console.log('[MLScraping] [LOCAL] Login manual detectado — sessão salva, continuando');
                return true;
            }
        }

        console.error('[MLScraping] [LOCAL] Timeout de login manual atingido (5 minutos)');
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Download do Excel
    // ─────────────────────────────────────────────────────────────────────────

    private async downloadExcelWithRetry(page: Page): Promise<string> {
        for (let globalAttempt = 1; globalAttempt <= MAX_DOWNLOAD_ATTEMPTS; globalAttempt++) {
            console.log(`[MLScraping] Tentativa global ${globalAttempt}/${MAX_DOWNLOAD_ATTEMPTS}`);

            if (globalAttempt > 1) {
                console.log('[MLScraping] Recarregando página (F5)...');
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
                await page.waitForTimeout(3_000);
            }

            const filePath = await this.trySingleDownloadCycle(page);
            if (filePath) return filePath;
        }

        throw new Error('[MLScraping] Falha ao baixar Excel após todas as tentativas');
    }

    private async trySingleDownloadCycle(page: Page): Promise<string | null> {
        for (let clickAttempt = 1; clickAttempt <= MAX_DOWNLOAD_ATTEMPTS; clickAttempt++) {
            console.log(`[MLScraping] Clique ${clickAttempt}/${MAX_DOWNLOAD_ATTEMPTS} no botão de download`);

            try {
                const downloadBtn = await page.waitForSelector(DOWNLOAD_BTN_SELECTOR, {
                    timeout: 15_000,
                    state: 'visible',
                });

                // Primeiro clique — solicita geração do relatório
                await downloadBtn.click();
                console.log('[MLScraping] Aguardando componente de download carregar...');
                await page.waitForTimeout(3_000);

                // Segundo clique — efetua o download de fato
                const readyBtn = await page.waitForSelector(DOWNLOAD_BTN_SELECTOR, {
                    timeout: 60_000,
                    state: 'visible',
                });

                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 60_000 }),
                    readyBtn.click(),
                ]);

                const filePath = path.join(DOWNLOAD_DIR, `ml_export_${Date.now()}.xlsx`);
                await download.saveAs(filePath);

                console.log(`[MLScraping] Excel salvo em: ${filePath}`);
                return filePath;

            } catch (err) {
                console.warn(`[MLScraping] Clique ${clickAttempt} falhou:`, (err as Error).message);

                if (clickAttempt === MAX_DOWNLOAD_ATTEMPTS) {
                    console.warn('[MLScraping] Ciclo de cliques esgotado — vai para F5');
                    return null;
                }

                await page.waitForTimeout(2_000);
            }
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Parse do Excel
    // ─────────────────────────────────────────────────────────────────────────

    parseExcel(filePath: string): MLExcelRow[] {
        const workbook = XLSX.readFile(filePath);
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];

        const raw: any[] = XLSX.utils.sheet_to_json(sheet, { range: 5 });
        const results: MLExcelRow[] = [];

        for (const row of raw) {
            const orderNumber = row['N.º de venda'];
            const status      = row['Estado'] ?? '';

            if (!orderNumber || !status) continue;

            const match = String(status).match(COLLECTION_DATE_REGEX);
            if (!match) continue;

            const day       = parseInt(match[1], 10);
            const monthName = match[2].toLowerCase();
            const month     = MONTHS[monthName];

            if (month === undefined) {
                console.warn(`[MLScraping] Mês não reconhecido: "${match[2]}" — pedido ${orderNumber}`);
                continue;
            }

            const now  = new Date();
            let year   = now.getFullYear();
            if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) {
                year += 1;
            }

            results.push({
                order_number:    String(orderNumber).trim(),
                collection_date: new Date(year, month, day),
            });
        }

        console.log(`[MLScraping] ${results.length} pedidos com data de coleta encontrados`);
        return results;
    }
}