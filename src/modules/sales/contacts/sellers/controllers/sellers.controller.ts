import { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import RouterController from "../../../../../shared/utils/base-models/base-router-controller";
import sellerService from "../services/sellers.service";

// Data YYYY-MM-DD existente (2023-02-30 não passa): os relatórios fazem cast ::date dos períodos.
const managerPeriodDate = (label: string) =>
  z
    .string({ error: `${label} é obrigatória` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} deve estar no formato AAAA-MM-DD`)
    .refine(
      (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
      `${label} inválida`,
    );

// Períodos do gerente (lista inteira, substitui a atual): loja e/ou grupo (ausente = null), fim null = ainda vigente.
const ManagerPeriodsBodySchema = z.object({
  manager_periods: z.array(
    z.object({
      unit_business_id: z.uuid("Loja inválida").nullable().default(null),
      unit_business_group_id: z.uuid("Grupo de lojas inválido").nullable().default(null),
      start_date: managerPeriodDate("Data de início do período"),
      end_date: managerPeriodDate("Data de fim do período").nullable(),
    }),
    { error: "Informe a lista de períodos do gerente" },
  ),
});

// Rotas de vendedor/gerente em /api/contacts (montadas antes do CRUD genérico no contacts.routes.ts).
class SellerController extends RouterController {
  constructor() {
    super();
    this.router.post(`/create-from-seller-name`, ...this.mw("createUserFromSellerName"), this.createUserFromSellerName);
    // Detalhe do contato (substitui o show do CRUD genérico): nomes de loja/grupo exigem unit-business, que o core não pode importar (ciclo).
    this.router.get(`/:id`, ...this.mw("show"), this.show);
    this.router.put(`/:id/manager-periods`, ...this.mw("updateManagerPeriods"), this.updateManagerPeriods);
  }

  // create-from-seller-name segue sem middleware (como antes da separação).
  protected middlewaresFor() {
    return {
      show: [authenticate, userPermissions],
      updateManagerPeriods: [authenticate, userPermissions],
    };
  }

  createUserFromSellerName = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { name, unitBusinessNumber, email, password } = req.body;
      const record = await sellerService.createUserFromSellerName(name, unitBusinessNumber, email, password);
      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  /** GET /:id — contato com `unit_business`/`unit_business_group` ({ name }) em cada período do gerente. */
  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await sellerService.findDetail(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  /** PUT /:id/manager-periods — substitui os períodos do gerente (`custom_data.manager_periods`). */
  updateManagerPeriods = async (req: Request, res: Response): Promise<Response> => {
    const parsed = ManagerPeriodsBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    }

    try {
      const record = await sellerService.updateManagerPeriods(req.params.id as string, parsed.data.manager_periods);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new SellerController();
