// Importa do arquivo-folha (sem dependências), não de unit-business.service.ts
// direto — esse módulo é alcançado de volta por um ciclo de imports a partir
// daqui (pdv-sales-request.service.ts/pdv-access-link.service.ts já importam
// unitBusinessService), e o array abaixo é montado em tempo de import: se a
// constante viesse do service, o ciclo quebra com "Cannot access
// 'CD21_UNIT_BUSINESS_NUMBER' before initialization" dependendo da ordem em
// que os módulos resolvem.
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../company/unit-business/helpers/cd21-unit-business-number";

// Lojas que não participam do fluxo do PDV Management por decisão de
// produto, não por critério de dado (tipo/loja física) — a CD21 já é
// excluída em outro nível (unitBusinessService.getPhysicalNumberedUnitBusinessIds
// nunca a inclui, ela não é "loja normal" em lugar nenhum do sistema, não só
// no PDV). Essas duas são só do PDV: sem eligible orders, sem link de
// STORE_REQUEST — compartilhado entre sales-request/ e pdv-access/, por
// isso vive aqui em vez de dentro de um dos dois submódulos.
export const PDV_EXCLUDED_STORE_NUMBERS = ["12", "17"];

// União de PDV_EXCLUDED_STORE_NUMBERS + CD21 — a lista completa de números
// que o FRONT deve tratar como "não mostrar ação de PDV" (ex.: numa tela que
// lista todas as unit businesses do sistema, não só as que já vêm filtradas
// pelo backend em /api/pdv-access/links). Ver pdv-access-link.service.ts.
export const PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS = [
  CD21_UNIT_BUSINESS_NUMBER,
  ...PDV_EXCLUDED_STORE_NUMBERS,
];
