// mercado-livre-scraping.service.ts
import * as path from "path";
import * as fs from "fs";
import * as XLSX from "xlsx";
import { BrowserContext, Page } from "playwright";
// @ts-ignore
import { chromium as chromiumExtra } from "playwright-extra";
// @ts-ignore
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { MLExcelRow } from "./mercado-livre.types";
import { parseBRL } from "../../../../shared/utils/normalizers/dotToPoint";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

chromiumExtra.use(StealthPlugin());

// ─── Configurações ────────────────────────────────────────────────────────────
const SESSION_DIR = path.resolve("./ml_session");
const DOWNLOAD_DIR = path.resolve("./ml_downloads");

const LOGIN_URL =
  "https://www.mercadolivre.com/jms/mlb/lgz/msl/login/H4sIAAAAAAAEAz2P0W7DMAhF_8XPVVpF6lLlcT9ikZikaDj2MIk3Vf334U7bGxzuvcDDcVpp8_qd0Y0u4AI7qzu5zKBLkugpGI9sqJDiXzs1CQhEVJTixkfLWTG8o5laksqOpoFd737hVA29Nhmj4vHLbBuwrzgdhG26AJd_h-DnjsU0NqDtAKbgX-vMviaDd9VcxvO51tpFlBlCYjoEuznFbhL3PFlgUa8C84cb2zV2TM5MMyil7fePt_52uQz9MFhxvfY39_wBUeUbRhABAAA/user";
const SALES_URL =
  "https://www.mercadolivre.com.br/vendas/omni/lista?filters=&subFilters=&search=&limit=300&offset=0&startPeriod=WITH_DATE_CLOSED_7D_OLD&pagingRequest=true&page=1&sort=DATE_CLOSED_DESC";

const DOWNLOAD_BTN_SELECTOR =
  'button.report-link:has-text("Baixar arquivo Excel de vendas")';
const MAX_DOWNLOAD_ATTEMPTS = 3;

// Headless: false localmente para depurar login/CAPTCHA, true no servidor
const IS_HEADLESS =
  process.env.NODE_ENV === "production" || process.env.ML_HEADLESS === "true";

const COLLECTION_DATE_REGEX = /coleta do dia (\d{1,2}) de (\w+)/i;

const TOMORROW_DELIVERY_REGEX = /para entregar na coleta de amanhã/i;

