/** Cupom é único sem diferenciar caixa/espaços (cadastro manual × código vindo da Magento). */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}
