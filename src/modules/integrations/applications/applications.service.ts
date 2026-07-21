import bcrypt from "bcrypt";
import axios from "axios";
import crypto from "crypto";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { DestroyOptions, FindOptions, Op, UpdateOptions } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import redisService from "../../../shared/utils/base-models/base-redis";
import Role from "../../company/users/roles/role.model";
import {
  PaginatedResult,
  QueryConfig,
  QueryParams,
} from "../../../shared/query/query.types";
import Application from "./applications.model";
import applicationRepository, {
  ApplicationRepository,
} from "./applications.repository";
import {
  ApplicationCredentials,
  ApplicationWebhookPayload,
  ApplicationLoginInput,
  ApplicationTokenPayload,
  CreateApplicationInput,
} from "./applications.types";

const SECRET = process.env.JWT_SECRET!;
const TOKEN_EXPIRES_IN = "1h";

export class ApplicationService extends BaseService<
  Application,
  ApplicationRepository
> {
  constructor() {
    super(applicationRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["name", "api_key"],
      filterableFields: ["role_id", "is_active"],
      sortableFields: ["name", "createdAt", "updatedAt", "last_login_at"],
    } satisfies QueryConfig;
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Application>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [{ model: Role, as: "role" }],
      attributes: { exclude: ["api_secret_hash"] },
    });
  }

  async findById(id: string, options?: FindOptions) {
    return super.findById(id, {
      ...options,
      include: options?.include ?? [{ model: Role, as: "role" }],
      attributes: options?.attributes ?? { exclude: ["api_secret_hash"] },
    });
  }

  async createApplication(
    data: CreateApplicationInput,
  ): Promise<{ application: Application; credentials: ApplicationCredentials }> {
    const credentials = this.generateCredentials();
    const apiSecretHash = await this.hashApiSecret(credentials.api_secret);

    const application = await this.repository.create({
      name: data.name,
      description: data.description ?? null,
      role_id: data.role_id,
      api_key: credentials.api_key,
      api_secret_hash: apiSecretHash,
      allowed_routes: this.normalizeAllowedRoutes(data.allowed_routes),
      webhook_url: this.normalizeWebhookUrl(data.webhook_url),
      rate_limit_max_requests: data.rate_limit_max_requests ?? 120,
      rate_limit_window_seconds: data.rate_limit_window_seconds ?? 60,
      is_active: data.is_active ?? true,
    });

    return { application, credentials };
  }

