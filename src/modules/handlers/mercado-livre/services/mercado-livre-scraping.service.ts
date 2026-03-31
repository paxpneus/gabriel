import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { MLExcelRow } from './mercado-livre.types';

const SESSION_DIR  = path.resolve('./ml_session');
const DOWNLOAD_DIR = path.resolve('./ml_downloads');
const SALES_URL    = 'https://www.mercadolivre.com.br/vendas/lista';

// "coleta do dia 2 de abril" → extrai dia e mês
const COLLECTION_DATE_REGEX = /coleta do dia (\d{1,2}) de (\w+)/i;

const MONTHS: Record<string, number> = {
    janeiro: 0, fevereiro: 1, março: 2, abril: 3,
    maio: 4, junho: 5, julho: 6, agosto: 7,
    setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

export class MLScrapingService {

    async downloadAndParseExcel(): Promise<MLExcelRow[]> {
        fs.mkdirSync(SESSION_DIR,  { recursive: true });
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

        const context = await chromium.launchPersistentContext(SESSION_DIR, {
            headless: true,
            acceptDownloads: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await context.newPage();

        try {
            await page.goto(SALES_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const isLoginPage = await page.$('input[name="user_id"]');
            if (isLoginPage) {
                throw new Error('[MLScraping] Sessão expirada — necessário login manual com headless: false');
            }

            const exportButton = await page.waitForSelector('button:has-text("Exportar")', {
                timeout: 15000
            });

            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 60000 }),
                exportButton.click(),
            ]);

            const filePath = path.join(DOWNLOAD_DIR, `ml_export_${Date.now()}.xlsx`);
            await download.saveAs(filePath);
            console.log(`[MLScraping] Excel salvo em: ${filePath}`);

            const rows = this.parseExcel(filePath);
            fs.unlinkSync(filePath);

            return rows;

        } finally {
            await page.close();
            await context.close();
        }
    }

    parseExcel(filePath: string): MLExcelRow[] {
        const workbook = XLSX.readFile(filePath);
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];

        // Header real está na linha 6 do Excel (índice 5) — as primeiras linhas são texto introdutório do ML
        const raw: any[] = XLSX.utils.sheet_to_json(sheet, { range: 5 });

        const results: MLExcelRow[] = [];

        for (const row of raw) {
            const orderNumber = row['N.º de venda'];
            const status      = row['Estado'] ?? '';

            if (!orderNumber || !status) continue;

            const match = String(status).match(COLLECTION_DATE_REGEX);
            if (!match) continue; // pedido sem data de coleta — ignora

            const day       = parseInt(match[1], 10);
            const monthName = match[2].toLowerCase();
            const month     = MONTHS[monthName];

            if (month === undefined) {
                console.warn(`[MLScraping] Mês não reconhecido: "${match[2]}" — pedido ${orderNumber}`);
                continue;
            }

            // Ano atual — se o mês já passou, assume ano seguinte
            const now  = new Date();
            let year   = now.getFullYear();
            if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) {
                year += 1;
            }

            const collectionDate = new Date(year, month, day);

            results.push({
                order_number:    String(orderNumber).trim(),
                collection_date: collectionDate,
            });
        }

        console.log(`[MLScraping] ${results.length} pedidos com data de coleta encontrados`);
        return results;
    }
}