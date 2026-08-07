/**
* bling-stock-movements-scrape.script.ts
*
* Extrai TODOS os lançamentos de estoque (entradas, saídas e balanços) de
* TODOS os produtos do tipo "UNIT" mapeados pra Bling, usando o endpoint
* interno da aplicação web (o mesmo que aparece na aba Network quando você
* navega em https://www.bling.com.br/estoque.php#/ e pesquisa um produto):
*
*   GET /Api/v3/estoques/list/lancamentos
*       ?criterio=ultimos&idProduto={id}&idDeposito={id}&pagina={n}
*
* IMPORTANTE: esse NÃO é o endpoint da API pública v3 (OAuth/bearer token).
* É o endpoint interno do site, autenticado por cookies de sessão
* (PHPSESSID, PCSID, bling_oauth_refresh, etc). Por isso reaproveitamos
* exatamente o mesmo fluxo de login do BlingManifestacaoService: abrimos
* um browser (playwright-extra + stealth) com contexto persistente, e
* chamamos o endpoint JSON com um `fetch()` executado DENTRO da própria
* página (via `page.evaluate`) — e não com a APIRequestContext separada
* do Playwright (`context.request`). Isso importa: a APIRequestContext
* manda seu próprio User-Agent, diferente do usado pelo browser; bater na
* API autenticada com uma "assinatura" diferente da que fez login é
* exatamente o tipo de coisa que sistemas anti-bot usam pra invalidar a
* sessão. Rodando o fetch de dentro da página, é literalmente o browser
* fazendo a chamada — mesmo UA, mesmos cookies, mesmos headers — igual a
* abrir a aba Network manualmente.
*
* Fonte dos produtos:
*   Mesma lógica do update-product-volumes.script.ts — produtos que têm
*   `integration_mappings` do tipo PRODUCT apontando pra integração da
*   Bling, filtrados por `p.type = 'UNIT'` (só produtos unitários — kits
*   e outros tipos ficam de fora, já que a lógica de lançamento de estoque
*   por unidade não se aplica a eles). `external_id` = id do produto NA
*   BLING (usado nas chamadas).
*
* Depósito(s):
*   A Bling exige `idDeposito` no request. Se sua conta tem só um depósito,
*   configure BLING_DEPOSITO_IDS com um único id. Se tiver mais de um
*   depósito e quiser os lançamentos de todos, passe vários separados por
*   vírgula — o script itera cada produto em cada depósito informado.
*
* Paginação:
*   Cada página tem no máximo `registrosPagina` (normalmente 100)
*   lançamentos. O script para de paginar um produto/depósito quando:
*     - a página retornar `data: []` (acabaram os lançamentos), OU
*     - passar do total de páginas calculado por `paginacao.totalRegistros`, OU
*     - atingir MAX_PAGES, caso um teto explícito tenha sido configurado
*
* Progresso:
*   Antes de começar, o script conta quantos produtos UNIT mapeados existem
*   no total (considerando também os depósitos informados) e loga, a cada
*   produto/depósito processado, algo como:
*     [BlingStockScrape] Progresso: 37/482 (7.7%) — Produto 12345 (Pneu X) depósito 14887583131: 18 lançamento(s)
*
* Resiliência:
*   - Delay configurável entre páginas (PAGE_DELAY_MS) e entre produtos
*     (PRODUCT_DELAY_MS), pra não martelar o servidor.
*   - Se a sessão cair no meio da execução (a resposta vem como HTML de
*     login em vez de JSON), o script tenta re-logar uma vez e continua.
*   - Escreve o CSV incrementalmente (append por produto), então se o
*     processo cair no meio, o arquivo parcial é preservado, mas NÃO é
*     registrado como fonte válida para a sincronização.
*   - Suporta retomar uma execução: se RESUME=true, lê o CSV existente e
*     pula produtos que já tenham linhas gravadas (assume que um produto
*     só é reprocessado do zero, não incrementalmente).
*
* Uso:
*   BLING_INTEGRATION_ID=<uuid> BLING_DEPOSITO_IDS=14887583131 \
*     npx ts-node scripts/bling-stock-movements-scrape.script.ts
*
*   Testar com poucos produtos:
*   BLING_INTEGRATION_ID=<uuid> BLING_DEPOSITO_IDS=14887583131 MAX_PRODUCTS=3 \
*     npx ts-node scripts/bling-stock-movements-scrape.script.ts
*
* Variáveis de ambiente:
*   BLING_INTEGRATION_ID       (obrigatória) uuid da integração Bling em `integrations`
*   BLING_DEPOSITO_IDS         (obrigatória) um ou mais idDeposito, separados por vírgula
*   BLING_EMAIL / BLING_PASSWORD  credenciais pra login automático (mesmas do manifestação)
*   STOCK_MOVEMENTS_CSV_DIR    (default: ./data/stock-movements)
*   MAX_PAGES                  (default: 0 = sem teto) páginas por produto/depósito
*   PAGE_DELAY_MS               (default: 400)  delay entre páginas do mesmo produto
*   PRODUCT_DELAY_MS            (default: 1500) delay entre produtos
*   BATCH_SIZE                  (default: 200)  produtos lidos do banco por página
*   MAX_PRODUCTS                (default: 0 = sem limite) útil pra testar
*   RESUME                      (default: true) pula produtos já presentes no CSV
*   BLING_HEADLESS               (default: true em produção)
*/


