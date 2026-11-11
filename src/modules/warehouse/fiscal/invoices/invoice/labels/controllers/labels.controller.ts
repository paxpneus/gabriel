import { Request, Response } from "express";
import RouterController from "../../../../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import { getUserContext } from "../../../../../../../shared/query/get-logged-user";
import { LabelService } from "../services/labels.service";
import { resolveUnitBusinessId } from "../../shared";

// Rota de dados das etiquetas de volume em /api/invoices.
class LabelsController extends RouterController {
  private labelService: LabelService;

  constructor() {
    super();

    this.labelService = new LabelService();

    this.router.get(
      "/labels/data",
      ...this.mw("getLabelData"),
      this.getLabelData,
    );
  }

  protected middlewaresFor() {
    return {
      getLabelData: [authenticate, userPermissions],
    };
  }

  getLabelData = async (req: Request, res: Response): Promise<Response> => {
    try {
      let ids: string[] = [];

      if (Array.isArray(req.query.invoiceIds)) {
        ids = req.query.invoiceIds as string[];
      } else if (typeof req.query.invoiceIds === "string") {
        ids = req.query.invoiceIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const limit = Math.min(
        200,
        Math.max(1, Number(req.query.limit) || 50),
      );

      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );

      const { data, nextCursor, totalVolumes } =
        await this.labelService.getLabelDataPage(ids, unitBusinessId, {
          cursor,
          limit,
        });

      return res.json({ data, nextCursor, totalVolumes });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export default new LabelsController();
