import { Job, UnrecoverableError } from "bullmq";
import { Op } from "sequelize";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import {
  ProductConfig,
  Product,
  SupplierMapping,
  Stock,
} from "../../../inventory";
import Customer from "../../../sales/customers/customers.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import {
  TCarProdutoPayload,
  TCarClientePayload,
  TCarInvoiceXmlPayload,
  TCarResource,
  TCarAction,
  TCarNotaFiscalItem,
} from "../service/tecinco/tecinco.types";
import { getTCarIntegration } from "../api/tecinco_api";
import {
  TCarConferenciaEstoqueService,
  TCarNotaFiscalXmlByChaveComposta,
  TCarNotaFiscalXmlByChaveNfe,
} from "../service/conferencias-estoque/conferencias-estoque.service";
import {
  InvoiceOperationalItemFromXml,
  UnmappedInvoiceItemFromXml,
  upsertInvoiceFromXml,
  extractInvoiceIdentificationFromXml,
} from "../../../../shared/utils/xml/invoice-xml";
import TCarClienteService from "../service/clientes/clientes.service";
import TCarProdutoService from "../service/produtos/produtos.service";
import { extractProductMeasureAndLine } from "../../bling/services/bling/queues/bling-api-fetch.queue";
import {
  normalizeEan,
  ensureSupplierMappings,
  resolveProductWithMapping,
  assertEanNotOwnedByAnotherProduct,
  isProductOwnedByIntegration,
  EanConflictError,
} from "./helpers/product.helpers";
import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import unmappedInvoiceProductService from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import { upsertCustomerFromTCar } from "./helpers/customer.helper";
import brandsService from "../../../inventory/brands/brands.service";
import Group from "../../../inventory/groups/group/group.model";
import Subgroup from "../../../inventory/groups/subgroup/subgroup.model";
import { GroupType } from "../../../inventory/groups/group/group.types";
import integrationMappingService from "../../../integrations/integration-mapping/integration-mapping.service";
import { IntegrationMappingCreationAttributes } from "../../../integrations/integration-mapping/integration-mapping.types";
import productService from "../../../inventory/products/services/product.service";
import { tecincoAllowedGroupNames } from "../../../../shared/constants/tecinco-groups";

