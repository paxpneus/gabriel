// mercado-livre-scraping.service.ts
import * as path from "path";
import * as fs from "fs";
import { BrowserContext, Page } from "playwright";
// @ts-ignore
import { chromium as chromiumExtra } from "playwright-extra";
// @ts-ignore
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { MLOrderDetailResult } from "./mercado-livre.types";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { nowTz, startOfDayTz } from "../../../../shared/utils/normalizers/date";

chromiumExtra.use(StealthPlugin());

// ─── Configurações ────────────────────────────────────────────────────────────
const SESSION_DIR = path.resolve("./ml_session");

const LOGIN_URL =
  "https://www.mercadolivre.com/jms/mlb/lgz/msl/login/H4sIAAAAAAAEAz2P0W7DMAhF_8XPVVpF6lLlcT9ikZikaDj2MIk3Vf334U7bGxzuvcDDcVpp8_qd0Y0u4AI7qzu5zKBLkugpGI9sqJDiXzs1CQhEVJTixkfLWTG8o5laksqOpoFd737hVA29Nhmj4vHLbBuwrzgdhG26AJd_h-DnjsU0NqDtAKbgX-vMviaDd9VcxvO51tpFlBlCYjoEuznFbhL3PFlgUa8C84cb2zV2TM5MMyil7fePt_52uQz9MFhxvfY39_wBUeUbRhABAAA/user";
const SALES_URL =
  "https://www.mercadolivre.com.br/vendas/omni/lista?filters=&subFilters=&search=&limit=300&offset=0&startPeriod=WITH_DATE_CLOSED_7D_OLD&pagingRequest=true&page=1&sort=DATE_CLOSED_DESC";

// Headless: false localmente para depurar login/CAPTCHA, true no servidor
const IS_HEADLESS =
  process.env.NODE_ENV === "production" || process.env.ML_HEADLESS === "true";

const NFE_ALREADY_EMITTED_REGEX = /informe a nf-e já emitida/i;

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

// Alternância com os nomes de mês conhecidos em vez de `\w+` genérico — a
// textContent da página não tem espaço entre blocos adjacentes (ex: "...de
// setembro" + "Para entregar..." do próximo card viram "setembroPara"
// colados), e um `\w+` guloso engolia esse texto seguinte junto.
const COLLECTION_DATE_REGEX = new RegExp(
  `para entregar na coleta do dia (\\d{1,2}) de (${Object.keys(MONTHS).join("|")})`,
  "i",
);

function buildOrderDetailUrl(orderNumber: string): string {
  const template = process.env.ML_ORDER_DETAIL_URL;
  if (!template) {
    throw new Error(
      "[MLScraping] ML_ORDER_DETAIL_URL não configurada no .env",
    );
  }
  return template.split("{orderNumber}").join(encodeURIComponent(orderNumber));
}

