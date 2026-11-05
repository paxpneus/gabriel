import { Router } from "express";
import contactController from "./core/controllers/contacts.controller";
import sellerController from "./sellers/controllers/sellers.controller";

const router = Router();

// Vendedor/gerente antes do CRUD genérico: rotas específicas não caem nas genéricas.
router.use("/", sellerController.router);
router.use("/", contactController.router);

export default router;
