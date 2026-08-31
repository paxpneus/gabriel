import { alertService } from "./../../../../../../../shared/providers/mail-provider/nodemailer.alert";
// bling-manifestacao.service.ts
import * as path from "path";
import * as fs from "fs";
import { BrowserContext, Page } from "playwright";
// @ts-ignore
import { chromium as chromiumExtra } from "playwright-extra";
// @ts-ignore
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromiumExtra.use(StealthPlugin());

// ─── Configurações ────────────────────────────────────────────────────────────
const SESSION_DIR = path.resolve("./bling_session");

const LOGIN_URL =
  "https://www.bling.com.br/login?r=https%3A%2F%2Fwww.bling.com.br%2Finicio";
const NOTAS_ENTRADA_URL = "https://www.bling.com.br/notas.entrada.php";

// Login é sempre via email/senha, direto das envs — sem fluxo manual.
const BLING_EMAIL = process.env.BLING_EMAIL ?? "";
const BLING_PASSWORD = process.env.BLING_PASSWORD ?? "";

const MAX_ATTEMPTS = 3;

const IS_HEADLESS =
  process.env.NODE_ENV === "production" ||
  process.env.BLING_HEADLESS === "true";

export interface ManifestacaoResult {
  success: boolean;
  notasProcessadas?: number; // não é possível saber o número exato via UI, fica opcional
}

// Erro específico: quando o Bling responde "Nota(s) não manifestada(s)",
// não adianta tentar de novo (as notas continuam as mesmas), então esse
// erro pula o retry e encerra o job direto.
class NotasNaoManifestadasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotasNaoManifestadasError";
  }
}

export class BlingManifestacaoService {
  private isRunning = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Ponto de entrada público
  // ─────────────────────────────────────────────────────────────────────────

  async manifestarNotasComoOperacaoRealizada(): Promise<ManifestacaoResult> {
    if (this.isRunning) {
      console.log(
        "[BlingManifest] Já existe uma execução em andamento — pulando",
      );
      return { success: false };
    }
    this.isRunning = true;

    let context: BrowserContext | undefined;
    let page: Page | undefined;

    try {
      fs.mkdirSync(SESSION_DIR, { recursive: true });

      context = await this.launchContext();
      page = await context.newPage();

      const loggedIn = await this.ensureLoggedIn(context, page);

      if (!loggedIn) {
        alertService.sendAlert({
          severity: "CRITICAL",
          title: "Bling Manifestação — falha de login",
          message:
            "Não foi possível autenticar no Bling com as credenciais configuradas (BLING_EMAIL/BLING_PASSWORD). Verifique se estão corretas ou se houve CAPTCHA/2FA.",
        });
        throw new Error("[BlingManifest] Login necessário");
      }

      await this.runManifestacaoFlowWithRetry(page);

      console.log("[BlingManifest] Fluxo concluído com sucesso");
      return { success: true };
    } catch (err) {
      if (err instanceof NotasNaoManifestadasError) {
        console.warn(
          `[BlingManifest] Encerrando ciclo sem sucesso mas sem falhar o job, (não é erro de automação): ${err.message}`,
        );
        return { success: true };
      }

      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Bling Manifestação — falha na automação",
        message: `Erro: ${(err as Error).message}`,
      });
      throw err;
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      this.isRunning = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Browser
  // ─────────────────────────────────────────────────────────────────────────

