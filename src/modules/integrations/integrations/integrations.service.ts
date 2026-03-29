import { FindOptions } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import Integration from "./integrations.model";
import integrationRepository, {
  IntegrationRepository,
} from "./integrations.repository";
import ConfigToken from "../config_tokens/config_tokens.model";
import { FullIntegration } from "./integrations.types";
import { redisConfig } from "../../../config/redis";
import RedisService from "../../../shared/utils/base-models/base-redis";
import Redis from "ioredis";

export class IntegrationService extends BaseService<
  Integration,
  IntegrationRepository
> {
  constructor() {
    super(integrationRepository);
  }

  // ## MÉTODOS ESPECIAIS

  // Método que busca Integração por parametros e com redisKey para buscas constantes de integração diretamente no redis
  async getFullIntegration(params: FindOptions, redisKey?: string): Promise<FullIntegration> {
    if (redisKey) {
      const cachedIntegrationsData = await RedisService.get(
        `fullintegration:${redisKey}`
      );

      if (cachedIntegrationsData != null || cachedIntegrationsData != undefined)
        return cachedIntegrationsData as unknown as Promise<FullIntegration>;;
    }

    const integrationData = await this.repository.findOne({
      include: [
        {
          model: ConfigToken,
          as: "tokens",
        },
      ],
    });

    if (!integrationData) throw new Error("Integração não encontrada.");

    await RedisService.set(
      `fullintegration:${integrationData.name}`,
      integrationData,
    );
    return integrationData as unknown as Promise<FullIntegration>;;
  }
}
export default new IntegrationService();
