// Importa do arquivo-folha (sem dependências), não de unit-business.service.ts
// direto — esse módulo é alcançado de volta por um ciclo de imports a partir
// daqui (pdv-sales-request.service.ts/pdv-access-link.service.ts já importam
// unitBusinessService), e o array abaixo é montado em tempo de import: se a
// constante viesse do service, o ciclo quebra com "Cannot access
// 'CD21_UNIT_BUSINESS_NUMBER' before initialization" dependendo da ordem em
// que os módulos resolvem.
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../company/unit-business/helpers/cd21-unit-business-number";

// Lojas que não participam do fluxo do PDV Management por decisão de
// produto, não por critério de dado (tipo/loja física): sem eligible orders,
// sem link de STORE_REQUEST. Pedidos da CD21 entram no fluxo normalmente — ela
// só fica fora do link de STORE_REQUEST (PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS).
export const PDV_EXCLUDED_STORE_NUMBERS = ["12", "17"];

// União de PDV_EXCLUDED_STORE_NUMBERS + CD21 — números sem storeRequestUrl
// (CD21 usa o próprio cd21Url, tela global). Ver pdv-access-link.service.ts.
export const PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS = [
  CD21_UNIT_BUSINESS_NUMBER,
  ...PDV_EXCLUDED_STORE_NUMBERS,
];
