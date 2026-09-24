// Não existe flag/coluna própria pra marcar a loja CD21 — identificação
// centralizada aqui. Vive num arquivo sem nenhuma dependência (não em
// unit-business.service.ts) de propósito: pdv-excluded-unit-business.ts
// precisa do literal em tempo de import (pra montar um array no escopo do
// módulo, não dentro de uma função), e unit-business.service.ts já é
// alcançado de volta por um ciclo de imports a partir do módulo PDV — importar
// o literal direto do service nesse ponto quebra com
// "Cannot access 'CD21_UNIT_BUSINESS_NUMBER' before initialization" sempre
// que o ciclo resolve nessa ordem. Um arquivo-folha elimina o ciclo.
export const CD21_UNIT_BUSINESS_NUMBER = "21";
