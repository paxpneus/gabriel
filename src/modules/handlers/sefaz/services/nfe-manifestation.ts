// src/modules/fiscal/nfe-manifestacao/nfe-manifestacao.service.ts

import { getWizard } from "./wizard.service";

const CNPJ_DESTINATARIO = "02316749002111"; // Loja 21 - CD MG
const CUF_MG = 31;

export interface ManifestacaoResult {
  cStat: string;
  xMotivo: string;
  chNFe: string;
  dhRegEvento?: string;
  nProt?: string;
}

export class NfeManifestacaoService {
  private get tpAmb(): number {
    return Number(process.env.SEFAZ_AMBIENTE ?? "2");
  }

  /**
   * Ciência da Operação — apenas registra ciência, não confirma recebimento.
   * Deve ser chamado ao receber um resNFe na fila de distribuição.
   */
  async cienciaDaOperacao(chNFe: string): Promise<ManifestacaoResult> {
    const wizard = await getWizard();

    const result = await wizard.NFE_CienciaDaOperacao({
      idLote: Date.now(),
      modelo: "55",
      evento: [
        {
          cOrgao: CUF_MG,
          tpAmb: this.tpAmb,
          CNPJ: CNPJ_DESTINATARIO,
          chNFe,
          dhEvento: new Date().toISOString().replace("Z", "-03:00"),
          tpEvento: "210210",
          nSeqEvento: 1,
          verEvento: "1.00",
          detEvento: {
            descEvento: "Ciencia da Operacao",
          },
        },
      ],
    });

    const retEvento = result?.[0] ?? result;
    return {
      cStat: String(retEvento?.cStat ?? ""),
      xMotivo: retEvento?.xMotivo ?? "",
      chNFe,
      dhRegEvento: retEvento?.dhRegEvento,
      nProt: retEvento?.nProt,
    };
  }

  /**
   * Confirmação da Operação — confirma que a mercadoria foi recebida.
   * Deve ser chamado após entrada efetiva no estoque.
   */
  async confirmacaoDaOperacao(chNFe: string): Promise<ManifestacaoResult> {
    const wizard = await getWizard();

    const result = await wizard.NFE_ConfirmacaoDaOperacao({
      idLote: Date.now(),
      modelo: "55",
      evento: [
        {
          cOrgao: CUF_MG,
          tpAmb: this.tpAmb,
          CNPJ: CNPJ_DESTINATARIO,
          chNFe,
          dhEvento: new Date().toISOString().replace("Z", "-03:00"),
          tpEvento: "210200",
          nSeqEvento: 1,
          verEvento: "1.00",
          detEvento: {
            descEvento: "Confirmacao da Operacao",
          },
        },
      ],
    });

    const retEvento = result?.[0] ?? result;
    return {
      cStat: String(retEvento?.cStat ?? ""),
      xMotivo: retEvento?.xMotivo ?? "",
      chNFe,
      dhRegEvento: retEvento?.dhRegEvento,
      nProt: retEvento?.nProt,
    };
  }
}

export const nfeManifestacaoService = new NfeManifestacaoService();