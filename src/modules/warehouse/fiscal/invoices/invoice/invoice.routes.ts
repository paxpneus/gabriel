import { Router } from "express";
import documentsController from "./documents/controllers/documents.controller";
import labelsController from "./labels/controllers/labels.controller";
import lifecycleController from "./lifecycle/controllers/lifecycle.controller";
import ingestionController from "./ingestion/controllers/ingestion.controller";
import reportsController from "./reports/controllers/reports.controller";
import invoiceController from "./core/controllers/invoice.controller";

const router = Router();

// Rotas dos domínios antes do CRUD genérico do core: rotas específicas (ex.: /full/:id, /danfe/data) não caem em /:id.
router.use("/", documentsController.router);
router.use("/", labelsController.router);
router.use("/", lifecycleController.router);
router.use("/", ingestionController.router);
router.use("/", reportsController.router);
router.use("/", invoiceController.router);

export default router;
