import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import CarrierLabelRange from "./carrier-label-ranges.model";
import CarrierLabelRangeService from "./carrier-label-ranges.service";
import { Request, Response } from 'express';
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

export class CarrierLabelRangeController extends BaseController<
  CarrierLabelRange,
  typeof CarrierLabelRangeService
> {
  constructor() {
    super(CarrierLabelRangeService);

    this.router.post("/from-excel", ...this.mw("importLabelsFromExcel"), this.importLabelsFromExcel)
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      importLabelsFromExcel: [authenticate, userPermissions, upload.single("file"),]
    };
  }

  importLabelsFromExcel = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo obrigatória" });
      }
      const {transporter_id} = req.body
      const { buffer, originalname, mimetype } = req.file;

      const file = {
        buffer: buffer,
        filename: originalname,
        mimeType: mimetype,
      };

      await this.service.importLabelsFromExcel(transporter_id as string, file)
      return res
        .status(201)
        .json({ message: "Nomenclaturas importadas com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }
}

export default new CarrierLabelRangeController();