function normalizeTCarDescription(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

async function findProductGroupByName(name: string): Promise<Group | null> {
  return Group.findOne({
    where: {
      type: GroupType.PRODUCTS,
      name: { [Op.iLike]: name },
    },
  });
}

async function findProductSubgroupByName(
  groupId: string,
  name: string,
): Promise<Subgroup | null> {
  return Subgroup.findOne({
    where: {
      group_id: groupId,
      name: { [Op.iLike]: name },
    },
  });
}

async function resolveTecincoProductGroup(
  data: TCarProdutoPayload,
  logPrefix: string,
): Promise<{ group: Group; subgroup: Subgroup | null } | null> {
  const groupName = normalizeTCarDescription(data.grupo_descricao);

  if (!groupName) {
    console.warn(
      `${logPrefix} — grupo_descricao não informado pela Tecinco; produto salvo sem subgroup_id.`,
    );
    return null;
  }

  let group = await findProductGroupByName(groupName);

  if (!group) {
    group = await Group.create({
      name: groupName,
      type: GroupType.PRODUCTS,
    });
    console.log(`${logPrefix} — grupo Tecinco criado: ${group.name}`);
  }

  const subgroupName = normalizeTCarDescription(data.subgrupo_descricao);

  if (!subgroupName) {
    console.warn(
      `${logPrefix} — subgrupo_descricao não informado pela Tecinco; grupo=${group.name}`,
    );
    return { group, subgroup: null };
  }

  let subgroup = await findProductSubgroupByName(group.id, subgroupName);

  if (!subgroup) {
    subgroup = await Subgroup.create({
      name: subgroupName,
      group_id: group.id,
    });
    console.log(
      `${logPrefix} — subgrupo Tecinco criado: ${group.name} > ${subgroup.name}`,
    );
  }

  return { group, subgroup };
}
export interface TCarUpsertJobPayload {
  eventId: string;
  resource: TCarResource;
  action: TCarAction;
  companyId: string;
  branchId?: number;
  data: unknown;
  /** Criação manual de produto a partir de um UnmappedInvoiceProduct — ver processProduct */
  create?: boolean;
}

export class TCarUpsertQueue extends BaseQueueService<TCarUpsertJobPayload> {
  constructor(options: { workless?: boolean } = {}) {
    super("TCAR_UPSERT", {
      concurrency: 1,
      limiter: { max: 50, duration: 1000 },
      maxProcessingMs: 120_000,
      workless: options.workless,
    });
  }

  /**
   * Importa uma NF-e a partir de um XML enviado manualmente. Antes de
   * importar, valida a nota contra a API da Tecinco pela chave de acesso
   * (mesma identificação que GET /notas-fiscais/:numero?chave_nfe= aceita) —
   * se a nota não existir lá (404), a importação falha de verdade em vez de
   * silenciosamente aceitar um XML que a Tecinco ainda não reconhece.
   * Roda síncrono, fora da fila, pra propagar erro de verdade pro chamador.
   */
  async upsertInvoiceFromXml(
    xmlContent: string,
    branchId: number,
  ): Promise<void> {
    const { numero, chaveAcesso } =
      extractInvoiceIdentificationFromXml(xmlContent);

    if (!numero || !chaveAcesso) {
      throw new Error(
        "XML sem número ou chave de acesso — não é possível validar contra a Tecinco",
      );
    }

    const logPrefix = `[TCAR_UPSERT] invoice_xml_manual numero=${numero} branchId=${branchId}`;
    const conferenciaService = new TCarConferenciaEstoqueService();
    const identificacao: TCarNotaFiscalXmlByChaveNfe = {
      chave_nfe: chaveAcesso,
    };

    let notaFiscal: any;
    try {
      notaFiscal = await conferenciaService.getNotaFiscal(
        numero,
        branchId,
        identificacao,
      );
    } catch (err: any) {
      const tecincoMessage = err?.response?.data?.message;
      throw new Error(
        tecincoMessage
          ? `Nota fiscal não encontrada na Tecinco: ${tecincoMessage}`
          : `Falha ao consultar nota fiscal na Tecinco: ${err?.message ?? err}`,
      );
    }

    const itens = notaFiscal?.data?.itens ?? [];
    const clnCodigo = notaFiscal?.data?.cliente?.codigo;

    if (clnCodigo) {
      await upsertCustomerFromTCar(branchId, clnCodigo, logPrefix);
    } else {
      console.warn(
        `${logPrefix} — cln_codigo não resolvido, customer não sincronizado`,
      );
    }

    let operationalItems: InvoiceOperationalItemFromXml[] = [];
    let unmappedItems: UnmappedInvoiceItemFromXml[] = [];

    if (Array.isArray(itens) && itens.length > 0) {
      const ensured = await this.ensureProductsFromInvoiceItems(
        itens,
        branchId,
      );
      operationalItems = ensured.operationalItems;
      unmappedItems = ensured.unmappedItems;
    } else {
      console.warn(`${logPrefix} — nota fiscal sem itens retornados`);
    }

    // Sem item de pneu resolvido nem pendente de revisão (nota sem itens, ou
    // com itens mas nenhum do grupo pneu) — não processa a invoice.
    if (operationalItems.length === 0 && unmappedItems.length === 0) {
      console.warn(
        `${logPrefix} — nenhum item de pneu na nota, invoice não processada`,
      );
      return;
    }

    await upsertInvoiceFromXml(xmlContent, {
      integrationName: "Tecinco",
      operationalItems,
      unmappedItems,
      sourcePayload: notaFiscal?.data ?? notaFiscal ?? null,
    });

    console.log(`${logPrefix} — invoice upsertada com sucesso`);
  }

  async process(job: Job<TCarUpsertJobPayload>): Promise<void> {
    const { resource, action, data, branchId } = job.data;

    console.log(
      `[TCAR_UPSERT] ${resource}.${action} | eventId=${job.data.eventId}`,
    );

    switch (resource) {
      case "invoice_xml":
        await this.processInvoiceXml(data as TCarInvoiceXmlPayload, branchId);
        break;

      case "product":
        await this.processProduct(action, data as TCarProdutoPayload, branchId, {
          create: !!job.data.create,
        });
        break;

      case "customer":
        await this.processCustomer(action, data as TCarClientePayload);
        break;

      default:
        console.warn(`[TCAR_UPSERT] Resource desconhecido: ${resource}`);
    }
  }

  // ─── Produto ───────────────────────────────────────────────────────────────

  private async processProduct(
    action: TCarAction,
    data: TCarProdutoPayload,
    branchId?: number,
    opts: { create?: boolean } = {},
  ): Promise<void> {
    const systemId = String(data.epctb_codigo);
    const logPrefix = `[TCAR_UPSERT][processProduct] id_system=${systemId}`;

    if (action === "deleted") {
      // Produto nunca mais é deletado pelo sistema — fica de histórico, só
      // desativado (is_active=false) quando encontrado via integration mapping.
      const integrations = await getTCarIntegration("Tecinco");
      const mapped = await integrationMappingService.findEntityByMapping(
        "PRODUCT",
        integrations.id,
        systemId,
      );
      if (mapped) {
        await (mapped as typeof Product.prototype).update({ is_active: false });
        console.log(`${logPrefix} — produto desativado (is_active=false), histórico mantido`);
      } else {
        console.log(`${logPrefix} — produto não encontrado via mapping, nada a desativar`);
      }
      return;
    }

    if (opts.create) {
      // ─── Criação manual (POST .../create-product) — o payload enfileirado
      // só carrega o essencial pra identificar o produto (epctb_codigo);
      // busca o detalhe completo aqui (dentro do worker, não no request
      // HTTP) e substitui `data` por ele. O self-fetch mais abaixo (linhas
      // ~343+) só backfilla productDataForGroup pra grupo/subgrupo — os
      // demais campos (ean, codigoFabrica, filiais/preço/estoque, nome)
      // são lidos direto de `data`, então sem isso aqui o produto seria
      // criado sem esses dados.
      const produtoService = new TCarProdutoService();
      const detalhe = await produtoService.obterProduto(
        branchId ?? Number(data.fll_codigo),
        systemId,
      );
      const detalheData = (detalhe?.data ?? detalhe) as
        | TCarProdutoPayload
        | undefined;

      if (!detalheData) {
        // UnrecoverableError: a API respondeu (sem erro de rede/timeout,
        // que teria lançado antes de chegar aqui) só que sem dados pra esse
        // código — sinal de que o produto não existe mais na Tecinco pra
        // esse systemId, não uma falha transitória. Retry não resolve.
        throw new UnrecoverableError(
          `${logPrefix} — não foi possível buscar detalhe do produto na Tecinco pra criação manual`,
        );
      }

      data = { ...data, ...detalheData };
      console.log(`${logPrefix} — detalhe completo buscado pra criação manual`);
    }

    // Estoque/preço por filial: quando a busca usa include=filiais, data.filiais
    // já traz todas de uma vez; senão (ex.: webhook de uma filial só), monta um
    // array de 1 posição a partir dos campos "planos" do payload (compat).
    const filiaisToProcess: Array<{
      fll_codigo: number;
      estoque: number;
      preco: number;
      custoContabil: number;
    }> =
      data.filiais && data.filiais.length > 0
        ? data.filiais.map((f) => ({
            fll_codigo: f.fll_codigo,
            estoque: Number(f.estoque_fisico ?? 0),
            preco: Number(f.preco ?? 0),
            custoContabil: Number(f.custo_contabil ?? 0),
          }))
        : [
            {
              fll_codigo: Number(data.fll_codigo ?? branchId ?? 0),
              estoque: Number(data.epcte_estoque ?? 0),
              preco: Number(data.epprc_preco ?? 0),
              custoContabil: Number(data.epcte_custcont ?? 0),
            },
          ];

    const integrations = await getTCarIntegration("Tecinco");
    const ean = normalizeEan(data.epctb_ean);
    const codigoFabrica = data.epctb_codigofabrica
      ? String(data.epctb_codigofabrica).trim()
      : undefined;

    // A Tecinco opera por loja — toda resolução de produto por EAN/
    // SupplierMapping precisa saber exatamente qual unit business é a da
    // operação (nunca "qualquer loja Tecinco"). branchId é a loja que
    // originou esse evento; sem ela não há como escopar com segurança.
    const resolvedBranchId = branchId ?? Number(data.fll_codigo);
    const operationUnitBusiness = resolvedBranchId
      ? await UnitBusiness.findOne({
          where: { number: String(resolvedBranchId).padStart(2, "0") },
        })
      : null;

    if (!operationUnitBusiness) {
      console.warn(
        `${logPrefix} — unit business não resolvida para branchId=${resolvedBranchId || "?"} — produto ignorado (sem loja da operação não há como resolver com segurança)`,
      );
      return;
    }

    let productDataForGroup: TCarProdutoPayload = data;

    if (!data.grupo_descricao || !data.subgrupo_descricao) {
      if (resolvedBranchId) {
        try {
          const produtoService = new TCarProdutoService();
          const detalhe = await produtoService.obterProduto(
            resolvedBranchId,
            systemId,
          );
          const detalheData = (detalhe?.data ?? detalhe) as
            | TCarProdutoPayload
            | undefined;

          console.log(
            `${logPrefix} — DEBUG detalhe bruto:`,
            JSON.stringify(detalhe),
          );

          if (detalheData) {
            productDataForGroup = { ...data, ...detalheData };
          } else {
            console.warn(
              `${logPrefix} — detalhe do produto veio vazio, grupo/subgrupo não resolvido`,
            );
          }
        } catch (err: any) {
          console.warn(
            `${logPrefix} — falha ao buscar detalhe do produto para resolver grupo/subgrupo: ${err?.message ?? err}`,
          );
        }
      } else {
        console.warn(
          `${logPrefix} — branchId não resolvido, não foi possível buscar detalhe do produto para grupo/subgrupo`,
        );
      }
    }

    // Só sincroniza produtos dos grupos de pneus — o resto é ignorado (não
    // cria nem atualiza nada no sistema).
    const resolvedGroupName = normalizeTCarDescription(
      productDataForGroup.grupo_descricao,
    );
    const isAllowedGroup = tecincoAllowedGroupNames.some(
      (name) => name.toLowerCase() === resolvedGroupName.toLowerCase(),
    );

    if (!isAllowedGroup) {
      console.log(
        `${logPrefix} — grupo "${resolvedGroupName || "(vazio)"}" fora dos grupos de pneus permitidos — produto ignorado`,
      );
      return;
    }

    const tecincoProductGroup = await resolveTecincoProductGroup(
      productDataForGroup,
      logPrefix,
    );

    // ─── Resolve produto SÓ por integration mapping ────────────────────────────
    let product = await resolveProductWithMapping({
      unitBusinessId: operationUnitBusiness.id,
      systemId,
      ean,
      logPrefix,
    });

    if (!product) {
      if (opts.create) {
        // ─── Criação manual disparada via unmapped (POST .../create-product) ──
        // Cria o Product+ProductConfig+IntegrationMapping e cai pro resto da
        // função normalmente — dali em diante ela já trata `product`
        // genericamente (grupo/subgrupo, estoque por filial, etc).
        product = await this.createProductFromTCarData({
          data,
          systemId,
          ean,
          codigoFabrica,
          integrations,
          operationUnitBusiness,
          filiaisToProcess,
          logPrefix,
        });
      } else {
        // ─── Sem mapping → não cria produto sozinho, registra pra revisão manual ──
        // unique_ean_integration_null_invoice é UNIQUE(ean, integrations_id)
        // WHERE invoice_id IS NULL — dois systemIds diferentes com o mesmo EAN
        // na mesma integração batem nesse índice mesmo com sku diferente,
        // então o dedup precisa checar por ean também (sempre escopado à
        // integração, já que o mesmo EAN pode legitimamente existir em
        // integrações diferentes).
        const existingUnmapped = await UnmappedInvoiceProduct.findOne({
          where: {
            invoice_id: null,
            integrations_id: integrations.id,
            ...(ean ? { [Op.or]: [{ sku: systemId }, { ean }] } : { sku: systemId }),
          },
        });
        if (existingUnmapped) {
          // Upsert: um unmapped já registrado antes desse campo existir (ou
          // criado numa passagem anterior) precisa continuar acompanhando o
          // que a Tecinco manda — em especial external_id, sem o qual o
          // endpoint de criar produto não funciona pra essa linha.
          await existingUnmapped.update({
            sku: systemId,
            ean: ean ?? null,
            external_id: systemId,
            product_name: data.epctb_nome?.trim() ?? null,
          });
          console.log(
            `${logPrefix} — unmapped já existente atualizado (external_id/dados sincronizados)`,
          );
        } else {
          await UnmappedInvoiceProduct.create({
            invoice_id: null,
            integrations_id: integrations.id,
            sku: systemId,
            ean: ean ?? null,
            external_id: systemId,
            product_name: data.epctb_nome?.trim() ?? null,
            quantity: 0,
            reason: "Produto novo, precisa de mapeamento manual",
            status: "UNMAPPED",
          });
          console.log(
            `${logPrefix} — produto novo, registrado em unmapped_invoice_products pra revisão manual`,
          );
        }
        return;
      }
    }

    const isOwnProduct = isProductOwnedByIntegration(product, integrations.id);

    // ─── Produto de outra integração → apenas vincula, não sobrescreve ────────
    // (brand_id não é tocado aqui de propósito: o produto pertence a outra
    // integração, então não sobrescrevemos os dados "donos" dele, só o
    // ProductConfig/SupplierMapping relativos a esta filial.)
    if (!isOwnProduct) {
      console.log(
        `${logPrefix} — produto pertence a outra integração (id=${product.integrations_id}) — apenas vinculando`,
      );

      for (const filial of filiaisToProcess) {
        const filialNumber = String(filial.fll_codigo).padStart(2, "0");
        const unitBusiness = await UnitBusiness.findOne({
          where: { number: filialNumber },
        });
        const supplierCnpj = unitBusiness?.cnpj ?? null;

        if (supplierCnpj && unitBusiness) {
          const entryUnitCost = filial.custoContabil;
          const stockQty = Math.round(filial.estoque);

          const existingStock = await Stock.findOne({
            where: { product_id: product.id, unit_business_id: unitBusiness.id },
          });
          const oldQuantity = Number(existingStock?.quantity ?? 0);
          const oldTotalPrice = Number(existingStock?.total_price ?? 0);
          const newAverageCost =
            entryUnitCost > 0
              ? entryUnitCost
              : oldQuantity > 0
                ? oldTotalPrice / oldQuantity
                : 0;

          try {
            await assertEanNotOwnedByAnotherProduct({
              productId: product.id,
              unitBusinessId: unitBusiness.id,
              candidates: [{ field: "ean", value: ean }],
              logPrefix,
            });
          } catch (error: any) {
            if (error instanceof EanConflictError) {
              alertService.sendAlert({
                severity: "CRITICAL",
                title: "Conflito de EAN entre produtos (Tecinco)",
                message: `${error.message} | systemId=${systemId} | filial=${filialNumber}`,
              });
              console.warn(
                `${logPrefix} — ProductConfig da filial=${filialNumber} não atualizado por conflito de EAN`,
              );
              continue;
            }
            throw error;
          }

          await ProductConfig.upsert(
            {
              product_id: product.id,
              unit_business_id: unitBusiness.id,
              sku: codigoFabrica ?? systemId,
              gtin: ean ?? undefined,
              price: filial.preco,
              supplier_cost_price: entryUnitCost,
              average_cost: newAverageCost,
            },
            { conflictFields: ["product_id", "unit_business_id"] },
          );

          // Estoque é dado da filial, não do "dono" do Product — precisa ser
          // sincronizado mesmo quando o produto pertence a outra integração,
          // senão o produto fica com preço/custo atualizados mas estoque
          // parado (era só ProductConfig sendo tocado aqui antes).
          await Stock.upsert(
            {
              product_id: product.id,
              unit_business_id: unitBusiness.id,
              quantity: stockQty,
              total_price: stockQty * newAverageCost,
            },
            { conflictFields: ["product_id", "unit_business_id"] },
          );

          await ensureSupplierMappings({
            productId: product.id,
            supplierCnpj,
            ean,
            codigoFabrica,
            unitBusinessId: unitBusiness.id,
            logPrefix,
          });
        } else {
          console.warn(
            `${logPrefix} — CNPJ do fornecedor não resolvível para filial=${filialNumber} — SupplierMapping não registrado`,
          );
        }
      }

      // A Tecinco é a fonte de verdade real de grupo/subgrupo — mesmo num
      // produto "dono" de outra integração (não sobrescrevemos brand/nome/
      // etc dele), o subgroup_id continua sendo dela pra classificar.
      if (
        tecincoProductGroup?.subgroup?.id &&
        product.subgroup_id !== tecincoProductGroup.subgroup.id
      ) {
        await product.update({ subgroup_id: tecincoProductGroup.subgroup.id });
        console.log(
          `${logPrefix} — subgroup atualizado mesmo sendo produto de outra integração (classificação de grupo é sempre da Tecinco): ${tecincoProductGroup.subgroup.id}`,
        );
      }

      return;
    }

    // ─── Produto próprio da Tecinco: cria ou atualiza ─────────────────────────
    const { measure, line } = extractProductMeasureAndLine(
      data.epctb_nome,
      data.marca_descricao,
    );

    // Resolve a Brand cadastrada mais parecida com o nome vindo da TCar
    // (ex: "Conti" -> "Continental"). Se não achar nada parecido o
    // suficiente, cria a brand automaticamente com o nome vindo da TCar.
    const matchedBrand = await brandsService.findOrCreateBrand(
      data.marca_descricao,
    );

    const upsertedProduct = await productService.upsertWithComponents({
      id: product.id,
      values: {
        id_system: systemId,
        name: data.epctb_nome?.trim() ?? "",
        unit: data.epctb_unidade,
        gross_weight: data.epctb_pesobruto,
        net_weight: data.epctb_pesoliq,
        category: "TIRE",
        measure,
        line,
        brand: data.marca_descricao,
        brand_id: matchedBrand?.id ?? null,
        subgroup_id: tecincoProductGroup?.subgroup?.id,
        integrations_id: integrations.id,
        source_payload: data as unknown as Record<string, unknown>,
      },
    });
    product = upsertedProduct;
    console.log(`${logPrefix} — produto upsertado: id=${product.id}`);

    // ─── ProductConfig + Stock por filial ──────────────────────────────────────
    for (const filial of filiaisToProcess) {
      const filialNumber = String(filial.fll_codigo).padStart(2, "0");
      const unitBusiness = await UnitBusiness.findOne({
        where: { number: filialNumber },
      });

      if (!unitBusiness) {
        console.warn(
          `${logPrefix} — UnitBusiness não encontrada para fll_codigo=${filialNumber}`,
        );
        continue;
      }

      const entryUnitCost = filial.custoContabil;
      const stockQty = Math.round(filial.estoque);

      const existingStock = await Stock.findOne({
        where: { product_id: product.id, unit_business_id: unitBusiness.id },
      });
      const oldQuantity = Number(existingStock?.quantity ?? 0);
      const oldTotalPrice = Number(existingStock?.total_price ?? 0);
      const newAverageCost =
        entryUnitCost > 0
          ? entryUnitCost
          : oldQuantity > 0
            ? oldTotalPrice / oldQuantity
            : 0;

      // ─── EAN não pode "misturar" com outro product ─────────────────────────
      // Checagem por filial — cada unit_business tem seu próprio ProductConfig,
      // então uma colisão numa loja não implica colisão nas outras (ver o bug
      // real que isso corrigiu: checar só a operationUnitBusiness antes do
      // loop deixava passar colisão nas demais filiais).
      let eanConflict = false;
      try {
        await assertEanNotOwnedByAnotherProduct({
          productId: product.id,
          unitBusinessId: unitBusiness.id,
          candidates: [{ field: "ean", value: ean }],
          logPrefix,
        });
      } catch (error: any) {
        if (error instanceof EanConflictError) {
          alertService.sendAlert({
            severity: "CRITICAL",
            title: "Conflito de EAN entre produtos (Tecinco)",
            message: `${error.message} | systemId=${systemId} | filial=${filialNumber}`,
          });
          console.warn(
            `${logPrefix} — ProductConfig da filial=${filialNumber} não atualizado por conflito de EAN`,
          );
          eanConflict = true;
        } else {
          throw error;
        }
      }

      if (!eanConflict) {
        await ProductConfig.upsert(
          {
            product_id: product.id,
            unit_business_id: unitBusiness.id,
            sku: codigoFabrica ?? systemId,
            gtin: ean ?? undefined,
            price: filial.preco,
            supplier_cost_price: entryUnitCost,
            average_cost: newAverageCost,
            average_cost_updated_at: new Date(),
          },
          { conflictFields: ["product_id", "unit_business_id"] },
        );
      }

      await Stock.upsert(
        {
          product_id: product.id,
          unit_business_id: unitBusiness.id,
          quantity: stockQty,
          total_price: stockQty * newAverageCost,
        },
        { conflictFields: ["product_id", "unit_business_id"] },
      );

      console.log(
        `${logPrefix} — Stock upsertado (filial=${filialNumber}): qty=${stockQty} | avg_cost=${newAverageCost.toFixed(4)} | total_price=${(stockQty * newAverageCost).toFixed(2)}`,
      );

      // ─── SupplierMappings ───────────────────────────────────────────────────
      await ensureSupplierMappings({
        productId: product.id,
        supplierCnpj: unitBusiness.cnpj ?? "00000000000000",
        ean,
        codigoFabrica,
        unitBusinessId: unitBusiness.id,
        logPrefix,
      });
    }
  }

  // ─── Cria o Product a partir dos dados do ERP quando disparado manualmente
  // via unmapped (create-product), fazendo o mapping apontar pra ele e
  // resolvendo o UnmappedInvoiceProduct de origem (ver
  // UnmappedInvoiceProductService.resolveFromCreatedProduct). O resto de
  // processProduct trata o produto retornado genericamente daqui pra frente
  // (grupo/subgrupo, estoque por filial, etc).
  private async createProductFromTCarData(params: {
    data: TCarProdutoPayload;
    systemId: string;
    ean: string | undefined;
    codigoFabrica: string | undefined;
    integrations: Awaited<ReturnType<typeof getTCarIntegration>>;
    operationUnitBusiness: UnitBusiness;
    filiaisToProcess: Array<{
      fll_codigo: number;
      estoque: number;
      preco: number;
      custoContabil: number;
    }>;
    logPrefix: string;
  }): Promise<Product> {
    const {
      data,
      systemId,
      ean,
      codigoFabrica,
      integrations,
      operationUnitBusiness,
      filiaisToProcess,
      logPrefix,
    } = params;

    const resolvedBranchId = Number(operationUnitBusiness.number);
    const matchingFilial =
      filiaisToProcess.find((f) => f.fll_codigo === resolvedBranchId) ??
      filiaisToProcess[0];

    // products.id_system é único globalmente no banco (products_id_system_key).
    // Se já existe um Product com esse id_system mas resolveProductWithMapping
    // não achou (mapping ausente/órfão pra essa integração), NÃO reconecta
    // sozinho — resolver por id_system direto já causou bug antes (produto
    // errado escolhido quando o id_system foi reaproveitado/alterado do lado
    // de fora sem o mapping acompanhar, ver resolveProductByMappingOnly em
    // product.helpers.ts). Falha com erro claro pra revisão manual, em vez
    // de deixar productService.create estourar a constraint.
    const conflictingProduct = await Product.findOne({
      where: { id_system: systemId },
    });
    if (conflictingProduct) {
      // UnrecoverableError: dado a mesma entrada, essa checagem vai falhar
      // igual em qualquer tentativa — não é erro transitório, retry não
      // ajuda. Pula direto pra "failed" (ver BaseQueueService.add).
      throw new UnrecoverableError(
        `Não foi possível criar o produto "${data.epctb_nome}": já existe um produto "${conflictingProduct.name}" com esse mesmo id do ERP no cadastro, mas sem mapping válido pra esta integração (provavelmente dado legado). Encaminhe este erro para o time técnico investigar. [${logPrefix} — produto conflitante id=${conflictingProduct.id}, id_system=${systemId}]`,
      );
    }

    let newProduct: Product;
    try {
      newProduct = await productService.create({
        name: data.epctb_nome?.trim() ?? "",
        id_system: systemId,
        category: "TIRE",
        integrations_id: integrations.id,
        config: {
          unit_business_id: operationUnitBusiness.id,
          sku: codigoFabrica ?? systemId,
          gtin: ean,
          price: matchingFilial?.preco ?? 0,
        },
      });
    } catch (err: any) {
      // Qualquer erro aqui (conflito de EAN, constraint do banco, etc.) é
      // sobre os dados já resolvidos deste produto — determinístico, uma
      // nova tentativa com os mesmos dados falha do mesmo jeito.
      throw new UnrecoverableError(err.message);
    }

    await integrationMappingService.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: newProduct.id,
      integrations_id: integrations.id,
      external_id: systemId,
    });

    console.log(
      `${logPrefix} — produto criado manualmente a partir de unmapped (product_id=${newProduct.id})`,
    );

    await unmappedInvoiceProductService.resolveFromCreatedProduct({
      externalId: systemId,
      integrationsId: integrations.id,
    });

    return newProduct;
  }

  // ─── Cliente ───────────────────────────────────────────────────────────────

  private async processCustomer(
    action: TCarAction,
    data: TCarClientePayload,
  ): Promise<void> {
    const systemId = String(data.cln_codigo);
    const document = data.cln_cpfcnpj?.replace(/\D/g, "") || null;

    if (action === "deleted") {
      // Customer não tem id_system — deleta pelo document se disponível
      if (!document) {
        console.warn(
          `[TCAR_UPSERT] Delete de cliente cln_codigo=${systemId} sem document — ignorado`,
        );
        return;
      }
      const deleted = await Customer.destroy({ where: { document } });
      console.log(
        `[TCAR_UPSERT] Cliente deletado: document=${document} (${deleted} reg)`,
      );
      return;
    }

    if (!document) {
      console.warn(
        `[TCAR_UPSERT] Cliente cln_codigo=${systemId} sem CPF/CNPJ — ignorado`,
      );
      return;
    }

    const name = data.cln_nome?.trim() ?? "";
    const type: "F" | "J" = data.cln_fisjur === "J" ? "J" : "F";

    const existing = await Customer.findOne({ where: { document } });

    if (existing) {
      await existing.update({ name, type });
    } else {
      await Customer.create({ name, type, document });
    }

    console.log(`[TCAR_UPSERT] Cliente upsertado: document=${document}`);
  }

  // ─── Invoice XML ───────────────────────────────────────────────────────────

  private resolveInvoiceTypeFromEntradaSaida(
    entradaSaida: string | null | undefined,
  ): "INCOMING" | "OUTGOING" | undefined {
    const normalized = entradaSaida?.trim().toLowerCase();
    if (normalized === "e") return "INCOMING";
    if (normalized === "s") return "OUTGOING";

    console.warn(
      `[TCAR_UPSERT] entrada_saida inesperado: "${entradaSaida}" — tipo não resolvido`,
    );
    return undefined;
  }

  private async processInvoiceXml(
    data: TCarInvoiceXmlPayload,
    branchId?: number,
  ): Promise<void> {
    if (!branchId) {
      console.warn("[TCAR_UPSERT] processInvoiceXml sem branchId — ignorado");
      return;
    }
    const { numero, entrada_saida, ...identificacao } = data;
    const logPrefix = `[TCAR_UPSERT] invoice_xml numero=${numero} branchId=${branchId}`;

    const invoiceType = this.resolveInvoiceTypeFromEntradaSaida(entrada_saida);

    const conferenciaService = new TCarConferenciaEstoqueService();
    const chaveComposta = identificacao as TCarNotaFiscalXmlByChaveComposta;
    let notaFiscal: any | null = null;
    let operationalItems: InvoiceOperationalItemFromXml[] = [];
    let unmappedItems: UnmappedInvoiceItemFromXml[] = [];
    let detailFetchFailed = false;

    // ─── Busca detalhe da nota fiscal e garante produtos dos itens ───────────
    try {
      notaFiscal = await conferenciaService.getNotaFiscal(
        numero,
        branchId,
        chaveComposta,
      );

      const itens = notaFiscal?.data?.itens ?? [];
      const clnCodigo = notaFiscal?.data?.cliente?.codigo ?? data.cln_codigo;

      // ─── Upsert do customer da nota ──────────────────────────────────────
      if (clnCodigo) {
        await upsertCustomerFromTCar(branchId, clnCodigo, logPrefix);
      } else {
        console.warn(
          `${logPrefix} — cln_codigo não resolvido, customer não sincronizado`,
        );
      }

      if (Array.isArray(itens) && itens.length > 0) {
        const ensuredItems = await this.ensureProductsFromInvoiceItems(
          itens,
          branchId,
        );
        operationalItems = ensuredItems.operationalItems;
        unmappedItems = ensuredItems.unmappedItems;
      } else {
        console.warn(`${logPrefix} — nota fiscal sem itens retornados`);
      }
    } catch (err: any) {
      detailFetchFailed = true;
      if (err?.response?.status === 404) {
        console.warn(
          `${logPrefix} — detalhe da nota fiscal não encontrado (404), seguindo sem upsert de produtos`,
        );
      } else {
        console.error(
          `${logPrefix} — erro ao buscar detalhe da nota fiscal: ${err?.message ?? err}`,
        );
      }
    }

    // Sem item de pneu resolvido nem pendente de revisão (nota sem itens, ou
    // com itens mas nenhum do grupo pneu) — não processa a invoice. Não se
    // aplica quando a busca do detalhe falhou (404/erro): aí genuinamente não
    // sabemos o que tem na nota, então segue pro fallback via XML bruto.
    if (
      !detailFetchFailed &&
      operationalItems.length === 0 &&
      unmappedItems.length === 0
    ) {
      console.warn(
        `${logPrefix} — nenhum item de pneu na nota, invoice não processada`,
      );
      return;
    }

    let xml: string | null = null;

    try {
      xml = await conferenciaService.buscarXmlNotaFiscal(
        branchId,
        numero,
        chaveComposta,
      );
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.warn(`${logPrefix} — XML não disponível (404), ignorando`);
        return;
      }
      throw err;
    }

    if (!xml?.trim()) {
      console.warn(`${logPrefix} — XML vazio, ignorando`);
      return;
    }

    await upsertInvoiceFromXml(xml, {
      integrationName: "Tecinco",
      operationalItems,
      unmappedItems,
      sourcePayload: notaFiscal?.data ?? notaFiscal ?? null,
      invoiceType,
    });
    console.log(`${logPrefix} — invoice upsertada com sucesso`);
  }

  private async ensureProductsFromInvoiceItems(
    itens: TCarNotaFiscalItem[],
    branchId: number,
  ): Promise<{
    operationalItems: InvoiceOperationalItemFromXml[];
    unmappedItems: UnmappedInvoiceItemFromXml[];
  }> {
    const operationalItems: InvoiceOperationalItemFromXml[] = [];
    const unmappedItems: UnmappedInvoiceItemFromXml[] = [];

    // Item sem epctb_codigo não é um "produto pendente de revisão" — é a nota
    // vindo sem dado nenhum pro item (comum em compra de uso e consumo, não
    // pneu). Um item assim já invalida a confiança na nota inteira, então
    // ignora a nota toda em vez de processar só os itens que têm código.
    const hasItemWithoutCode = itens.some(
      (item) => !String(item.epctb_codigo ?? "").trim(),
    );
    if (hasItemWithoutCode) {
      console.warn(
        `[TCAR_UPSERT] item sem epctb_codigo na nota (branchId=${branchId}) — nota ignorada por completo`,
      );
      return { operationalItems: [], unmappedItems: [] };
    }

    const unitBusiness = await UnitBusiness.findOne({
      where: { number: String(branchId).padStart(2, "0") },
    });

    if (!unitBusiness) {
      // Sem unit business não há como escopar a resolução por EAN/
      // SupplierMapping com segurança (a Tecinco opera por loja) — os itens
      // ficam todos como unmapped em vez de arriscar resolver contra a loja
      // errada.
      console.warn(
        `[TCAR_UPSERT] UnitBusiness não encontrada para branchId=${branchId} — produtos da nota não serão vinculados`,
      );
      return {
        operationalItems: [],
        unmappedItems: itens.map((item) => ({
          sku: item.epctb_codigo ? String(item.epctb_codigo).trim() : null,
          gtin: null,
          qty: Number(item.epeit_qtdade ?? 0),
          xProd: item.produto_nome ?? null,
          reason: `UnitBusiness não encontrada para branchId=${branchId}`,
        })),
      };
    }

    const produtoService = new TCarProdutoService();

    for (const item of itens) {
      // hasItemWithoutCode já garantiu, acima, que todo item aqui tem
      // epctb_codigo.
      const systemId = String(item.epctb_codigo).trim();
      const logPrefix = `[TCAR_UPSERT][ensureProducts] seq=${item.epeit_seq} systemId=${systemId}`;

      // ─── Busca Tecinco API para obter codigoFabrica e EAN ────────────────────
      let tcarPayload: any = null;
      let codigoFabrica: string | undefined;
      let ean: string | undefined;

      try {
        const resultado = await produtoService.obterProduto(branchId, systemId);
        tcarPayload = resultado?.data ?? resultado;
        codigoFabrica = tcarPayload?.epctb_codigofabrica
          ? String(tcarPayload.epctb_codigofabrica).trim()
          : undefined;
        ean = normalizeEan(tcarPayload?.epctb_ean);
      } catch (err: any) {
        console.warn(
          `${logPrefix} — falha ao buscar produto na Tecinco: ${err?.message ?? err}`,
        );
      }

      // ─── Fora do grupo pneu → ignora o item da nota ────────────────────────────
      // Mesmo critério do catalog sync (processProduct): só nos interessam
      // produtos de pneu. Item de outro grupo (óleo, válvula, chumbo etc.) não
      // vira unmapped nem operational — é só ignorado. Só filtra quando o
      // grupo foi de fato resolvido (tcarPayload disponível); falha na busca
      // do produto não deve bloquear a resolução por mapping como antes.
      const resolvedGroupName = tcarPayload
        ? normalizeTCarDescription(tcarPayload.grupo_descricao)
        : "";
      const isKnownNonTireGroup =
        resolvedGroupName.length > 0 &&
        !tecincoAllowedGroupNames.some(
          (name) => name.toLowerCase() === resolvedGroupName.toLowerCase(),
        );

      if (isKnownNonTireGroup) {
        console.log(
          `${logPrefix} — grupo "${resolvedGroupName}" fora dos grupos de pneus permitidos — item da nota ignorado`,
        );
        continue;
      }

      // ─── Resolve produto SÓ por integration mapping ────────────────────────────
      const product = await resolveProductWithMapping({
        unitBusinessId: unitBusiness.id,
        systemId,
        ean,
        logPrefix,
      });

      // ─── Produto não encontrado → ignora item ─────────────────────────────────
      if (!product) {
        console.warn(`${logPrefix} — produto não encontrado, ignorando item`);
        unmappedItems.push({
          sku: systemId,
          gtin: ean ?? null,
          qty: Number(item.epeit_qtdade ?? 0),
          xProd: item.produto_nome ?? null,
          reason:
            "Produto Tecinco presente na nota mas sem produto correspondente no banco",
        });
        continue;
      }

      // ─── Garante ProductConfig para a unit_business ───────────────────────────
      if (unitBusiness) {
        const existingConfig = await ProductConfig.findOne({
          where: { product_id: product.id, unit_business_id: unitBusiness.id },
        });

        if (!existingConfig) {
          const skuToUse = codigoFabrica ?? systemId;

          let eanConflict = false;
          try {
            await assertEanNotOwnedByAnotherProduct({
              productId: product.id,
              unitBusinessId: unitBusiness.id,
              candidates: [{ field: "ean", value: ean }],
              logPrefix,
            });
          } catch (error: any) {
            if (error instanceof EanConflictError) {
              alertService.sendAlert({
                severity: "CRITICAL",
                title: "Conflito de EAN entre produtos (Tecinco)",
                message: `${error.message} | systemId=${systemId}`,
              });
              console.warn(
                `${logPrefix} — ProductConfig não criado por conflito de EAN`,
              );
              eanConflict = true;
            } else {
              throw error;
            }
          }

          if (!eanConflict) {
            await ProductConfig.upsert(
              {
                product_id: product.id,
                unit_business_id: unitBusiness.id,
                sku: skuToUse,
                gtin: ean ?? undefined,
                price: Number(tcarPayload?.epprc_preco ?? 0),
                supplier_cost_price: Number(
                  tcarPayload?.epcte_custcont ?? item.epeit_vlrunit ?? 0,
                ),
                average_cost: Number(
                  tcarPayload?.epcte_custcont ?? item.epeit_vlrunit ?? 0,
                ),
                average_cost_updated_at: new Date(),
              },
              { conflictFields: ["product_id", "unit_business_id"] },
            );
            console.log(
              `${logPrefix} — ProductConfig garantido: sku=${skuToUse}`,
            );
          }
        }
      }

      // ─── SupplierMappings ─────────────────────────────────────────────────────
      await ensureSupplierMappings({
        productId: product.id,
        supplierCnpj: unitBusiness.cnpj ?? "00000000000000",
        ean,
        codigoFabrica,
        unitBusinessId: unitBusiness.id,
        logPrefix,
        systemId,
      });

      operationalItems.push({
        product_id: product.id,
        quantity_expected: Number(item.epeit_qtdade ?? 0),
        item_number: Number(item.epeit_seq ?? operationalItems.length + 1),
        sku: systemId,
        gtin: ean ?? null,
        description: item.produto_nome ?? null,
        unit_price: Number(item.epeit_vlrunit ?? 0),
        total_value: Number(item.epeit_vlrliquido ?? 0),
      });
    }

    return { operationalItems, unmappedItems };
  }

  protected override onFailed(
    job: Job<TCarUpsertJobPayload>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "HIGH",
      title: "TCarUpsertQueue — job esgotou tentativas",
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}
