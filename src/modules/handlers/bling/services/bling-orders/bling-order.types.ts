export interface blingOrderWebHookData {
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