import * as path from "path";
import * as fs from "fs";
import { QueryTypes } from "sequelize";
import { BrowserContext, Page } from "playwright";
// @ts-ignore
import { chromium as chromiumExtra } from "playwright-extra";
// @ts-ignore
import StealthPlugin from "puppeteer-extra-plugin-stealth";


import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import stockMovementSourceDataService from "../../modules/inventory/stock/stock-movement-source-data/stock-movement-source-data.service";


chromiumExtra.use(StealthPlugin());


// ─── Configuração ───────────────────────────────────────────────────────────


const SESSION_DIR = path.resolve("./bling_session");


const LOGIN_URL =
 "https://www.bling.com.br/login?r=https%3A%2F%2Fwww.bling.com.br%2Finicio";
const ESTOQUE_URL = "https://www.bling.com.br/estoque.php";
const LANCAMENTOS_ENDPOINT =
 "https://www.bling.com.br/Api/v3/estoques/list/lancamentos";


const BLING_EMAIL = process.env.BLING_EMAIL ?? "";
const BLING_PASSWORD = process.env.BLING_PASSWORD ?? "";


const BLING_INTEGRATION_ID = process.env.BLING_INTEGRATION_ID ?? "";
const BLING_DEPOSITO_IDS = (process.env.BLING_DEPOSITO_IDS ?? "")
 .split(",")
 .map((s) => s.trim())
 .filter(Boolean);


const CSV_STORAGE_DIR = path.resolve(
 process.env.STOCK_MOVEMENTS_CSV_DIR ?? "./data/stock-movements",
);
const INITIAL_CUTOFF_DATE = new Date(2024, 6, 1, 0, 0, 0);
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 0);
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS ?? 400);
const PRODUCT_DELAY_MS = Number(process.env.PRODUCT_DELAY_MS ?? 1500);
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 200);
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS ?? 0);
const RESUME = process.env.RESUME !== "false";


const IS_HEADLESS =
 process.env.NODE_ENV === "production" ||
 process.env.BLING_HEADLESS === "true";


