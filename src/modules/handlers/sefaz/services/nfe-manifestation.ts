// src/modules/fiscal/nfe-manifestacao/nfe-manifestacao.service.ts

import Invoice from "../../../warehouse/entrance/invoice/invoice.model";
import { SefazManifestationStatus } from "../../../warehouse/entrance/invoice/invoice.types";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";
import { getWizard } from "./wizard.service";

const CNPJ_DESTINATARIO = "02316749002111"; // Loja 21 - CD MG
const CUF_MG = 31;

// cStats da SEFAZ que indicam aceitação do evento
const CSTAT_ACEITO = new Set(["135", "136"]);

// cStats que indicam que o evento já foi registrado anteriormente
// 573 = Evento já registrado para esta chave de acesso e tipo de evento
const CSTAT_JA_REGISTRADO = new Set(["573"]);

// cStats que indicam nota cancelada
// 101 = NF-e Cancelada | 151 = NF-e Cancelada pelo contribuinte no prazo de 24h
const CSTAT_CANCELADA = new Set(["101", "151"]);

export interface ManifestacaoResult {
  cStat: string;
  xMotivo: string;
  chNFe: string;
  dhRegEvento?: string;
  nProt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retorna o timestamp atual formatado para o fuso horário de Brasília,
 * sem depender de bibliotecas externas e respeitando horário de verão.
 *
 * Exemplo de saída: "2025-06-11T10:30:00-03:00"
 */
function dhEventoBrasilia(): string {
  const now = new Date();

  // Converte para a representação local de Brasília usando a API padrão
  // Intl.DateTimeFormat — disponível em Node.js 12+ sem dependências externas.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  // Calcula o offset real em minutos (inclui horário de verão automaticamente)
  const utcMs = now.getTime();
  const localMs = new Date(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`,
  ).getTime();
  const offsetMin = Math.round((localMs - utcMs) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, "0");
  const mm = String(absMin % 60).padStart(2, "0");

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${sign}${hh}:${mm}`;
}

// ─── Validação pré-ciência ─────────────────────────────────────────────────────

export interface PreCienciaValidationResult {
  /**
   * true  → pode prosseguir com o envio da ciência
   * false → deve abortar (motivo em `reason`)
   */
  ok: boolean;
  reason?: string;

  /**
   * Invoice encontrada ou criada no banco.
   * Presente sempre que ok=true, e também quando ok=false e a nota já existia.
   */
  invoice?: Invoice;

  /**
   * nSeqEvento a usar no envio (lido do banco para evitar cStat=573)
   */
  nSeqEvento?: number;
}

/**
 * Valida todas as pré-condições antes de enviar a Ciência da Operação:
 *
 * 1. CNPJ do destinatário no XML bate com o CNPJ da filial cadastrada.
 * 2. Nota não está já cancelada no banco.
 * 3. Ciência ainda não foi enviada com sucesso (idempotência via banco).
 *
 * Quando passa em todas as validações, cria (ou atualiza) a invoice com
 * status PENDING_CIENCIA para registrar que o resNFe foi recebido, mesmo
 * antes do XML completo chegar.
 */
export async function validarPreCiencia(params: {
  chNFe: string;
  /** CNPJ do destinatário extraído do resNFe (sem formatação) */
  receiverCnpjFromXml: string;
  /** NSU do documento que originou esta chamada */
  nsu: string;
  /** Nome/CNPJ da filial para logs */
  label: string;
}): Promise<PreCienciaValidationResult> {
  const { chNFe, receiverCnpjFromXml, nsu, label } = params;

  // ── 1. Valida CNPJ destinatário ───────────────────────────────────────────
  const cleanReceiver = cleanDocument(receiverCnpjFromXml);
  const cleanEsperado = cleanDocument(CNPJ_DESTINATARIO);

  if (cleanReceiver !== cleanEsperado) {
    console.warn(
      `[SEFAZ] NSU=${nsu} Filial=${label} | CNPJ destinatário inválido: esperado=${cleanEsperado} recebido=${cleanReceiver} — ciência abortada`,
    );
    return {
      ok: false,
      reason: `CNPJ destinatário inválido: esperado=${cleanEsperado} recebido=${cleanReceiver}`,
    };
  }

  // ── 2. Busca invoice existente por xml_key (chNFe) ────────────────────────
  const existing = await Invoice.findOne({
    where: { xml_key: chNFe },
    attributes: [
      "id",
      "status",
      "sefaz_manifestation_status",
      "sefaz_n_seq_evento",
    ],
  });

  // ── 3. Nota já cancelada? ─────────────────────────────────────────────────
  if (existing?.status === "CANCELLED") {
    console.warn(
      `[SEFAZ] NSU=${nsu} Filial=${label} | chNFe=${chNFe} já cancelada no banco — ciência abortada`,
    );
    return {
      ok: false,
      reason: "Nota já cancelada no banco",
      invoice: existing,
    };
  }

  // ── 4. Ciência já enviada com sucesso? (idempotência) ─────────────────────
  const statusQueJaEnviou: SefazManifestationStatus[] = [
    "CIENCIA_ENVIADA",
    "CONFIRMADO",
    "DESCONHECIDO",
    "OPERACAO_NAO_REALIZADA",
  ];

  if (
    existing?.sefaz_manifestation_status &&
    statusQueJaEnviou.includes(existing.sefaz_manifestation_status)
  ) {
    console.log(
      `[SEFAZ] NSU=${nsu} Filial=${label} | chNFe=${chNFe} ciência já enviada (status=${existing.sefaz_manifestation_status}) — ignorando`,
    );
    return {
      ok: false,
      reason: `Ciência já enviada anteriormente (status=${existing.sefaz_manifestation_status})`,
      invoice: existing,
    };
  }

  // ── 5. Cria ou atualiza a invoice como PENDING_CIENCIA ────────────────────
  //
  // Registramos a nota no banco ANTES de enviar a ciência para garantir que,
  // mesmo que o processo morra entre o envio e a persistência, na próxima
  // execução saberemos que a ciência já foi tentada (via sefaz_nsu + status).
  let invoice: Invoice;

  if (existing) {
    await existing.update({
      sefaz_manifestation_status: "PENDING_CIENCIA",
      sefaz_nsu: nsu,
    });
    invoice = existing;
  } else {
    // Invoice ainda não existe — cria um registro mínimo para rastreamento.
    // O procNFe completo preencherá todos os outros campos via upsertInvoiceFromXml.
    invoice = await Invoice.create({
      // Campos obrigatórios com placeholder — serão sobrescritos pelo procNFe
      customer_name: "PENDENTE",
      number_system: "PENDENTE",
      customer_document: cleanReceiver,
      sender_cnpj: "0".repeat(14),
      sender_name: "PENDENTE",
      receiver_cnpj: cleanReceiver,
      receiver_name: "PENDENTE",
      type: "INCOMING",
      status: "PENDING",
      xml_key: chNFe,
      id_system: `SEFAZ-${chNFe}`,
      batch_generated: false,
      printed_label: false,
      // Campos de manifestação
      sefaz_manifestation_status: "PENDING_CIENCIA",
      sefaz_n_seq_evento: 1,
      sefaz_nsu: nsu,
      // unit_business_id e store_id são obrigatórios — preenche com a filial conhecida
      // O procNFe resolverá os IDs corretos no upsert por xml_key
      unit_business_id: await resolveUnitBusinessId(cleanReceiver),
      store_id: await resolveDefaultStoreId(),
    } as any);

    console.log(
      `[SEFAZ] NSU=${nsu} Filial=${label} | chNFe=${chNFe} — invoice placeholder criada id=${invoice.id}`,
    );
  }

  const nSeqEvento = invoice.sefaz_n_seq_evento ?? 1;

  return { ok: true, invoice, nSeqEvento };
}

// ─── Resolvers de FK obrigatória para o placeholder ──────────────────────────
// Lazy-cached para não fazer query a cada chamada dentro do mesmo processo.

let _unitBusinessId: string | null = null;
let _storeId: string | null = null;

async function resolveUnitBusinessId(cnpj: string): Promise<string> {
  if (_unitBusinessId) return _unitBusinessId;

  // Import dinâmico para evitar dependência circular
  const { default: UnitBusiness } = await import(
    "../../../warehouse/unit-business/unit-business.model"
  );
  const ub = await UnitBusiness.findOne({
    where: { cnpj },
    attributes: ["id"],
  });
  if (!ub)
    throw new Error(
      `[SEFAZ] UnitBusiness não encontrada para CNPJ=${cnpj}`,
    );

  _unitBusinessId = ub.id;
  return _unitBusinessId;
}

async function resolveDefaultStoreId(): Promise<string> {
  if (_storeId) return _storeId;

  const { default: Store } = await import(
    "../../../sales/stores/stores.model"
  );
  const store = await Store.findOne({
    where: { name: "Outros" },
    attributes: ["id"],
  });
  if (!store)
    throw new Error(
      `[SEFAZ] Store "Outros" não encontrada — necessária para placeholder`,
    );

  _storeId = store.id;
  return _storeId;
}

// ─── Serviço principal ────────────────────────────────────────────────────────

export class NfeManifestacaoService {
  private get tpAmb(): number {
    return Number(process.env.SEFAZ_AMBIENTE ?? "2");
  }

  /**
   * Ciência da Operação — com validação completa pré-envio.
   *
   * Fluxo:
   *  1. validarPreCiencia() — checa CNPJ, cancelamento, idempotência
   *  2. Envia evento à SEFAZ
   *  3. Persiste resultado no banco (sefaz_manifestation_status + nSeqEvento)
   */
  async cienciaDaOperacao(
    chNFe: string,
    receiverCnpjFromXml: string,
    nsu: string,
    label: string,
  ): Promise<ManifestacaoResult> {
    // ── Validação pré-envio ───────────────────────────────────────────────────
    const validation = await validarPreCiencia({
      chNFe,
      receiverCnpjFromXml,
      nsu,
      label,
    });

    if (!validation.ok) {
      // Retorna resultado sintético sem acionar a SEFAZ
      return {
        cStat: "000",
        xMotivo: validation.reason ?? "Validação falhou",
        chNFe,
      };
    }

    const { invoice, nSeqEvento } = validation;

    // ── Envio à SEFAZ ─────────────────────────────────────────────────────────
    const wizard = await getWizard();

    let retEvento: any;

    try {
      const result = await wizard.NFE_CienciaDaOperacao({
        idLote: Date.now(),
        modelo: "55",
        evento: [
          {
            cOrgao: CUF_MG,
            tpAmb: this.tpAmb,
            CNPJ: CNPJ_DESTINATARIO,
            chNFe,
            // dhEvento calculado com fuso correto (inclui horário de verão)
            dhEvento: dhEventoBrasilia(),
            tpEvento: "210210",
            // nSeqEvento lido do banco — evita cStat=573 em reenvios
            nSeqEvento: nSeqEvento!,
            verEvento: "1.00",
            detEvento: {
              descEvento: "Ciencia da Operacao",
            },
          },
        ],
      });

      retEvento = result?.[0] ?? result;
    } catch (err: any) {
      // Falha de comunicação — não atualiza status para não mascarar a tentativa
      console.error(
        `[SEFAZ] NSU=${nsu} Filial=${label} | chNFe=${chNFe} falha no envio da Ciência:`,
        err,
      );
      throw err;
    }

    const cStat = String(retEvento?.cStat ?? "");
    const xMotivo = retEvento?.xMotivo ?? "";

    // ── Persiste resultado ────────────────────────────────────────────────────
    await this.persistirResultadoCiencia({
      invoice: invoice!,
      cStat,
      nSeqEvento: nSeqEvento!,
    });

    console.log(
      `[SEFAZ] NSU=${nsu} Filial=${label} | chNFe=${chNFe} Ciência enviada | cStat=${cStat} | ${xMotivo}`,
    );

    return {
      cStat,
      xMotivo,
      chNFe,
      dhRegEvento: retEvento?.dhRegEvento,
      nProt: retEvento?.nProt,
    };
  }

  /**
   * Atualiza o banco com o resultado da ciência enviada.
   *
   * - cStat aceito (135/136): marca CIENCIA_ENVIADA e incrementa nSeqEvento
   * - cStat 573 (já registrado): trata como aceito (idempotente na SEFAZ também)
   * - Outros cStats: marca CIENCIA_REJEITADA para reprocessamento futuro
   */
  private async persistirResultadoCiencia(params: {
    invoice: Invoice;
    cStat: string;
    nSeqEvento: number;
  }): Promise<void> {
    const { invoice, cStat, nSeqEvento } = params;

    if (CSTAT_ACEITO.has(cStat) || CSTAT_JA_REGISTRADO.has(cStat)) {
      await invoice.update({
        sefaz_manifestation_status: "CIENCIA_ENVIADA",
        // Incrementa para o próximo evento (ex: Confirmação da Operação)
        sefaz_n_seq_evento: nSeqEvento + 1,
      });
    } else if (CSTAT_CANCELADA.has(cStat)) {
      // A SEFAZ nos informou que a nota está cancelada — atualiza o status
      await invoice.update({
        status: "CANCELLED",
        sefaz_manifestation_status: "CIENCIA_REJEITADA",
      });
      console.warn(
        `[SEFAZ] chNFe=${invoice.xml_key} cancelada segundo a SEFAZ (cStat=${cStat}) — status atualizado`,
      );
    } else {
      await invoice.update({
        sefaz_manifestation_status: "CIENCIA_REJEITADA",
      });
      console.warn(
        `[SEFAZ] chNFe=${invoice.xml_key} Ciência rejeitada (cStat=${cStat}) — marcada para reprocessamento`,
      );
    }
  }

  /**
   * Confirmação da Operação — confirma que a mercadoria foi recebida.
   * Deve ser chamado após entrada efetiva no estoque.
   */
  async confirmacaoDaOperacao(chNFe: string): Promise<ManifestacaoResult> {
    const invoice = await Invoice.findOne({
      where: { xml_key: chNFe },
      attributes: ["id", "sefaz_n_seq_evento", "sefaz_manifestation_status"],
    });

    if (!invoice) {
      throw new Error(
        `[SEFAZ] Invoice não encontrada para confirmação | chNFe=${chNFe}`,
      );
    }

    if (invoice.sefaz_manifestation_status !== "CIENCIA_ENVIADA") {
      throw new Error(
        `[SEFAZ] Confirmação requer ciência prévia | chNFe=${chNFe} | status=${invoice.sefaz_manifestation_status}`,
      );
    }

    const nSeqEvento = invoice.sefaz_n_seq_evento ?? 2;
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
          dhEvento: dhEventoBrasilia(),
          tpEvento: "210200",
          nSeqEvento,
          verEvento: "1.00",
          detEvento: {
            descEvento: "Confirmacao da Operacao",
          },
        },
      ],
    });

    const retEvento = result?.[0] ?? result;
    const cStat = String(retEvento?.cStat ?? "");

    if (CSTAT_ACEITO.has(cStat)) {
      await invoice.update({
        sefaz_manifestation_status: "CONFIRMADO",
        sefaz_n_seq_evento: nSeqEvento + 1,
      });
    }

    return {
      cStat,
      xMotivo: retEvento?.xMotivo ?? "",
      chNFe,
      dhRegEvento: retEvento?.dhRegEvento,
      nProt: retEvento?.nProt,
    };
  }
}

export const nfeManifestacaoService = new NfeManifestacaoService();