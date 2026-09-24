import { parsePaymentReceiptText } from "../helpers/payment-receipt-text-parser";

describe("parsePaymentReceiptText", () => {
  it("extrai os campos de um comprovante de cartão de crédito parcelado", () => {
    const text = `
      Loja Exemplo Ltda
      CNPJ: 12.345.678/0001-99
      Comprovante de venda
      Cartão de Crédito
      Bandeira: Visa
      Cartão final 1234
      Data: 10/01/2026 Hora: 14:30
      3x de R$ 100,00
      Valor total: R$ 300,00
      Autorização: AUTH12
      NSU: 998877
    `;

    const result = parsePaymentReceiptText(text);

    expect(result.tipo_comprovante).toBe("cartao_credito");
    expect(result.estabelecimento_cnpj).toBe("12.345.678/0001-99");
    expect(result.bandeira_cartao).toBe("Visa");
    expect(result.cartao_final).toBe("1234");
    expect(result.data_transacao).toBe("10/01/2026");
    expect(result.hora_transacao).toBe("14:30");
    expect(result.qtd_parcelas).toBe(3);
    expect(result.valor_parcela).toBe(100);
    expect(result.valor_total).toBe(300);
    expect(result.codigo_autorizacao).toBe("AUTH12");
    expect(result.nsu_cv).toBe("998877");
  });

  it("reconhece PIX mesmo quando o texto também cita 'transferência'", () => {
    const text = "Comprovante Pix\nTransferência via chave\nValor: R$ 50,00";
    expect(parsePaymentReceiptText(text).tipo_comprovante).toBe("pix");
  });

  it("devolve tudo null pra texto vazio (OCR sem retorno)", () => {
    const result = parsePaymentReceiptText("");
    expect(result.tipo_comprovante).toBeNull();
    expect(result.valor_total).toBeNull();
    expect(result.estabelecimento_cnpj).toBeNull();
  });

  it("reconhece instituição de pagamento conhecida por substring", () => {
    const text = "Comprovante gerado pela maquininha Stone\nValor: R$ 10,00";
    expect(parsePaymentReceiptText(text).instituicao_pagamento).toBe("Stone");
  });
});
