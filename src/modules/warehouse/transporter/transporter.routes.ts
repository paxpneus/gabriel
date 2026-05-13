import { Router } from "express";
import CarrierImportLayoutRoutes from "./carrier-import-layouts/carrier-import-layouts.routes";
import CarrierLabelRangeRoutes from "./carrier-label-ranges/carrier-label-ranges.routes";
import TransporterController from "./transporter.controller";

const router = Router();

router.use("/carrier-label-ranges", CarrierLabelRangeRoutes);
router.use("/carrier-import-layouts", CarrierImportLayoutRoutes);
router.use("/", TransporterController.router);

export default router;
