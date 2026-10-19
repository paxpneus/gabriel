import { Request } from "express";
import { Op } from "sequelize";

// Filtro por loja de application via ?store_number= (uma ou várias lojas) — ver .claude/modules/auth.md.

// Erro de filtro com status HTTP próprio (400 formato inválido, 404 loja inexistente).
export class StoreNumberError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "StoreNumberError";
  }
}

// Lojas resolvidas do store_number: ids das unit businesses e suas integrações.
export interface StoreNumberFilter {
  unitBusinessIds: string[];
  integrationsIds: string[];
}

// "02,03" ou store_number[]=02&store_number[]=03 → ["02","03"]; vazio → null.
export function parseStoreNumbers(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === "") return null;

  const values = Array.isArray(raw) ? raw : [raw];
  if (values.some((value) => typeof value !== "string")) {
    throw new StoreNumberError("store_number inválido.", 400);
  }

  const numbers = [
    ...new Set(
      (values as string[])
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  return numbers.length ? numbers : null;
}

// Só application usa o filtro; sem store_number (ou usuário logado) → null = comportamento original.
export async function resolveApplicationStoreFilter(
  req: Request,
): Promise<StoreNumberFilter | null> {
  if (!(req as any).application) return null;

  const numbers = parseStoreNumbers(req.query?.store_number);
  if (!numbers) return null;

  // Import lazy: este módulo é carregado pelo BaseController (ciclo com config/routes).
  const unitBusinessService = (
    await import("../../modules/company/unit-business/unit-business.service")
  ).default;

  const stores = await unitBusinessService.findAll({
    where: { number: { [Op.in]: numbers } },
    attributes: ["id", "number", "integrations_id"],
  });

  const found = new Set(stores.map((store) => store.number));
  const missing = numbers.filter((number) => !found.has(number));
  if (missing.length) {
    throw new StoreNumberError(`Loja(s) ${missing.join(", ")} não encontrada(s).`, 404);
  }

  return {
    unitBusinessIds: stores.map((store) => store.id),
    integrationsIds: [
      ...new Set(
        stores.map((store) => store.integrations_id).filter((id): id is string => !!id),
      ),
    ],
  };
}

// Status HTTP do erro: StoreNumberError carrega o seu, o resto cai no fallback do endpoint.
export function storeNumberErrorStatus(error: unknown, fallback: number): number {
  return error instanceof StoreNumberError ? error.status : fallback;
}
