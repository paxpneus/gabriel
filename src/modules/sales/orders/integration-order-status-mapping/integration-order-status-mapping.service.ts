import { Op } from "sequelize";
import IntegrationOrderStatusMapping from "./integration-order-status-mapping.model";
//AJUSTAR DEPOIS QUANDO AUTOMACAO VOLTAR NA BLING E AQUI PARA OS STATUS QUE ESTAO COMO CANCELADOS ANALISAR QUAIS DEVEM IR PARA EM OPEN COMPLETED E CANCELLED
export const BLING_STATUS_DEFAULTS = [
  { external_status_id: "6",      external_status_value: "Em aberto",                   normalized_status: "EM_ABERTO",                    display_name: "Em Aberto",                    is_cancelled: false, is_final: false },
  { external_status_id: "9",      external_status_value: "Atendido",                    normalized_status: "ATENDIDO",                     display_name: "Atendido",                     is_cancelled: false, is_final: true  },
  { external_status_id: "12",     external_status_value: "Cancelado",                   normalized_status: "CANCELADO",                    display_name: "Cancelado",                    is_cancelled: true,  is_final: false },
  { external_status_id: "15",     external_status_value: "Em andamento",                normalized_status: "EM_ANDAMENTO",                 display_name: "Em Andamento",                 is_cancelled: true,  is_final: false },
  { external_status_id: "21",     external_status_value: "Em digitação",                normalized_status: "EM_DIGITAÇÃO",                 display_name: "Em Digitação",                 is_cancelled: true,  is_final: false },
  { external_status_id: "748748", external_status_value: "NFE Agendada",                normalized_status: "NFE_AGENDADA",                 display_name: "NFE Agendada",                 is_cancelled: true,  is_final: false },
  { external_status_id: "748772", external_status_value: "Aguardando Verificação Humana", normalized_status: "AGUARDANDO_VERIFICACAO_HUMANA", display_name: "Aguardando Verificação Humana", is_cancelled: true, is_final: false },
  { external_status_id: "728250", external_status_value: "Aprovação de Desconto",       normalized_status: "APROVAÇÃO_DE_DESCONTO",        display_name: "Aprovação de Desconto",        is_cancelled: true,  is_final: false },
  { external_status_id: "748743", external_status_value: "Aguardando Agendamento NFE",       normalized_status: "AGUARDANDO_AGENDAMENTO_NFE",        display_name: "Aguardando Agendamento NFE",        is_cancelled: true,  is_final: false },
  { external_status_id: "834029", external_status_value: "Enviado",       normalized_status: "ENVIADO_TRANSPORTE",        display_name: "Enviado Para Transporte",        is_cancelled: false,  is_final: true },
  { external_status_id: "834030", external_status_value: "Entregue",       normalized_status: "ENTREGUE",        display_name: "Entregue ao Cliente",        is_cancelled: false,  is_final: true },
];

export class IntegrationOrderStatusMappingService {

  async findByIntegration(integrationId: string) {
    return IntegrationOrderStatusMapping.findAll({
      where: { integration_id: integrationId },
    });
  }

  async findOne(integrationId: string, externalStatusId: string) {
    return IntegrationOrderStatusMapping.findOne({
      where: { integration_id: integrationId, external_status_id: externalStatusId },
    });
  }

  // Uma query só pra todas as integrações de uma vez — usado por
  // OrderService.paginate() pra montar o lookup integration_id+external_status_id
  // -> display_name de uma página inteira de pedidos sem N+1.
  async findByIntegrations(integrationIds: string[]) {
    if (!integrationIds.length) return [];

    return IntegrationOrderStatusMapping.findAll({
      where: { integration_id: { [Op.in]: integrationIds } },
    });
  }

  // Traduz normalized_status (ex: "CANCELADO", "ATENDIDO" — o vocabulário
  // que o filtro filters[status] usa há tempos) pros external_status_id
  // (actual_situation) correspondentes, pra filtrar orders direto por
  // actual_situation sem depender de sales_order_snapshots.
  async findExternalStatusIdsByNormalizedStatus(
    normalizedStatuses: string[],
  ): Promise<string[]> {
    if (!normalizedStatuses.length) return [];

    const rows = await IntegrationOrderStatusMapping.findAll({
      where: { normalized_status: { [Op.in]: normalizedStatuses } },
      attributes: ["external_status_id"],
    });

    return rows.map((row) => row.external_status_id);
  }

  async upsert(
    integrationId: string,
    externalStatusId: string,
    data: {
      external_status_value?: string;
      normalized_status: string;
      display_name: string;
      is_cancelled?: boolean;
      is_final?: boolean;
    },
  ) {
    const [record] = await IntegrationOrderStatusMapping.upsert({
      integration_id:        integrationId,
      external_status_id:    externalStatusId,
      external_status_value: data.external_status_value,
      normalized_status:     data.normalized_status,
      display_name:          data.display_name,
      is_cancelled:          data.is_cancelled ?? false,
      is_final:              data.is_final ?? false,
    });

    return record;
  }

  // Garante que os mapeamentos padrão da Bling existem para a integração.
  // Usa findOrCreate para não sobrescrever customizações existentes.
  async ensureBlingDefaults(integrationId: string) {
    const results = await Promise.all(
      BLING_STATUS_DEFAULTS.map((s) =>
        IntegrationOrderStatusMapping.findOrCreate({
          where: {
            integration_id:     integrationId,
            external_status_id: s.external_status_id,
          },
          defaults: {
            integration_id:        integrationId,
            external_status_id:    s.external_status_id,
            external_status_value: s.external_status_value,
            normalized_status:     s.normalized_status,
            display_name:          s.display_name,
            is_cancelled:          s.is_cancelled,
            is_final:              s.is_final,
          },
        }),
      ),
    );

    return results.map(([record, created]) => ({ record, created }));
  }
}

export const integrationOrderStatusMappingService = new IntegrationOrderStatusMappingService();
export default integrationOrderStatusMappingService;