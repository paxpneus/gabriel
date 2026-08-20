export interface blingOrderWebHookData {
    data: {
    id: number,
    data: string,
    numero: number,
    numeroLoja: string,
    total: number,
    contato: {id: number},
    vendedor: {id: number},
    loja: {id: number},
    situacao: {
        id: number,
        valor: number,
    }
}
}

export type BlingActualSituationId =
  | "6" // OPEN
  | "9" // EMITTED
  | "12" // CANCELLED
  | "21" // CANCELLED
  | "748743" // WAITING CHANNEL VALIDATION
  | "748748" // WAITING FOR NFE EMISSION
  | "748772" // CANCELLED
  | "834029" // SENT_TO_TRANSPORTER
  | "834030"; // DELIVERED