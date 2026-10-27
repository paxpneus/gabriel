import { Router } from "express";
import contactController from "./core/controllers/contacts.controller";
import sellerController from "./sellers/controllers/sellers.controller";
import affiliatedController from "./affiliated/controllers/affiliated.controller";

const router = Router();

// Vendedor/gerente antes do CRUD genérico: rotas específicas não caem nas genéricas.
// Login/me do afiliado: /api/contacts/affiliated/{login,me}.
router.use("/affiliated", affiliatedController.router);
router.use("/", sellerController.router);
router.use("/", contactController.router);

export default router;
