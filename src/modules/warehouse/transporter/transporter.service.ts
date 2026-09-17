import { FindOptions, Op } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import Transporter from "./transporter.model";
import transporterRepository, {
  TransporterRepository,
} from "./transporter.repository";
import CarrierImportLayout from "./carrier-import-layouts/carrier-import-layouts.model";
import {
  QueryParams,
  PaginatedResult,
} from "../../../shared/query/query.types";
import { cleanDocument } from "../../../shared/utils/normalizers/document";

// Placeholder usado quando a NF-e genuinamente não traz transportador nenhum
// (transp.transporta ausente tanto na resposta da API quanto no XML) — nunca
// usado como fallback de "não achei a transportadora pelo documento".
const NO_TRANSPORTER_NAME = "Sem transporte";
const NO_TRANSPORTER_DOCUMENT = "0000000";

// A Bling manda nome "Entrega Própria" sem numeroDocumento — não é a mesma
// coisa que "Sem transporte" (nota sem transportador nenhum), é uma
// transportadora própria específica, então tem cnpj-sentinela próprio.
const ENTREGA_PROPRIA_NAME = "Entrega Própria";
const ENTREGA_PROPRIA_DOCUMENT = "0000000000";

export class TransporterService extends BaseService<
  Transporter,
  TransporterRepository
> {
  constructor() {
    super(transporterRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["name"],
      sortableFields: ["createdAt"],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Transporter>> {
    const transporters = await super.paginate(params, extraOptions);

    return {
      ...transporters,
      data: transporters.data.map((t) => ({
        ...t.get({ plain: true }),
        name: [t.name, t.uf, t.cnpj].filter(Boolean).join(" | "),
      })) as unknown as Transporter[],
    };
  }

  async findById(
    id: string,
    options?: FindOptions,
  ): Promise<Transporter | null> {
    return await this.repository.findById(id, {
      include: [
        {
          model: CarrierImportLayout,
          as: "importLayout",
        },
      ],
    });
  }

  // Busca a transportadora pelo documento no banco; se não achar, cadastra
  // com o que a própria API (Bling/Tecinco) ou, na falta disso, o XML da NF-e
  // já trouxe (name/city/uf) — resolução via CNPJ (openCNPJ/BrasilAPI) fica de
  // lado por ora, ver `fetchCNPJ` em cpnj_api.service.ts.
  async findOrCreateByDocument(params: {
    document: string;
    name?: string | null;
    city?: string | null;
    uf?: string | null;
    integrationsId?: string | null;
  }): Promise<Transporter | null> {
    const cleanDoc = cleanDocument(params.document);
    if (!cleanDoc) return null;

    const existing = await this.findOne({ where: { cnpj: cleanDoc } });
    if (existing) return existing;

    const name = params.name?.trim() || cleanDoc;

    const created = await this.create({
      name,
      cnpj: cleanDoc,
      city: params.city ?? "",
      uf: params.uf ?? "",
      integrations_id: params.integrationsId ?? null,
    });

    console.log(
      `[TRANSPORTER] Transportadora cadastrada: cnpj=${cleanDoc}, nome=${name}`,
    );

    return created;
  }

  // Ponto único de resolução de transportador usado pelos fetch da Bling e da
  // Tecinco: sem documento utilizável (nota genuinamente sem transportador),
  // usa/cria o placeholder "Sem transporte"; com documento, delega pra
  // findOrCreateByDocument (busca local + cadastro com name/city/uf já vindos
  // da API ou, na falta disso, do XML — quem resolve essa prioridade é o
  // chamador, antes de montar `params`).
  async resolveTransporter(params: {
    document: string | null;
    name?: string | null;
    city?: string | null;
    uf?: string | null;
    integrationsId?: string | null;
  }): Promise<Transporter | null> {
    const { document, name, city, uf, integrationsId } = params;
    const cleanDoc = document ? cleanDocument(document) : "";
    const cleanName = (name ?? "").trim().toLowerCase();

    if (!cleanDoc && cleanName === ENTREGA_PROPRIA_NAME.toLowerCase()) {
      return this.getOrCreatePlaceholderByName(
        ENTREGA_PROPRIA_NAME,
        ENTREGA_PROPRIA_DOCUMENT,
        city,
        uf,
      );
    }

    if (!cleanDoc || cleanDoc === NO_TRANSPORTER_DOCUMENT) {
      return this.getOrCreateNoTransporterPlaceholder(city, uf);
    }

    return this.findOrCreateByDocument({
      document: cleanDoc,
      name,
      city,
      uf,
      integrationsId,
    });
  }

  private getOrCreateNoTransporterPlaceholder(
    city?: string | null,
    uf?: string | null,
  ): Promise<Transporter> {
    return this.getOrCreatePlaceholderByName(
      NO_TRANSPORTER_NAME,
      NO_TRANSPORTER_DOCUMENT,
      city,
      uf,
    );
  }

  // Find-or-create genérico pros placeholders identificados por nome fixo em
  // vez de documento real ("Sem transporte", "Entrega Própria") — cada um com
  // seu próprio cnpj-sentinela.
  private async getOrCreatePlaceholderByName(
    name: string,
    document: string,
    city?: string | null,
    uf?: string | null,
  ): Promise<Transporter> {
    const existing = await this.findOne({
      where: {
        [Op.or]: [{ cnpj: document }, { name }],
      },
    });

    if (existing) {
      if (!existing.cnpj) {
        await existing.update({ cnpj: document });
      }
      return existing;
    }

    const created = await this.create({
      name,
      cnpj: document,
      city: city ?? "",
      uf: uf ?? "",
    });

    console.log(
      `[TRANSPORTER] Transportadora "${name}" criada automaticamente: cnpj=${document}`,
    );
    return created;
  }
}

export default new TransporterService();