  private async launchContext(
    forceHeadless?: boolean,
  ): Promise<BrowserContext> {
    const headless = forceHeadless ?? IS_HEADLESS;

    console.log(
      `[BlingManifest] Iniciando browser — headless: ${headless} (${IS_HEADLESS ? "servidor" : "local"})`,
    );

    return chromiumExtra.launchPersistentContext(SESSION_DIR, {
      headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
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

  private async ensureLoggedIn(
    context: BrowserContext,
    page: Page,
  ): Promise<boolean> {
    await page.goto(NOTAS_ENTRADA_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (!this.isLoginWall(page)) {
      console.log("[BlingManifest] Sessão ativa — sem necessidade de login");
      return true;
    }

    if (!BLING_EMAIL || !BLING_PASSWORD) {
      console.error(
        "[BlingManifest] Sem sessão salva e sem credenciais (BLING_EMAIL/BLING_PASSWORD) configuradas",
      );
      return false;
    }

    console.log(
      "[BlingManifest] Sessão expirada — fazendo login com email/senha",
    );
    return this.doAutoLogin(page);
  }

  private isLoginWall(page: Page): boolean {
    return page.url().includes("/login");
  }

  private async doAutoLogin(page: Page): Promise<boolean> {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // A Bling serve pelo menos duas implementações diferentes do formulário
    // de login (a "clássica", com classes tipo `InputText-input` e botão
    // `.login-button-submit`, e uma redesenhada com PrimeReact — classes
    // `p-inputtext`/`p-button-primary`, sem `.login-button-submit`). Qual
    // delas aparece varia até entre execuções do mesmo processo, então os
    // seletores abaixo evitam classes específicas de layout e usam só o que
    // é estável nas duas versões: o id do usuário, o type="password" da
    // senha (só existe um campo desse tipo na página) e o texto do botão —
    // esperando cada um ficar visível antes de interagir, já que a página é
    // renderizada via JS e pode não estar pronta logo após o domcontentloaded.
    const usernameField = page.locator("#username");
    const passwordField = page.locator('input[type="password"]');
    const submitButton = page.getByRole("button", {
      name: "Entrar",
      exact: true,
    });

    await usernameField.waitFor({ state: "visible", timeout: 15_000 });
    await usernameField.fill(BLING_EMAIL);

    await passwordField.waitFor({ state: "visible", timeout: 15_000 });
    await passwordField.fill(BLING_PASSWORD);

    await submitButton.waitFor({ state: "visible", timeout: 15_000 });
    await submitButton.click();

    await page.waitForTimeout(4_000);
    await page.goto(NOTAS_ENTRADA_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (this.isLoginWall(page)) {
      console.error(
        "[BlingManifest] Login automático falhou — CAPTCHA, 2FA ou credenciais inválidas",
      );
      return false;
    }

    console.log("[BlingManifest] Login automático realizado com sucesso");
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fluxo de manifestação (passos 6 a 15 do passo a passo)
  // ─────────────────────────────────────────────────────────────────────────

  private async runManifestacaoFlowWithRetry(page: Page): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[BlingManifest] Tentativa ${attempt}/${MAX_ATTEMPTS}`);

      try {
        await this.runManifestacaoFlow(page);
        return;
      } catch (err) {
        if (err instanceof NotasNaoManifestadasError) {
          console.warn(
            `[BlingManifest] ${err.message} — encerrando sem tentar de novo`,
          );
          throw err;
        }

        console.warn(
          `[BlingManifest] Tentativa ${attempt} falhou:`,
          (err as Error).message,
        );

        if (attempt === MAX_ATTEMPTS) throw err;

        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(3_000);
      }
    }
  }

  private async runManifestacaoFlow(page: Page): Promise<void> {
    // 6. Clicar em "Notas recebidas"
    await page.click("#tab_1");
    await page.waitForTimeout(1_500);

    // 7. Selecionar "Nenhuma" loja (limpa o filtro de lojas vinculadas)
    await this.selecionarNenhumaLoja(page);

    // 8. Abrir filtros (se não estiverem abertos) e selecionar situação "Todas"
    await this.selecionarSituacaoTodas(page);

    // 9-10. Selecionar período "Este mês" e aplicar
    await this.selecionarPeriodoEsteMes(page);

    // 11. Selecionar todas as notas da lista
    await page.waitForSelector("#selectAlldatatable", { timeout: 15_000 });

    // O <input> real fica coberto pelo <label> customizado que faz o visual
    // do checkbox — por isso clicamos no label, não no input diretamente.
    const selectAllInput = page.locator("#selectAlldatatable");
    const selectAllLabel = page.locator('label[for="selectAlldatatable"]');

    const isChecked = await selectAllInput.isChecked().catch(() => false);
    if (!isChecked) {
      await selectAllLabel.click({ timeout: 10_000 });
    }
    await page.waitForTimeout(500);

    // 12-13. Selecionar "Operação realizada" no select de ações
    await page.selectOption("#operacaoManifesto", "210200");
    await page.waitForTimeout(500);

    // 14. Clicar em "Manifestar"
    await page.click("#btnManifestarLote");

    // Se existir um modal de confirmação intermediário (abrirManifestar() pode
    // abrir um popup de confirmação), tenta confirmar. Ajuste o seletor abaixo
    // caso o seu ambiente tenha um botão de confirmação com texto diferente.
    const confirmarBtn = page
      .locator('button:has-text("Confirmar"), button:has-text("Manifestar")')
      .last();
    await confirmarBtn.click({ timeout: 5_000 }).catch(() => {
      console.log(
        "[BlingManifest] Nenhum modal de confirmação adicional detectado — seguindo",
      );
    });

    // 15. Esperar mensagem de sucesso OU de falha ("Nota(s) não manifestada(s)")
    const successLocator = page.locator(
      '#cabecalhoSucesso:has-text("manifestada")',
    );
    const failureLocator = page.locator(
      'h3:has-text("Nota(s) não manifestada(s)")',
    );

    await Promise.race([
      successLocator.waitFor({ state: "visible", timeout: 60_000 }),
      failureLocator.waitFor({ state: "visible", timeout: 60_000 }),
    ]);

    if (await failureLocator.isVisible().catch(() => false)) {
      throw new NotasNaoManifestadasError(
        "Bling retornou 'Nota(s) não manifestada(s)' — alguma(s) nota(s) não pôde(puderam) ser manifestada(s)",
      );
    }

    console.log("[BlingManifest] Notas manifestadas com sucesso");
  }

  private async selecionarNenhumaLoja(page: Page): Promise<void> {
    const container = page.locator("#lojasVinculadas-container");

    // O treeselect pode precisar ser aberto antes de mostrar as opções.
    // Tenta clicar no container/trigger; se as opções já estiverem visíveis,
    // o clique é inofensivo.
    await container.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const nenhumaLabel = page.locator('label#lbl0[for="ckb0"]');
    await nenhumaLabel
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {
        console.warn(
          "[BlingManifest] Opção 'Nenhuma' loja não apareceu — verifique se o treeselect precisa de outro trigger",
        );
      });
    await nenhumaLabel.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  private async selecionarSituacaoTodas(page: Page): Promise<void> {
    const situacaoSelect = page.locator("#filter-situacao-recebidas");

    if (!(await situacaoSelect.isVisible().catch(() => false))) {
      await page.click("#open-filter");
      await situacaoSelect.waitFor({ state: "visible", timeout: 10_000 });
    }

    await situacaoSelect.selectOption("");
    await page.waitForTimeout(500);
  }

  private async selecionarPeriodoEsteMes(page: Page): Promise<void> {
    await page.click("#dtButton");

    const dialog = page.locator("#dialog-picker");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });

    await dialog.getByText("Este mês", { exact: true }).click();

    await dialog.locator('button.Button--primary:has-text("Filtrar")').click();
    await page.waitForTimeout(1_500);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Execução direta via `npx ts-node este-arquivo.ts`
// Isso só roda quando o arquivo é chamado diretamente, não quando é
// importado por outro módulo (ex: um controller/cron chamando a classe).
// ─────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  new BlingManifestacaoService()
    .manifestarNotasComoOperacaoRealizada()
    .then((result) => {
      console.log("[BlingManifest] Resultado:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[BlingManifest] Falhou:", err);
      process.exit(1);
    });
}
