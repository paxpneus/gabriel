import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import CarrierImportLayout from "./carrier-import-layouts.model";
import CarrierImportLayoutService from "./carrier-import-layouts.service";
import multer from "multer";
import carrierLabelRangesService from "../carrier-label-ranges/carrier-label-ranges.service";

const upload = multer({ storage: multer.memoryStorage() });

export class CarrierImportLayoutController extends BaseController<
  CarrierImportLayout,
  typeof CarrierImportLayoutService
> {
  constructor() {
    super(CarrierImportLayoutService);

    this.router.post("/with-file", ...this.mw("create"), this.create);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions, upload.single("file")],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo obrigatório." });
      }

      const payload = {
        ...req.body,
        sheet_name: req.body.sheet_name === "null" ? null : req.body.sheet_name,
        data_start_row: Number(req.body.data_start_row),
        active: req.body.active === "true",
      };

      const { buffer, originalname, mimetype } = req.file;

      const file = { buffer, filename: originalname, mimeType: mimetype };
      console.log(payload);
      const created = await this.service.createWithFile(payload, {}, file);

      return res.status(201).json({
        error: "Layout criado e importação de nomeclaturas iniciada!",
      });
    } catch (error: any) {
      console.error("[CarrierImportLayout] create error:", error);
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new CarrierImportLayoutController();