const MONTHS: Record<string, number> = {
  janeiro: 0,
  fevereiro: 1,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

const SALE_DATE_REGEX =
  /(\d{1,2}) de ([\w\u00C0-\u017F]+) de (\d{4})\s+(\d{1,2}):(\d{2})/i;

function parseSaleDate(raw: string): Date | null {
  const match = raw.match(SALE_DATE_REGEX);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = MONTHS[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);
  const hours = parseInt(match[4], 10);
  const minutes = parseInt(match[5], 10);

  if (month === undefined || isNaN(day) || isNaN(year)) return null;

  return new Date(Date.UTC(year, month, day, hours, minutes));
}

export class MLScrapingService {
  // ─────────────────────────────────────────────────────────────────────────
  // Ponto de entrada público
  // ─────────────────────────────────────────────────────────────────────────

  async downloadAndParseExcel(): Promise<MLExcelRow[]> {
    if (this.isRunning) {
      console.log("[MLScraping] Já existe uma execução em andamento — pulando");
      return [];
    }
    this.isRunning = true;

    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    const oldFiles = fs
      .readdirSync(DOWNLOAD_DIR)
      .filter((f) => f.endsWith(".xlsx"));
    for (const file of oldFiles) {
      fs.unlinkSync(path.join(DOWNLOAD_DIR, file));
    }

    const context = await this.launchContext();
    const page = await context.newPage();

    try {
      const loggedIn = await this.ensureLoggedIn(context, page);

      if (!loggedIn) {
        alertService.sendAlert({
          severity: "CRITICAL",
          title: "ML Scraping — login manual necessário",
          message:
            "Verificação humana detectada. Scraping pausado até intervenção.",
        });
        throw new Error("[MLScraping] Login manual necessário");
      }

      const filePath = await this.downloadExcelWithRetry(page);
      const rows = this.parseExcel(filePath);
      return rows;
    } finally {
      await page.close();
      await context.close();
      this.isRunning = false;
    }
  }

  private isRunning = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Browser
  // ─────────────────────────────────────────────────────────────────────────

  private async launchContext(
    forceHeadless?: boolean,
  ): Promise<BrowserContext> {
    const headless = forceHeadless ?? IS_HEADLESS;

    console.log(
      `[MLScraping] Iniciando browser — headless: ${headless} (${IS_HEADLESS ? "servidor" : "local"})`,
    );

    return chromiumExtra.launchPersistentContext(SESSION_DIR, {
      headless,
      acceptDownloads: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        // Necessário no servidor para headless sem GPU
        "--disable-gpu",
        "--disable-dev-shm-usage",
        // ...(headless ? ["--disable-gpu", "--single-process"] : []),
      ],
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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
  private async ensureLoggedIn(
    context: BrowserContext,
    page: Page,
  ): Promise<boolean> {
    await page.goto(SALES_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (!this.isLoginWall(page)) {
      console.log("[MLScraping] Sessão ativa — sem necessidade de login");
      return true;
    }

    if (!IS_HEADLESS) {
      console.warn(
        "[MLScraping [LOCAL] Sem sessão - abrindo browser para login manual...",
      );
      await page.goto(LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      return this.waitForManualLoginLocal(context, page);
    }

    console.log(
      "[MLScraping] Sessão expirada — iniciando login automático via Google",
    );
    return this.doGoogleLogin(context, page);
  }

  private isLoginWall(page: Page): boolean {
    const url = page.url();
    return url.includes("/lgz/") || url.includes("/login");
  }

  private isAuthenticated(page: Page): boolean {
    const url = page.url();
    return (
      url.includes("mercadolivre.com.br") &&
      !url.includes("/lgz/") &&
      !url.includes("/login")
    );
  }

  private async doGoogleLogin(
    context: BrowserContext,
    page: Page,
  ): Promise<boolean> {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // Aguarda o botão do Google aparecer e clica
    await page.waitForSelector("text=Continuar com o Google", {
      timeout: 15_000,
    });
    await page.click("text=Continuar com o Google");

    // ML redireciona na mesma aba — aguarda chegar no domínio do Google
    await page.waitForURL("**/accounts.google.com/**", { timeout: 20_000 });

    // Se aparecer seleção de conta, clica na primeira
    try {
      await page.waitForSelector("[data-identifier]", { timeout: 8_000 });
      await page.click("[data-identifier]:first-child");
    } catch {
      console.log(
        "[MLScraping] Sem seleção de conta — pode precisar de login manual",
      );
    }

    // Aguarda voltar para o ML
    await page.waitForURL("**/mercadolivre.com.br/**", { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    await page.goto(SALES_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (this.isLoginWall(page)) {
      console.error(
        "[MLScraping] Login via Google falhou — CAPTCHA, 2FA ou sem conta salva",
      );
      return false;
    }

    console.log("[MLScraping] Login via Google realizado com sucesso");
    return true;
  }

  /**
   * Apenas em ambiente local (headless: false).
   * Reabre o browser visível para o operador resolver o login manualmente.
   * Polling a cada 5s por até 5 minutos.
   */
  private async waitForManualLoginLocal(
    context: BrowserContext,
    page: Page,
  ): Promise<boolean> {
    console.warn(
      "[MLScraping] [LOCAL] Login automático falhou — aguardando login manual na janela aberta...",
    );
    console.warn(
      "[MLScraping] [LOCAL] Você tem 10 minutos para completar o login no browser.",
    );

    alertService.sendAlert({
      severity: "CRITICAL",
      title: "ML Scraping — login manual necessário",
      message:
        "Verificação humana detectada. Scraping pausado até intervenção.",
    });

    const deadline = Date.now() + 10 * 60 * 1_000;

    while (Date.now() < deadline) {
      await page.waitForTimeout(5_000);

      const currentUrl = page.url();
      console.log(`[MLScraping] [LOCAL] URL atual: ${currentUrl}`);

      if (!this.isAuthenticated(page)) {
        console.log(
          "[MLScraping] [LOCAL] Ainda no fluxo de login, aguardando...",
        );
        continue;
      }

      console.log(
        "[MLScraping] [LOCAL] Autenticado! Verificando acesso à página de vendas...",
      );
      await page.waitForTimeout(5_000);
      await page
        .goto(SALES_URL, { waitUntil: "domcontentloaded", timeout: 15_000 })
        .catch(() => {});

      if (!this.isLoginWall(page)) {
        console.log(
          "[MLScraping] [LOCAL] Login manual detectado — sessão salva, continuando",
        );
        return true;
      }
    }

    console.error(
      "[MLScraping] [LOCAL] Timeout de login manual atingido (5 minutos)",
    );
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Download do Excel
  // ─────────────────────────────────────────────────────────────────────────

  private async downloadExcelWithRetry(page: Page): Promise<string> {
    for (
      let globalAttempt = 1;
      globalAttempt <= MAX_DOWNLOAD_ATTEMPTS;
      globalAttempt++
    ) {
      console.log(
        `[MLScraping] Tentativa global ${globalAttempt}/${MAX_DOWNLOAD_ATTEMPTS}`,
      );

      if (globalAttempt > 1) {
        console.log("[MLScraping] Recarregando página (F5)...");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(3_000);
      }

      const filePath = await this.trySingleDownloadCycle(page);
      if (filePath) return filePath;
    }

    throw new Error(
      "[MLScraping] Falha ao baixar Excel após todas as tentativas",
    );
  }

  private async trySingleDownloadCycle(page: Page): Promise<string | null> {
    for (
      let clickAttempt = 1;
      clickAttempt <= MAX_DOWNLOAD_ATTEMPTS;
      clickAttempt++
    ) {
      console.log(
        `[MLScraping] Clique ${clickAttempt}/${MAX_DOWNLOAD_ATTEMPTS} no botão de download`,
      );

      try {
        // Primeiro clique — abre o componente de download
        const downloadBtn = await page.waitForSelector(DOWNLOAD_BTN_SELECTOR, {
          timeout: 15_000,
          state: "visible",
        });
        await downloadBtn.click();
        console.log(
          "[MLScraping] Componente de download aberto, aguardando link de baixar...",
        );

        // Segundo clique — linka no <a> que aparece dentro do componente
        const downloadLink = await page.waitForSelector(
          'a.process-notification-link[href="widget-download-excel"]',
          {
            timeout: 60_000,
            state: "visible",
          },
        );

        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60_000 }),
          downloadLink.click(),
        ]);

        const filePath = path.join(
          DOWNLOAD_DIR,
          `ml_export_${Date.now()}.xlsx`,
        );
        await download.saveAs(filePath);

        try {
          const closeBtn = await page.waitForSelector(
            "button.process-notification-header__close",
            { timeout: 5_000, state: "visible" },
          );
          await closeBtn.click();
          console.log("[MLScraping] Componente de download fechado");
        } catch {
          console.warn(
            "[MLScraping] Não foi possível fechar o componente de download — seguindo",
          );
        }

        console.log(`[MLScraping] Excel salvo em: ${filePath}`);
        return filePath;
      } catch (err) {
        console.warn(
          `[MLScraping] Clique ${clickAttempt} falhou:`,
          (err as Error).message,
        );

        if (clickAttempt === MAX_DOWNLOAD_ATTEMPTS) {
          console.warn("[MLScraping] Ciclo de cliques esgotado — vai para F5");
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
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const raw: any[] = XLSX.utils.sheet_to_json(sheet, { range: 5 });
    const results: MLExcelRow[] = [];

    for (const row of raw) {
      const orderNumber = row["N.º de venda"];
      const status = row["Estado"] ?? "";

      if (!orderNumber || !status) continue;

      const saleDate = parseSaleDate(String(row["Data da venda"] ?? "").trim());

      if (!saleDate) {
        console.warn(
          `[MLScraping] Data da venda inválida para pedido ${orderNumber}: "${row["Data da venda"]}"`,
        );
        continue;
      }

      // ── Determina collection_date ──────────────────────────────────────
      let collectionDate: Date;

      const isReadyForPickup = String(status)
        .toLowerCase()
        .includes("pronto para coleta");

      const isNFeAlreadyEmitted = String(status)
        .toLowerCase()
        .includes("informe a nf-e já emitida");

      const isTomorrowDelivery = TOMORROW_DELIVERY_REGEX.test(String(status));

      if (isReadyForPickup || isTomorrowDelivery || isNFeAlreadyEmitted) {
        // Pedidos prontos para coleta sem data prevista → amanhã (UTC)
        const tomorrow = new Date();
        collectionDate = new Date(
          Date.UTC(
            tomorrow.getUTCFullYear(),
            tomorrow.getUTCMonth(),
            tomorrow.getUTCDate() + 1,
          ),
        );
        console.log(
          `[MLScraping] Pedido ${orderNumber} "pronto para coleta" — collection_date definida para amanhã: ${collectionDate.toISOString()}`,
        );
      } else {
        const match = String(status).match(COLLECTION_DATE_REGEX);
        if (!match) continue;

        const day = parseInt(match[1], 10);
        const monthName = match[2].toLowerCase();
        const month = MONTHS[monthName];

        if (month === undefined) {
          console.warn(
            `[MLScraping] Mês não reconhecido: "${match[2]}" — pedido ${orderNumber}`,
          );
          continue;
        }

        const now = new Date();
        let year = now.getFullYear();
        if (
          month < now.getMonth() ||
          (month === now.getMonth() && day < now.getDate())
        ) {
          year += 1;
        }

        collectionDate = new Date(Date.UTC(year, month, day));
      }
      // ──────────────────────────────────────────────────────────────────

      results.push({
        order_number: String(orderNumber).trim(),
        collection_date: collectionDate,
        sale_date: saleDate,
        sku: String(row["SKU"] ?? "").trim(),
        revenue_brl: parseBRL(row["Receita por produtos (BRL)"]),
        buyer: String(row["Comprador"] ?? "").trim(),
        business: String(row["Negócio"] ?? "").trim(),
        cpf: String(row["CPF"] ?? "").trim(),
      });
    }

    console.log(
      `[MLScraping] ${results.length} pedidos com data de coleta encontrados`,
    );
    return results;
  }
}
