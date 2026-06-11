// src/modules/fiscal/nfe-emission/nfe-emission.controller.ts

import { Request, Response, Router } from "express";
import { nfeEmissionService } from "./nfe-emission.service";

class NfeEmissionController {
  readonly router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/status", this.status.bind(this));
    this.router.post("/emit", this.emit.bind(this));
    this.router.post("/emit-xml", this.emitFromXml.bind(this));
  }

  private async status(req: Request, res: Response) {
    try {
      const result = await nfeEmissionService.checkServiceStatus();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async emit(req: Request, res: Response) {
    try {
      const { nfe } = req.body;
      if (!nfe) {
        return res.status(400).json({ error: "Campo 'nfe' obrigatório no body" });
      }
      const result = await nfeEmissionService.emitSingleNfe(nfe);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async emitFromXml(req: Request, res: Response) {
    try {
      const { xml } = req.body;
      if (!xml || typeof xml !== "string") {
        return res.status(400).json({ error: "Campo 'xml' (string) obrigatório no body" });
      }
      const result = await nfeEmissionService.emitNfeFromXml(xml);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export const nfeEmissionController = new NfeEmissionController();