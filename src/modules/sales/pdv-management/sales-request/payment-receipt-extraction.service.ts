import crypto from "crypto";
import { extractReceiptText } from "./helpers/receipt-text-extraction";
import { parsePaymentReceiptText } from "./helpers/payment-receipt-text-parser";
import { PaymentReceiptExtractionSchema } from "./helpers/payment-receipt-extraction.schema";
import { PaymentReceiptExtraction } from "./pdv-sales-request.types";

const MATH_TOLERANCE = 0.01;

export interface PaymentReceiptAnalysisResult {
  extraction: PaymentReceiptExtraction;
  validated: boolean | null;
  fingerprint: string | null;
}

export class PaymentReceiptExtractionService {
  // Sem IA — texto extraído localmente (pdf-parse ou OCR via Tesseract, ver
  // helpers/receipt-text-extraction.ts) e interpretado por regex/heurísticas
  // (helpers/payment-receipt-text-parser.ts). PaymentReceiptExtractionSchema
  // continua validando a saída antes de persistir, mesmo o parser sendo
  // interno (garante que nenhum campo escapa do contrato/enum esperado).
  async analyze(
    buffer: Buffer,
    mimeType: string,
  ): Promise<PaymentReceiptAnalysisResult> {
    const text = await extractReceiptText(buffer, mimeType);
    const extraction = PaymentReceiptExtractionSchema.parse(
      parsePaymentReceiptText(text),
    );

    return { extraction, ...this.computeDerived(extraction) };
  }

  // Extraído pra fora de analyze() pra ser reaproveitado quando o front edita
  // a análise manualmente (updateReceiptAnalysis em pdv-sales-request.service.ts)
  // — mesma regra de validação/fingerprint, seja o dado vindo da IA ou de edição.
  computeDerived(extraction: PaymentReceiptExtraction): {
    validated: boolean | null;
    fingerprint: string | null;
  } {
    return {
      validated: this.validateMath(extraction),
      fingerprint: this.buildFingerprint(extraction),
    };
  }

  // Só faz sentido pra crédito parcelado — PIX/débito/crédito à vista não
  // têm o que validar (null, não false: "não se aplica" é diferente de
  // "não bateu a conta").
  private validateMath(extraction: PaymentReceiptExtraction): boolean | null {
    if (
      extraction.tipo_comprovante !== "cartao_credito" ||
      extraction.qtd_parcelas === null ||
      extraction.valor_parcela === null ||
      extraction.valor_total === null
    ) {
      return null;
    }

    const computed =
      Math.round(extraction.qtd_parcelas * extraction.valor_parcela * 100) /
      100;
    const total = Math.round(extraction.valor_total * 100) / 100;
    return Math.abs(computed - total) <= MATH_TOLERANCE;
  }

  // cartao_final cobre a maioria dos casos de cartão; PIX/transferência não
  // têm cartão, por isso o fallback pra codigo_autorizacao/nsu_cv.
  private buildFingerprint(extraction: PaymentReceiptExtraction): string | null {
    const instrument =
      extraction.cartao_final ??
      extraction.codigo_autorizacao ??
      extraction.nsu_cv;

    if (
      !extraction.estabelecimento_cnpj ||
      !extraction.data_transacao ||
      !extraction.hora_transacao ||
      extraction.valor_total === null ||
      !instrument
    ) {
      return null;
    }

    const key = [
      extraction.estabelecimento_cnpj,
      extraction.data_transacao,
      extraction.hora_transacao,
      extraction.valor_total.toFixed(2),
      instrument,
    ].join("|");

    return crypto.createHash("sha256").update(key).digest("hex");
  }
}

export default new PaymentReceiptExtractionService();
