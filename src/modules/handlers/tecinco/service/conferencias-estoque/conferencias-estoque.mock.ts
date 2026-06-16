// Mock temporário — substitui TCarConferenciaEstoqueService sem chamar a Tecinco

export class TCarConferenciaEstoqueServiceMock {
  async listarNotasFiscais(branchId: number, params: any): Promise<any> {
    console.log(`[MOCK] listarNotasFiscais | branchId=${branchId} | params=`, params);
    return {
      data: [
        {
          chave: {
            filial: branchId,
            tpneg_codigo: 1,
            ntz_codigo: 5102,
            opr_codigo: 1,
            cln_codigo: 123,
            nota: Number(params.nota),
            serie: "1",
            seq_cancelamento: "0",
          },
          entrada_saida: "S",
          situacao: "A",
          cliente: { codigo: 123, nome: "CLIENTE MOCK SA" },
        },
      ],
    };
  }

async carregarDocumento(branchId: number, tipo: string, numero: any, extraParams: any): Promise<any> {
  console.log(`[MOCK] carregarDocumento | branchId=${branchId} | tipo=${tipo} | numero=${numero} | extraParams=`, extraParams);
  return {
    tipo,
    numero,
    status_conferencia: "PENDENTE",
    itens: [
      { seq: 1, produto_codigo: "4019238282603", qtde_solicitada: 4, qtde_conferida: 0 },
      { seq: 2, produto_codigo: "03115750000",   qtde_solicitada: 2, qtde_conferida: 0 },
      { seq: 3, produto_codigo: "04509770000",   qtde_solicitada: 2, qtde_conferida: 1 }, // divergente intencional
    ],
  };
}
  async conferir(branchId: number, tipo: string, numero: any, body: any, extraParams: any): Promise<any> {
    console.log(`[MOCK] conferir | branchId=${branchId} | tipo=${tipo} | numero=${numero}`);
    console.log(`[MOCK] conferir | extraParams=`, extraParams);
    console.log(`[MOCK] conferir | body=`, JSON.stringify(body, null, 2));
    return {
      success: true,
      tipo,
      numero,
      itens_atualizados: body.itens?.length ?? 0,
      status_conferencia: "CONFERIDO",
    };
  }
}