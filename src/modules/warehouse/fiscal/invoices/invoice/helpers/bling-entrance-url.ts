// Tela de edição da nota de entrada na Bling, onde o usuário concilia os produtos da nota.
const BLING_ENTRANCE_INVOICE_EDIT_URL = "https://www.bling.com.br/notas.entrada.php#edit/";

// Link da nota de entrada na Bling pelo id_system (id da nota na Bling).
export function buildBlingEntranceInvoiceUrl(idSystem: string | number): string {
  return `${BLING_ENTRANCE_INVOICE_EDIT_URL}${idSystem}`;
}
