// Lojas que não participam do fluxo do PDV Management por decisão de
// produto, não por critério de dado (tipo/loja física) — a CD21 já é
// excluída em outro nível (unitBusinessService.getPhysicalNumberedUnitBusinessIds
// nunca a inclui, ela não é "loja normal" em lugar nenhum do sistema, não só
// no PDV). Essas duas são só do PDV: sem eligible orders, sem link de
// STORE_REQUEST — compartilhado entre sales-request/ e pdv-access/, por
// isso vive aqui em vez de dentro de um dos dois submódulos.
export const PDV_EXCLUDED_STORE_NUMBERS = ["12", "17"];
