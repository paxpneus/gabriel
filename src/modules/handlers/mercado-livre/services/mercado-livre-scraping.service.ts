import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { MLExcelRow } from './mercado-livre.types';

const SESSION_DIR = path.resolve('./ml_session');
const DOWNLOAD_DIR = path.resolve('./ml_downloads');
const SALES_URL = 'https://www.mercadolivre.com.br/vendas/lista';

export class MLScrapingService {

    async downloadAndParseExcel(): Promise<MLExcelRow[]> {
        // Garante que as pastas existem
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

        const context = await chromium.launchPersistentContext(SESSION_DIR, {
            headless: true,
            acceptDownloads: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'], 
        });

        const page = await context.newPage();

        try {
            await page.goto(SALES_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Verifica se caiu na tela de login
            const isLoginPage = await page.$('input[name="user_id"]');
            if (isLoginPage) {
                throw new Error('[MLScraping] Sessão expirada — necessário login manual com headless: false');
            }

            // Aguarda o botão exportar e clica
            const exportButton = await page.waitForSelector('button:has-text("Exportar")', {
                timeout: 15000
            });

            // Captura o download
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 60000 }),
                exportButton.click(),
            ]);

            const filePath = path.join(DOWNLOAD_DIR, `ml_export_${Date.now()}.xlsx`);
            await download.saveAs(filePath);

            console.log(`[MLScraping] Excel salvo em: ${filePath}`);

            const rows = this.parseExcel(filePath);

            // Limpa o arquivo após parsear
            fs.unlinkSync(filePath);

            return rows;

        } finally {
            // Garante que o Chromium nunca fica pendurado
            await page.close();
            await context.close();
        }
    }

    private parseExcel(filePath: string): MLExcelRow[] {
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw: any[] = XLSX.utils.sheet_to_json(sheet);

        // TODO: ajustar os nomes das colunas conforme o Excel real do ML
        return raw
            .filter(row => row['Número do pedido'] && row['Data de coleta'])
            .map(row => ({
                order_number: String(row['Número do pedido']).trim(),
                collection_date: new Date(row['Data de coleta']),
            }));
    }
}