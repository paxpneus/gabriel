// Fachada de sellers (vendedor/gerente): service e SQL dos gerentes por loja/vigência usados pelos relatórios.
export { default as sellerService, SellerService } from "./services/sellers.service";
export { storeManagersFromSql, regionalManagersFromSql } from "./helpers/managers";
export type { ManagerPeriod } from "./types/sellers.types";
