import { Request, Response } from "express";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import RouterController from "../../../../../../../shared/utils/base-models/base-router-controller";
import { getUserContext } from "../../../../../../../shared/query/get-logged-user";
import { resolveUnitBusinessId } from "../../shared";
import invoiceLifecycleService from "../services/lifecycle.service";

// Rotas de ciclo de vida da nota (abrir, uso e consumo, finalizar, agendar).
class LifecycleController extends RouterController {
  constructor() {
    super();

    this.router.post(
      "/bulk/open",
      ...this.mw("updateInvoicesOpen"),
      this.updateInvoicesOpen,
    );

    this.router.post(
      "/bulk/mark-internal-use",
      ...this.mw("markAsInternalUse"),
      this.markAsInternalUse,
    );

    this.router.post(
      "/:id/finish",
      ...this.mw("finishPendingInvoice"),
      this.finishPendingInvoice,
    );

    this.router.put(
      "/schedule/invoice/:id",
      ...this.mw("scheduleInvoice"),
      this.scheduleInvoice,
    );
  }

  protected middlewaresFor() {
    return {
      updateInvoicesOpen: [authenticate, userPermissions],
      scheduleInvoice: [authenticate, userPermissions],
      markAsInternalUse: [authenticate, userPermissions],
      finishPendingInvoice: [authenticate, userPermissions],
    };
  }

  updateInvoicesOpen = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = req.body;
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await invoiceLifecycleService.updateInvoicesOpen(ids, unitBusinessId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  markAsInternalUse = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = req.body;
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await invoiceLifecycleService.markAsInternalUse(ids, unitBusinessId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // Finaliza nota OPEN/PENDING da unit business com observação obrigatória (body: { observation }).
  finishPendingInvoice = async (req: Request, res: Response): Promise<void> => {
    try {
      const { observation } = req.body;
      const { id } = req.params;
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await invoiceLifecycleService.finishPendingInvoice(
        id as string,
        unitBusinessId,
        observation,
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  scheduleInvoice = async (req: Request, res: Response): Promise<void> => {
    try {
      const { expectedDate } = req.body;
      const { id } = req.params;
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await invoiceLifecycleService.scheduleInvoice(
        id as string,
        expectedDate,
        unitBusinessId,
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}

export default new LifecycleController();
