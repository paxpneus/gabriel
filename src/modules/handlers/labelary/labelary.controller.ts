import { Router, Request, Response } from "express";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import labelaryService from "./labelary.service";
import { classifyLabelaryError } from "./labelary.errors";

export class LabelaryController {
  public router = Router();

  constructor() {
    this.router.post("/render", authenticate, userPermissions, this.render);
  }

  render = async (req: Request, res: Response): Promise<void> => {
    try {
      const { zpl, density, width, height, index, responseFormat } = req.body;

      if (!zpl) {
        res.status(400).json({
          error: "Informe o código ZPL antes de renderizar.",
          code: "ZPL_REQUIRED",
        });
        return;
      }

      const { buffer, contentType } = await labelaryService.render({
        zpl,
        density,
        width,
        height,
        index,
        responseFormat,
      });

      res.set("Content-Type", contentType);
      res.set("Cache-Control", "no-store");
      res.send(buffer);
    } catch (error: any) {
      const status = error.response?.status ?? 500;
      const rawMessage = error.response?.data
        ? Buffer.from(error.response.data).toString("utf-8")
        : error.message;

      const classified = classifyLabelaryError(status, rawMessage);

      console.error(
        `[LabelaryController] ${classified.code} (${status}): ${classified.rawMessage}`,
      );

      res.status(status).json({
        error: classified.message,
        code: classified.code, 
      });
    }
  };
}

export default new LabelaryController();