function sleep(ms: number) {
 return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function formatDateForBling(date: Date): string {
 return new Intl.DateTimeFormat("pt-BR", {
   day: "2-digit",
   month: "2-digit",
   year: "numeric",
 }).format(date);
}

function formatDateForFilename(date: Date): string {
 const year = date.getFullYear();
 const month = String(date.getMonth() + 1).padStart(2, "0");
 const day = String(date.getDate()).padStart(2, "0");
 return `${year}-${month}-${day}`;
}

type ScrapeWindow = {
 cutoffDate: Date;
 extractionDate: Date;
 csvPath: string;
};


// ─── CSV ─────────────────────────────────────────────────────────────────


const CSV_HEADER = [
 "product_internal_id",
 "product_name",
 "bling_product_id",
 "bling_deposito_id",
 "lancamento_id",
 "es",
 "tipo_entrada",
 "data",
 "data_brz",
 "hora",
 "entrada",
 "saida",
 "balanco",
 "quantidade",
 "saldo_anterior",
 "preco",
 "custo_lancamento",
 "obs",
 "obs_original",
 "origem_tipo",
 "origem_numero",
 "origem_titulo",
 "id_origem",
];


function csvEscape(value: unknown): string {
 if (value === null || value === undefined) return "";
 const str = String(value);
 if (/[",\n;]/.test(str)) {
   return `"${str.replace(/"/g, '""')}"`;
 }
 return str;
}


function ensureCsvHeader(filePath: string) {
 if (!fs.existsSync(filePath)) {
   fs.writeFileSync(filePath, CSV_HEADER.join(",") + "\n", "utf8");
 }
}


function appendCsvRows(filePath: string, rows: Array<Record<string, unknown>>) {
 if (!rows.length) return;
 const lines = rows.map((row) =>
   CSV_HEADER.map((col) => csvEscape(row[col])).join(","),
 );
 fs.appendFileSync(filePath, lines.join("\n") + "\n", "utf8");
}


/**
* Pra suportar RESUME=true: lê os bling_product_id já presentes no CSV
* existente (coluna combinada com bling_deposito_id, já que um produto pode
* ter sido feito parcialmente em um depósito e não em outro).
*/
function readAlreadyScrapedKeys(filePath: string): Set<string> {
 const done = new Set<string>();
 if (!fs.existsSync(filePath)) return done;


 const content = fs.readFileSync(filePath, "utf8");
 const lines = content.split("\n").slice(1); // pula header
 const idxProduto = CSV_HEADER.indexOf("bling_product_id");
 const idxDeposito = CSV_HEADER.indexOf("bling_deposito_id");


 for (const line of lines) {
   if (!line.trim()) continue;
   // parsing simples — os campos que colocamos entre aspas não têm vírgula
   // nas duas primeiras colunas usadas aqui, então split direto é seguro
   // o suficiente pra esse propósito de indexação.
   const cols = line.split(",");
   const produto = cols[idxProduto];
   const deposito = cols[idxDeposito];
   if (produto && deposito) {
     done.add(`${produto}::${deposito}`);
   }
 }
 return done;
}


// ─── Produtos (banco) ───────────────────────────────────────────────────────


interface ProductMappingRow {
 internal_id: string;
 external_id: string; // id do produto na Bling
 name: string;
}


/**
* Só produtos do tipo "UNIT" (produto unitário, não kit/composição/etc).
*/
const PRODUCT_TYPE_FILTER_SQL = `AND p.type = 'UNIT'`;


async function fetchProductMappingsCount(integrationId: string): Promise<number> {
 const result = await sequelize.query<{ count: string }>(
   `
   SELECT COUNT(*)::text AS count
   FROM integration_mappings im
   JOIN products p ON p.id = im.internal_id::uuid
   WHERE im.entity_type = 'PRODUCT'
     AND im.integrations_id = :integrationId::uuid
     ${PRODUCT_TYPE_FILTER_SQL}
   `,
   {
     replacements: { integrationId },
     type: QueryTypes.SELECT,
   },
 );
 return Number(result[0]?.count ?? 0);
}


async function fetchProductMappingsPage(
 integrationId: string,
 limit: number,
 offset: number,
): Promise<ProductMappingRow[]> {
 return sequelize.query(
   `
   SELECT
     im.internal_id,
     im.external_id,
     p.name
   FROM integration_mappings im
   JOIN products p ON p.id = im.internal_id::uuid
   WHERE im.entity_type = 'PRODUCT'
     AND im.integrations_id = :integrationId::uuid
     ${PRODUCT_TYPE_FILTER_SQL}
   ORDER BY im.id ASC
   LIMIT :limit OFFSET :offset
   `,
   {
     replacements: { integrationId, limit, offset },
     type: QueryTypes.SELECT,
   },
 );
}


// ─── Login (mesmo padrão do BlingManifestacaoService) ───────────────────────


async function launchContext(): Promise<BrowserContext> {
 console.log(
   `[BlingStockScrape] Iniciando browser — headless: ${IS_HEADLESS}`,
 );
 return chromiumExtra.launchPersistentContext(SESSION_DIR, {
   headless: IS_HEADLESS,
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


async function isLoginWall(page: Page): Promise<boolean> {
 if (page.url().includes("/login")) return true;


 // Checagem extra: na tela de estoque, quando realmente logado, o campo
 // de busca #pesquisa-mini existe no DOM. Se a URL não é /login mas esse
 // campo também não aparece, tratamos como "não logado" — mais seguro
 // do que confiar só na URL (a Bling pode redirecionar pra telas
 // intermediárias de segurança que não contêm "/login" no path).
 const hasSearchInput = await page
   .locator("#pesquisa-mini")
   .count()
   .then((count) => count > 0)
   .catch(() => false);


 return !hasSearchInput;
}


async function doAutoLogin(page: Page): Promise<boolean> {
 await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });


 await page.fill("#username", BLING_EMAIL);


 const continuarBtn = page.locator(".login-button-submit");
 if (await continuarBtn.isVisible().catch(() => false)) {
   await continuarBtn.click();
 }


 await page
   .waitForSelector('input[type="password"].InputText-input', { timeout: 10_000 })
   .catch(() => {});


 await page.fill('input[type="password"].InputText-input', BLING_PASSWORD);
 await page.click(".login-button-submit");


 await page.waitForTimeout(4_000);
 await page.goto(ESTOQUE_URL, { waitUntil: "networkidle", timeout: 30_000 });
 // Pequena folga extra pra cookies/JS de tracking assentarem antes de
 // começarmos a bater na API — evita falsos positivos de "sessão caída"
 // logo em seguida a um login que na verdade funcionou.
 await page.waitForTimeout(1_500);


 if (await isLoginWall(page)) {
   console.error(
     "[BlingStockScrape] Login automático falhou — CAPTCHA, 2FA ou credenciais inválidas",
   );
   return false;
 }


 console.log("[BlingStockScrape] Login automático realizado com sucesso");
 return true;
}


async function ensureLoggedIn(page: Page): Promise<boolean> {
 await page.goto(ESTOQUE_URL, { waitUntil: "networkidle", timeout: 30_000 });


 if (!(await isLoginWall(page))) {
   console.log("[BlingStockScrape] Sessão ativa — sem necessidade de login");
   return true;
 }


 if (!BLING_EMAIL || !BLING_PASSWORD) {
   console.error(
     "[BlingStockScrape] Sem sessão salva e sem credenciais (BLING_EMAIL/BLING_PASSWORD)",
   );
   return false;
 }


 console.log("[BlingStockScrape] Sessão expirada — fazendo login com email/senha");
 return doAutoLogin(page);
}


// ─── Chamada ao endpoint de lançamentos ─────────────────────────────────────


interface LancamentoRaw {
 id: string;
 es: string;
 tipoEntrada: string;
 data: string;
 dataBrz: string;
 hora: string;
 entrada: unknown;
 saida: unknown;
 balanco: unknown;
 quantidade: unknown;
 saldoAnterior: unknown;
 preco: unknown;
 custoLancamento: unknown;
 obs: unknown;
 obsOriginal: unknown;
 idOrigem: unknown;
 linkOrigem:
   | {
       hasNFe?: { numero?: string; title?: string; tipo?: string };
       origemVendas?: { numero?: string; title?: string; tipo?: string };
     }
   | [];
}


interface LancamentosResponse {
 data: LancamentoRaw[];
 paginacao?: { totalRegistros?: string; registrosPagina?: string };
}


interface PageFetchResult {
 ok: boolean;
 status: number;
 contentType: string | null;
 body: string;
 errorMessage?: string;
}

/** Retorna somente o tipo/forma do valor; nunca registra o corpo da Bling. */
function describePayloadValue(value: unknown): string {
 if (value === null) return "null";
 if (Array.isArray(value)) return "array";
 if (typeof value === "object") {
   const keys = Object.keys(value as Record<string, unknown>).slice(0, 10);
   return `object(chaves=${keys.length ? keys.join(",") : "nenhuma"})`;
 }
 return typeof value;
}

/** Resume o envelope de erro da Bling sem registrar o payload completo. */
function describeBlingErrorEnvelope(value: unknown): string {
 if (!value || typeof value !== "object" || Array.isArray(value)) {
   return describePayloadValue(value);
 }

 const payload = value as Record<string, unknown>;
 const summarize = (field: "status" | "title" | "message") => {
   const fieldValue = payload[field];
   if (typeof fieldValue !== "string" && typeof fieldValue !== "number") {
     return `${field}=${describePayloadValue(fieldValue)}`;
   }
   const text = String(fieldValue).replace(/\s+/g, " ").slice(0, 300);
   return `${field}=${JSON.stringify(text)}`;
 };

 return ["status", "title", "message"]
   .map((field) => summarize(field as "status" | "title" | "message"))
   .join(", ");
}

/**
 * A Bling responde com este envelope, em vez de `data: []`, quando o filtro
 * não encontra lançamentos. Só esse caso explícito pode ser tratado como
 * lista vazia; outros objetos em `data` continuam sendo falhas.
 */
function isNoStockMovementsEnvelope(value: unknown): boolean {
 if (!value || typeof value !== "object" || Array.isArray(value)) return false;

 const payload = value as Record<string, unknown>;
 return (
   String(payload.status ?? "").trim().toLowerCase() === "success" &&
   String(payload.title ?? "").trim().toLowerCase() ===
     "sem lançamentos de estoque"
 );
}

function describeScrapeError(error: unknown): string {
 if (error instanceof Error) return `${error.name}: ${error.message}`;
 return `erro não-Error: ${String(error)}`;
}

function describeCombination(
 produto: ProductMappingRow,
 idDeposito: string,
): string {
 return (
   `produto="${produto.name}" internal_id=${produto.internal_id} ` +
   `bling_product_id=${produto.external_id} deposito_id=${idDeposito}`
 );
}


/**
* Faz o GET no endpoint interno rodando um `fetch()` DENTRO da própria
* página (via page.evaluate), em vez de usar a APIRequestContext separada
* do Playwright (`context.request`).
*
* Por quê: a APIRequestContext do Playwright manda seu próprio User-Agent
* (diferente do UA configurado no browser). Bater na API com uma sessão
* que "nasceu" num browser com UA X, mas usando um cliente HTTP com UA Y,
* é exatamente o tipo de inconsistência que sistemas anti-bot detectam e
* usam pra invalidar a sessão — o que batia com o sintoma observado (login
* funcionava, mas a chamada seguinte já vinha com sessão "caída").
*
* Rodando o fetch de dentro da página, é literalmente o browser fazendo a
* chamada: mesmo UA, mesmos cookies, mesmos headers automáticos do
* navegador — indistinguível de abrir a aba Network manualmente.
*/
async function fetchLancamentosPage(
 page: Page,
 idProduto: string,
 idDeposito: string,
 pagina: number,
 cutoffDate: Date,
 extractionDate: Date,
): Promise<{ parsed: LancamentosResponse | null; raw: PageFetchResult }> {
 const url =
   `${LANCAMENTOS_ENDPOINT}?criterio=ultimos&idProduto=${encodeURIComponent(idProduto)}` +
   `&idDeposito=${encodeURIComponent(idDeposito)}&pagina=${pagina}` +
   `&dataIni=${encodeURIComponent(formatDateForBling(cutoffDate))}` +
   `&dataFim=${encodeURIComponent(formatDateForBling(extractionDate))}` +
   `&tipoLancamento=&tipoOrigem=`;


 const raw = await page.evaluate<PageFetchResult, string>(async (fetchUrl) => {
   try {
     const res = await fetch(fetchUrl, {
       method: "GET",
       credentials: "include", // garante envio dos cookies de sessão da própria página
       headers: {
         Accept: "*/*",
         "x-api-revision": "3.1.0",
       },
     });
     const body = await res.text();
     return {
       ok: res.ok,
       status: res.status,
       contentType: res.headers.get("content-type"),
       body,
     };
   } catch (err: any) {
     return {
       ok: false,
       status: 0,
       contentType: null,
       body: "",
       errorMessage: String(err?.message ?? err),
     };
   }
 }, url);


 if (!raw.ok) return { parsed: null, raw };


 const contentType = raw.contentType ?? "";
 if (!contentType.includes("application/json")) return { parsed: null, raw };


 try {
   const parsed: unknown = JSON.parse(raw.body);
   if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
     return { parsed: null, raw };
   }
   return { parsed: parsed as LancamentosResponse, raw };
 } catch {
   return { parsed: null, raw };
 }
}


function extractOrigem(linkOrigem: LancamentoRaw["linkOrigem"]) {
 if (!linkOrigem || Array.isArray(linkOrigem)) {
   return { tipo: "", numero: "", titulo: "" };
 }
 const origem = linkOrigem.hasNFe ?? linkOrigem.origemVendas;
 if (!origem) return { tipo: "", numero: "", titulo: "" };
 return {
   tipo: origem.tipo ?? "",
   numero: origem.numero ?? "",
   titulo: origem.title ?? "",
 };
}


function lancamentoToRow(
 produto: ProductMappingRow,
 idDeposito: string,
 lancamento: LancamentoRaw,
): Record<string, unknown> {
 const origem = extractOrigem(lancamento.linkOrigem);
 return {
   product_internal_id: produto.internal_id,
   product_name: produto.name,
   bling_product_id: produto.external_id,
   bling_deposito_id: idDeposito,
   lancamento_id: lancamento.id,
   es: lancamento.es,
   tipo_entrada: lancamento.tipoEntrada,
   data: lancamento.data,
   data_brz: lancamento.dataBrz,
   hora: lancamento.hora,
   entrada: lancamento.entrada,
   saida: lancamento.saida,
   balanco: lancamento.balanco,
   quantidade: lancamento.quantidade,
   saldo_anterior: lancamento.saldoAnterior,
   preco: lancamento.preco,
   custo_lancamento: lancamento.custoLancamento,
   obs: lancamento.obs,
   obs_original: lancamento.obsOriginal,
   origem_tipo: origem.tipo,
   origem_numero: origem.numero,
   origem_titulo: origem.titulo,
   id_origem: lancamento.idOrigem,
 };
}


/**
* Busca todos os lançamentos de um produto/depósito, paginando até acabar
* ou até MAX_PAGES. Se a sessão cair no meio (resposta null), tenta
* re-logar UMA vez e continua da mesma página.
*/
async function scrapeProdutoDeposito(
 page: Page,
 produto: ProductMappingRow,
 idDeposito: string,
 window: ScrapeWindow,
): Promise<Record<string, unknown>[]> {
 const rows: Record<string, unknown>[] = [];
 let pagina = 1;
 let totalPaginas = Infinity;
 let reauthAttempted = false;


 while (pagina <= (MAX_PAGES ? Math.min(MAX_PAGES, totalPaginas) : totalPaginas)) {
   let { parsed: resp, raw } = await fetchLancamentosPage(
     page,
     produto.external_id,
     idDeposito,
     pagina,
     window.cutoffDate,
     window.extractionDate,
   );


   if (!resp && !reauthAttempted) {
     console.warn(
       `[BlingStockScrape] Sessão parece ter caído para ${describeCombination(produto, idDeposito)} ` +
         `(página=${pagina}, status=${raw.status}, ` +
         `content-type=${raw.contentType ?? "?"}) — re-logando...`,
     );
     reauthAttempted = true;
     const ok = await ensureLoggedIn(page);
     if (!ok) {
       throw new Error("Falha ao re-autenticar durante o scraping");
     }
     ({ parsed: resp, raw } = await fetchLancamentosPage(
       page,
       produto.external_id,
       idDeposito,
       pagina,
       window.cutoffDate,
       window.extractionDate,
     ));
   }


   if (!resp) {
     console.warn(
       `[BlingStockScrape] Resposta inválida para ${describeCombination(produto, idDeposito)} ` +
         `(página=${pagina}, status=${raw.status}, ` +
         `content-type=${raw.contentType ?? "?"}, fetch-error=${raw.errorMessage ?? "nenhum"}) ` +
         `— abortando produto/depósito atual`,
     );
     break;
   }


   // A Bling pode representar uma lista vazia por `data: []` ou por este
   // envelope explícito de sucesso. O segundo é auditado com os filtros da
   // consulta, mas não bloqueia a extração nem o registro da fonte CSV.
   if (!Array.isArray(resp.data)) {
     if (isNoStockMovementsEnvelope(resp.data)) {
       console.warn(
         `[BlingStockScrape] Bling não encontrou lançamentos para os filtros: ` +
           `${describeCombination(produto, idDeposito)} ` +
           `período=${formatDateForBling(window.cutoffDate)} a ${formatDateForBling(window.extractionDate)}; ` +
           `detalhes: ${describeBlingErrorEnvelope(resp.data)}. Tratando como lista vazia.`,
       );
       break;
     }
     throw new Error(
       `Resposta da Bling inválida na página ${pagina}: data deveria ser array, ` +
         `mas recebeu ${describePayloadValue(resp.data)}; ` +
         `detalhes: ${describeBlingErrorEnvelope(resp.data)}`,
     );
   }
   const data = resp.data;
   if (data.length === 0) break;


   for (const [index, lancamento] of data.entries()) {
     if (!lancamento || typeof lancamento !== "object") {
       throw new Error(
         `Resposta JSON inválida na página ${pagina}: lançamento ${index + 1} ` +
           `deveria ser objeto, mas recebeu ${describePayloadValue(lancamento)}`,
       );
     }
     rows.push(lancamentoToRow(produto, idDeposito, lancamento));
   }


   const totalRegistros = Number(resp.paginacao?.totalRegistros ?? 0);


   const registrosPagina = Number(resp.paginacao?.registrosPagina ?? data.length) || 1;
   if (totalRegistros > 0) {
     totalPaginas = Math.ceil(totalRegistros / registrosPagina);
   }


   pagina++;
   if (pagina <= (MAX_PAGES ? Math.min(MAX_PAGES, totalPaginas) : totalPaginas)) {
     await sleep(PAGE_DELAY_MS);
   }
 }


 return rows;
}


// ─── Bootstrap ──────────────────────────────────────────────────────────────


async function bootstrap() {
 await sequelize.authenticate();
 setupAssociations();
}

async function createScrapeWindow(): Promise<ScrapeWindow> {
 const latestSource = await stockMovementSourceDataService.findOne({
   order: [["extraction_date", "DESC"]],
 });
 const cutoffDate = latestSource
   ? new Date(latestSource.extraction_date)
   : INITIAL_CUTOFF_DATE;
 const extractionDate = new Date();

 if (Number.isNaN(cutoffDate.getTime())) {
   throw new Error("extraction_date inválida no último CSV de estoque.");
 }

 const csvPath = path.join(
   CSV_STORAGE_DIR,
   `${formatDateForFilename(cutoffDate)}-${formatDateForFilename(extractionDate)}.csv`,
 );

 return { cutoffDate, extractionDate, csvPath };
}


// ─── Main ───────────────────────────────────────────────────────────────────


async function main() {
 if (!BLING_INTEGRATION_ID) {
   throw new Error(
     "BLING_INTEGRATION_ID não definido. Passe o uuid da integração Bling (tabela `integrations`).",
   );
 }
 if (!BLING_DEPOSITO_IDS.length) {
   throw new Error(
     "BLING_DEPOSITO_IDS não definido. Passe um ou mais idDeposito separados por vírgula.",
   );
 }


 await bootstrap();
 const window = await createScrapeWindow();


 const totalProdutosUnit = await fetchProductMappingsCount(BLING_INTEGRATION_ID);
 const totalCombinacoes = MAX_PRODUCTS
   ? Math.min(totalProdutosUnit, MAX_PRODUCTS) * BLING_DEPOSITO_IDS.length
   : totalProdutosUnit * BLING_DEPOSITO_IDS.length;


 console.log("═".repeat(60));
 console.log("📦  Scraping de lançamentos de estoque — Bling");
 console.log(`  Filtro de produto: type = 'UNIT'`);
 console.log(`  Produtos UNIT mapeados encontrados: ${totalProdutosUnit}`);
 console.log(`  Depósitos configurados: ${BLING_DEPOSITO_IDS.length}`);
 console.log(`  Total de combinações produto/depósito a processar: ${totalCombinacoes}`);
 console.log(`  Período: ${formatDateForBling(window.cutoffDate)} a ${formatDateForBling(window.extractionDate)}`);
 console.log(`  CSV de saída: ${window.csvPath}`);
 console.log(`  Máx. páginas/produto/depósito: ${MAX_PAGES || "sem limite"}`);
 console.log(`  Delay entre páginas: ${PAGE_DELAY_MS}ms | entre produtos: ${PRODUCT_DELAY_MS}ms`);
 console.log(`  Resume: ${RESUME}`);
 console.log("═".repeat(60));


 fs.mkdirSync(CSV_STORAGE_DIR, { recursive: true });
 ensureCsvHeader(window.csvPath);
 const alreadyScraped = RESUME ? readAlreadyScrapedKeys(window.csvPath) : new Set<string>();
 if (alreadyScraped.size) {
   console.log(
     `[BlingStockScrape] Retomando execução — ${alreadyScraped.size} combinações produto/depósito já no CSV`,
   );
 }


 let context: BrowserContext | undefined;
 let page: Page | undefined;


 let processed = 0;
 let skippedResume = 0;
 let totalRowsWritten = 0;
 let errors = 0;
 const failedCombinations: string[] = [];


 try {
   fs.mkdirSync(SESSION_DIR, { recursive: true });
   context = await launchContext();
   page = await context.newPage();


   const loggedIn = await ensureLoggedIn(page);
   if (!loggedIn) {
     throw new Error("[BlingStockScrape] Login necessário");
   }


   let offset = 0;
   outer: while (true) {
     const mappings = await fetchProductMappingsPage(
       BLING_INTEGRATION_ID,
       BATCH_SIZE,
       offset,
     );
     if (!mappings.length) break;


     for (const produto of mappings) {
       for (const idDeposito of BLING_DEPOSITO_IDS) {
         const key = `${produto.external_id}::${idDeposito}`;


         if (alreadyScraped.has(key)) {
           skippedResume++;
           processed++;
           const pct = totalCombinacoes
             ? ((processed / totalCombinacoes) * 100).toFixed(1)
             : "0.0";
           console.log(
             `  ⏭️  Progresso: ${processed}/${totalCombinacoes} (${pct}%) — combinação já processada (resume), pulando`,
           );
           continue;
         }


         try {
           const rows = await scrapeProdutoDeposito(page, produto, idDeposito, window);
           appendCsvRows(window.csvPath, rows);
           totalRowsWritten += rows.length;
           processed++;
           const pct = totalCombinacoes
             ? ((processed / totalCombinacoes) * 100).toFixed(1)
             : "0.0";
           console.log(
             `  ✅ Progresso: ${processed}/${totalCombinacoes} (${pct}%) — ${rows.length} lançamento(s)`,
           );
         } catch (err: any) {
           errors++;
           processed++;
           const combination = describeCombination(produto, idDeposito);
           failedCombinations.push(
             `${processed}/${totalCombinacoes} (${combination})`,
           );
           const pct = totalCombinacoes
             ? ((processed / totalCombinacoes) * 100).toFixed(1)
             : "0.0";
           console.error(
             `  ❌ Progresso: ${processed}/${totalCombinacoes} (${pct}%) — ` +
               `falha ao buscar combinação: ${combination}; erro=${describeScrapeError(err)}`,
           );
         }


         await sleep(PRODUCT_DELAY_MS);
       }


       if (MAX_PRODUCTS && processed >= MAX_PRODUCTS * BLING_DEPOSITO_IDS.length) break outer;
     }


     offset += BATCH_SIZE;
   }
 } finally {
   if (page) await page.close().catch(() => {});
   if (context) await context.close().catch(() => {});
 }

 const isCompleteRun = MAX_PRODUCTS === 0 && MAX_PAGES === 0;
 if (errors === 0 && isCompleteRun) {
   await stockMovementSourceDataService.create({
     extraction_date: window.extractionDate,
     cutoff_date: window.cutoffDate,
     csv_path: window.csvPath,
   });
 }

 console.log("═".repeat(60));
 console.log("  ✅ Finalizado");
 console.log(`  Total de combinações produto/depósito: ${totalCombinacoes}`);
 console.log(`  Processados nessa execução: ${processed}`);
 console.log(`  Pulados (resume): ${skippedResume}`);
 console.log(`  Linhas gravadas no CSV: ${totalRowsWritten}`);
 console.log(`  Erros: ${errors}`);
 if (failedCombinations.length) {
   console.log(`  Combinações com falha: ${failedCombinations.join(", ")}`);
 }
 console.log(`  CSV: ${window.csvPath}`);
 console.log("═".repeat(60));


 if (errors > 0) {
   console.log(
     "Bling Stock Scrape — concluído com erros; nenhuma fonte CSV foi registrada.",
   );
 } else {
   console.log(
     isCompleteRun
       ? "  Fonte CSV registrada em stock_movement_source_data."
       : "  Execução limitada: fonte CSV não registrada.",
   );
 }


 process.exit(errors > 0 ? 1 : 0);
}


if (require.main === module) {
 main().catch(async (err) => {
   const message = err instanceof Error ? err.message : "erro desconhecido";
   console.error("\n❌ Erro fatal:", message);
   process.exit(1);
 });
}