async delete(id: string, options?: DestroyOptions): Promise<boolean> {
  const app = await this.findById(id, {
    include: [{ model: Role, as: 'role' }]
  })

  if (!app) {
    throw new Error("Aplicativo não encontrado")
  }

  const roleId = app.role_id

  await app.destroy()

  await Role.destroy({
    where: { id: roleId }
  })

  return true
}

  async update(
    id: string,
    data: Partial<Application["_creationAttributes"]>,
    options?: Partial<UpdateOptions>,
  ) {
    const { api_key, api_secret_hash, token_version, ...safeData } = data;
    if (safeData.allowed_routes) {
      safeData.allowed_routes = this.normalizeAllowedRoutes(
        safeData.allowed_routes,
      );
    }
    if ("webhook_url" in safeData) {
      safeData.webhook_url = this.normalizeWebhookUrl(safeData.webhook_url);
    }

    const updated = await this.repository.update(id, safeData, options);
    await redisService.deleteByPattern(`application:${id}:*`);
    return updated;
  }

  async rotateSecret(id: string): Promise<ApplicationCredentials> {
    const application = await this.repository.findById(id);
    if (!application) throw new Error("Aplicativo não encontrado");

    const credentials = this.generateCredentials(application.api_key);
    const apiSecretHash = await this.hashApiSecret(credentials.api_secret);

    await application.update({
      api_secret_hash: apiSecretHash,
      token_version: application.token_version + 1,
      revoked_at: new Date(),
    });
    await redisService.deleteByPattern(`application:${id}:*`);

    return credentials;
  }

  async revokeTokens(id: string): Promise<Application> {
    const application = await this.repository.findById(id);
    if (!application) throw new Error("Aplicativo não encontrado");

    await application.update({
      token_version: application.token_version + 1,
      revoked_at: new Date(),
    });
    await redisService.deleteByPattern(`application:${id}:*`);

    return application;
  }

  async login({ api_key, api_secret }: ApplicationLoginInput) {
    const application = await this.repository.findOne({
      where: { api_key },
      include: [{ model: Role, as: "role" }],
    });

    if (!application || !application.is_active) {
      throw new Error("Aplicativo não encontrado ou inativo");
    }

    const secretHash = this.hashApiSecretSync(api_secret);
    const validSecret = await bcrypt.compare(
      secretHash,
      application.api_secret_hash,
    );
    if (!validSecret) throw new Error("Credenciais inválidas");

    const payload: ApplicationTokenPayload = {
      id: application.id,
      role: application.role_id,
      type: "application",
      tokenVersion: application.token_version,
    };
    const token = jwt.sign(payload, SECRET, { expiresIn: TOKEN_EXPIRES_IN });

    await application.update({ last_login_at: new Date() });

    return {
      token,
      expires_in: 3600,
      token_type: "Bearer",
      application: this.safeApplication(application),
    };
  }

  /**
   * Autentica uma aplicação diretamente via API key + secret, sem emitir/exigir
   * um JWT. Usado no fluxo de aplicações com `ignore_token: true`, onde a
   * própria key/secret já são consideradas credencial suficiente por request.
   *
   * Retorna a aplicação (sem o hash do secret) em caso de sucesso, ou null se
   * a key não existir, a aplicação estiver inativa, ou o secret não bater.
   * Não faz cache: como não há emissão de token, cada request revalida o
   * secret contra o hash atual (garante que rotateSecret/revokeTokens
   * invalidem o acesso imediatamente, sem depender do deleteByPattern do
   * cache de auth).
   */
  async authenticateWithApiKey(api_key: string, api_secret: string) {
    const application = await this.repository.findOne({
      where: { api_key },
      include: [{ model: Role, as: "role" }],
    });

    if (!application || !application.is_active) {
      return null;
    }

    const secretHash = this.hashApiSecretSync(api_secret);
    const validSecret = await bcrypt.compare(
      secretHash,
      application.api_secret_hash,
    );
    if (!validSecret) return null;

    await application.update({ last_login_at: new Date() });

    return this.safeApplication(application);
  }

  async getAuthenticatedApplication(applicationId: string) {
    const cached = await redisService.get(`application:${applicationId}:auth`);
    if (cached) return cached;

    const application = await this.repository.findOne({
      where: { id: applicationId, is_active: true },
      include: [{ model: Role, as: "role" }],
    });
    if (!application) return null;

    const safe = this.safeApplication(application);
    await redisService.set(`application:${applicationId}:auth`, safe, {
      mode: "EX",
      duration: 3600,
    });

    return safe;
  }

  async cleanTimeOutByIp(ip: string): Promise<void> {
    const banKey = `application-rate:ban:${ip}`;
    await redisService.client.del(banKey);
  }

  async getBanTimeRemaining(ip: string): Promise<number | null> {
    const banKey = `application-rate:ban:${ip}`;
    const banned = await redisService.get(banKey);
    if (!banned) return null;
    
    const ttl = await redisService.client.ttl(banKey);
    return ttl > 0 ? ttl : null;
  }

  async dispatchWebhookEvent(
    payload: ApplicationWebhookPayload,
    routeSegment: string,
  ): Promise<void> {
    const applications = await this.repository.findAll({
      where: {
        is_active: true,
        webhook_url: { [Op.ne]: null },
      },
      attributes: ["id", "name", "allowed_routes", "webhook_url"],
    });

    const targets = applications.filter((application) => {
      if (!application.webhook_url) return false;
      return this.applicationCanReceiveWebhook(
        application.allowed_routes,
        routeSegment,
        payload.entity,
      );
    });

    if (!targets.length) return;

    const deliveries = targets.map((application) =>
      axios.post(application.webhook_url!, payload, {
        timeout: 10_000,
        headers: {
          "Content-Type": "application/json",
          "X-Pax-Webhook-Event": payload.event,
          "X-Pax-Webhook-Entity": payload.entity,
        },
      }),
    );

    const results = await Promise.allSettled(deliveries);
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const app = targets[index];
        console.error(
          `[ApplicationsWebhook] Falha ao enviar ${payload.event}:${payload.entity} para ${app.name} (${app.id})`,
          result.reason?.message ?? result.reason,
        );
      }
    });
  }

  getAllowedApiRoutes() {
    return [
      { method: "GET", path: "/api/:resource", mode: "paginate" },
      { method: "GET", path: "/api/:resource/:id", mode: "show" },
      { method: "POST", path: "/api/:resource", mode: "create" },
      { method: "POST", path: "/api/:resource/bulk", mode: "bulkCreate" },
      { method: "PUT", path: "/api/:resource/:id", mode: "update" },
      { method: "PATCH", path: "/api/:resource/:id", mode: "update" },
      { method: "DELETE", path: "/api/:resource/:id", mode: "delete" },
      { method: "DELETE", path: "/api/:resource/bulk", mode: "bulkDelete" },
    ];
  }

  private normalizeAllowedRoutes(routes?: string[]): string[] {
    if (!routes?.length) return [];
    return [...new Set(routes.map((route) => route.trim()).filter(Boolean))];
  }

  private normalizeWebhookUrl(url?: string | null): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Protocolo inválido");
      }
      return parsed.toString();
    } catch {
      throw new Error("URL de webhook inválida");
    }
  }

  private applicationCanReceiveWebhook(
    allowedRoutes: string[],
    routeSegment: string,
    entity: string,
  ): boolean {
    if (allowedRoutes.includes("*")) return true;

    return allowedRoutes.some((route) => {
      const normalized = route
        .replace(/^\/api\/?/, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");

      return normalized === routeSegment || normalized === entity;
    });
  }

  private generateCredentials(apiKey?: string): ApplicationCredentials {
    return {
      api_key: apiKey ?? `pax_${crypto.randomBytes(24).toString("hex")}`,
      api_secret: crypto.randomBytes(48).toString("hex"),
    };
  }

  private safeApplication(application: Application) {
    const plain = application.get({ plain: true });
    const { api_secret_hash, ...safe } = plain;
    return safe;
  }

  /**
   * Hash the API secret with SHA256 first, then bcrypt.
   * This prevents the bcrypt 72-byte truncation vulnerability where
   * incomplete secrets could match if they share the same first 72 bytes.
   */
  private hashApiSecretSync(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
  }

  /**
   * Hash the API secret asynchronously with bcrypt.
   * First hashes with SHA256 to normalize length and prevent truncation issues.
   */
  private async hashApiSecret(secret: string): Promise<string> {
    const hashedSecret = this.hashApiSecretSync(secret);
    return bcrypt.hash(hashedSecret, 12);
  }
}

export default new ApplicationService();