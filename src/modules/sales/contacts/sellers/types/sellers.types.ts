/**
 * Um período do gerente: loja (gerente da loja) e/ou grupo (regional) de start_date a end_date (YYYY-MM-DD da data do pedido, inclusivo).
 * Fim null = ainda vigente. Trocou de loja/grupo = fecha este período e abre outro, guardando o histórico.
 */
export interface ManagerPeriod {
  unit_business_id: string | null;
  unit_business_group_id: string | null;
  start_date: string;
  end_date: string | null;
}
