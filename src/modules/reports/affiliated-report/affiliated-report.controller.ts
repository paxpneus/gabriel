import { Response, Router } from "express";
import { authenticate, AuthRequest } from "../../../middlewares/auth-token";
import { AffiliatedReportQuerySchema } from "./schemas/affiliated-report.schema";
import affiliatedReportService from "./affiliated-report.service";

// Sem userPermissions (nem no /refresh): o papel Afiliado não tem permissão nenhuma; o acesso é o contato afiliado do próprio usuário (service).
class AffiliatedReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, this.index);
    this.router.post("/refresh", authenticate, this.refresh);
  }

  /** GET / — vendas e comissão do afiliado logado no período (start_date/end_date, máx. 1 ano); cache de 1h. */
  index = (req: AuthRequest, res: Response) => this.respond(req, res, false);

  /** POST /refresh — mesmo contrato do GET /, recalcula e regrava; 1 vez a cada 10 min por afiliado (senão 429 com o horário de liberação). */
  refresh = (req: AuthRequest, res: Response) => this.respond(req, res, true);

  private respond = async (req: AuthRequest, res: Response, refresh: boolean): Promise<Response> => {
    const parsed = AffiliatedReportQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    // Token de application não tem usuário: não é afiliado.
    const userId = req.user?.id;
    if (!userId) return res.status(403).json({ error: "Usuário sem acesso a este relatório" });

    const { start_date: startDate, end_date: endDate } = parsed.data;
    try {
      if (!refresh) {
        const report = await affiliatedReportService.getCachedReport(userId, startDate, endDate);
        if (!report) return res.status(403).json({ error: "Usuário sem acesso a este relatório" });
        return res.json(report);
      }

      const { report, refreshAvailableAt } = await affiliatedReportService.refreshReport(userId, startDate, endDate);
      if (refreshAvailableAt) {
        // Horário de Brasília no formato "10/11/2026 - 13:17" (o ISO segue em refresh_available_at pro front).
        const availableAt = new Date(refreshAvailableAt);
        const date = availableAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
        const time = availableAt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
        return res.status(429).json({
          error: `Você poderá atualizar novamente: ${date} - ${time}`,
          refresh_available_at: refreshAvailableAt,
        });
      }
      if (!report) return res.status(403).json({ error: "Usuário sem acesso a este relatório" });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new AffiliatedReportController();