export class MLScrapingService {
  // ─────────────────────────────────────────────────────────────────────────
  // Ponto de entrada público
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Abre a tela de detalhe do pedido no Mercado Livre
   * (ML_ORDER_DETAIL_URL com {orderNumber} substituído) e extrai a
   * collection_date direto do DOM — substitui o download/parse da planilha.
   */
  async scrapeOrderDetail(orderNumber: string): Promise<MLOrderDetailResult | null> {
    if (this.isRunning) {
      console.log("[MLScraping] Já existe uma execução em andamento — pulando");
      return null;
    }
    this.isRunning = true;

    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const context = await this.launchContext();
    const page = await context.newPage();

    try {
      let loggedIn: boolean;
      try {
        loggedIn = await this.ensureLoggedIn(context, page);
      } catch (err) {
        console.error(
          "[MLScraping] Erro durante o fluxo de login:",
          (err as Error).message,
        );
        loggedIn = false;
      }

      if (!loggedIn) {
        alertService.sendAlert({
          severity: "CRITICAL",
          title: "ML Scraping — login manual necessário",
          message:
            "Verificação humana detectada. Scraping pausado até intervenção.",
        });
        throw new Error("[MLScraping] Login manual necessário");
      }

      return await this.extractOrderDetail(page, orderNumber);
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
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        // Necessário no servidor para headless sem GPU
        "--disable-gpu",
        "--disable-dev-shm-usage",
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

  private async captureLoginFailureDebug(
    page: Page,
    label: string,
  ): Promise<void> {
    const debugDir = path.join(SESSION_DIR, "debug");
    fs.mkdirSync(debugDir, { recursive: true });

    const stamp = Date.now();
    const screenshotPath = path.join(debugDir, `${label}_${stamp}.png`);
    const htmlPath = path.join(debugDir, `${label}_${stamp}.html`);

    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      fs.writeFileSync(htmlPath, await page.content());
      console.error(
        `[MLScraping] Debug de falha de login salvo em ${screenshotPath} (URL: ${page.url()})`,
      );
    } catch (debugErr) {
      console.error(
        "[MLScraping] Não foi possível capturar debug da falha de login:",
        (debugErr as Error).message,
      );
    }
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
    try {
      await page.waitForSelector("text=Continuar com o Google", {
        timeout: 15_000,
      });
    } catch (err) {
      await this.captureLoginFailureDebug(page, "google-button-not-found");
      throw err;
    }
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
   * Polling a cada 5s por até 10 minutos.
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
  // Extração da tela de detalhe
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Navega até a tela de detalhe do pedido e deriva collection_date a
   * partir do texto da página, com as mesmas regras de negócio que antes
   * vinham da coluna "Estado" da planilha:
   *   - "Informe a NF-e já emitida" → hoje (o corte 6h-13h que decide se
   *     fica pra hoje ou empurra pra amanhã 6h já é aplicado depois, em
   *     setDelayBasedOnDate/scheduleNfe — não muda aqui).
   *   - "Para entregar na coleta de amanhã" → amanhã.
   *   - "Para entregar na coleta do dia {dia} de {mês}" → aquela data.
   */
  async extractOrderDetail(
    page: Page,
    orderNumber: string,
  ): Promise<MLOrderDetailResult | null> {
    const url = buildOrderDetailUrl(orderNumber);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);

    const bodyText = (await page.textContent("body")) ?? "";

    if (NFE_ALREADY_EMITTED_REGEX.test(bodyText)) {
      const collectionDate = startOfDayTz().toDate();
      console.log(
        `[MLScraping] Pedido ${orderNumber} "informe a nf-e já emitida" — collection_date definida para hoje: ${collectionDate.toISOString()}`,
      );
      return { order_number: orderNumber, collection_date: collectionDate };
    }

    if (TOMORROW_DELIVERY_REGEX.test(bodyText)) {
      const collectionDate = startOfDayTz(nowTz().add(1, "day")).toDate();
      console.log(
        `[MLScraping] Pedido ${orderNumber} "para entregar na coleta de amanhã" — collection_date definida para amanhã: ${collectionDate.toISOString()}`,
      );
      return { order_number: orderNumber, collection_date: collectionDate };
    }

    const match = bodyText.match(COLLECTION_DATE_REGEX);
    if (!match) {
      console.warn(
        `[MLScraping] Pedido ${orderNumber} — nenhuma das três condições de collection_date foi encontrada na página.`,
      );
      return null;
    }

    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const month = MONTHS[monthName];

    if (month === undefined) {
      console.warn(
        `[MLScraping] Mês não reconhecido: "${match[2]}" — pedido ${orderNumber}`,
      );
      return null;
    }

    const now = nowTz();
    let year = now.year();
    if (month < now.month() || (month === now.month() && day < now.date())) {
      year += 1;
    }

    const collectionDate = startOfDayTz(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    ).toDate();

    console.log(
      `[MLScraping] Pedido ${orderNumber} "para entregar na coleta do dia ${day} de ${monthName}" — collection_date: ${collectionDate.toISOString()}`,
    );

    return { order_number: orderNumber, collection_date: collectionDate };
  }
}
