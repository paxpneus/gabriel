import { Request, Response } from 'express';
import { Op, WhereAttributeHash, WhereOptions } from 'sequelize';
import BaseController from '../../../shared/utils/base-models/base-controller';
import SupplierMapping from './supplier-mapping.model';
import SupplierMappingService from './supplier-mapping.service';
import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import { getUserContext } from '../../../shared/query/get-logged-user';
import { resolveIntegrationsIdForUnitBusiness } from '../../handlers/tecinco/queues/helpers/product.helpers';
import unmappedInvoiceProductService from '../unmapped-invoice-product/unmapped-invoice-product.service';
import userConfigService from '../../company/users/user_config/user_config.service';
import { FULL_ACCESS_USER_TYPES } from '../../../shared/constants/user-types';
import {
  INTEGRATION_PENDING_SECTIONS,
  IntegrationPendingSection,
  SupplierMappingAttributes,
  SupplierMappingError,
} from './supplier-mapping.types';

export class SupplierMappingController extends BaseController<SupplierMapping, typeof SupplierMappingService> {
  constructor() {
    super(SupplierMappingService);

    this.router.post(
      '/from-unmapped',
      ...this.mw('createFromUnmapped'),
      this.createFromUnmapped,
    );

    this.router.get(
      '/product/:productId',
      ...this.mw('findByProductId'),
      this.findByProductId,
    );
    this.router.get(
      '/integration-pending/get',
      ...this.mw('integrationPending'),
      this.integrationPending,
    );
    this.router.post(
      '/product/:productId',
      ...this.mw('createForProduct'),
      this.createForProduct,
    );
    this.router.post(
      '/product/:productId/physical-owner',
      ...this.mw('assignPhysicalOwner'),
      this.assignPhysicalOwner,
    );
    this.router.put(
      '/product/:productId/:id',
      ...this.mw('updateForProduct'),
      this.updateForProduct,
    );
    this.router.delete(
      '/product/:productId/:id',
      ...this.mw('deleteForProduct'),
      this.deleteForProduct,
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      createFromUnmapped: [authenticate, userPermissions],
      findByProductId: [authenticate, userPermissions],
      createForProduct: [authenticate, userPermissions],
      updateForProduct: [authenticate, userPermissions],
      deleteForProduct: [authenticate, userPermissions],
      // userPermissions resolve a entidade physical_ean_owner pela rota (CUSTOM_ROUTE_MAP "physical-owner").
      assignPhysicalOwner: [authenticate, userPermissions],
      integrationPending: [authenticate, userPermissions],
    };
  }

  private async resolveIntegrationsId(req: Request): Promise<string> {
    const { unitBusinessId } = await getUserContext(req);
    return resolveIntegrationsIdForUnitBusiness(unitBusinessId);
  }

  // admin/developer (user_config.type) — únicos que alteram/removem EAN físico confirmado e veem o relatório de pendências.
  private async canManageOverride(req: Request): Promise<boolean> {
    const userId = (req as any).user?.id;
    if (!userId) return false;
    const config = await userConfigService.findOne({ where: { user_id: userId }, attributes: ['type'] });
    return !!config && FULL_ACCESS_USER_TYPES.includes(config.type);
  }

  // Erro de regra com code (SupplierMappingError) vai com code/owners/override/can_confirm_physical_owner pro front decidir a próxima tela.
  private async errorResponse(req: Request, res: Response, error: any): Promise<Response> {
    if (error instanceof SupplierMappingError) {
      return res.status(400).json(await this.service.buildErrorResponse(error, req.cookies?.token));
    }
    return res.status(400).json({ error: error.message });
  }

  // GET /integration-pending/get?section=overrides|erp_duplicates|missing_ean|unmapped — relatório de pendências de
  // integração (lista completa, sem paginação), só admin/developer, na integração do usuário. Seção ausente/inválida → overrides.
  integrationPending = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.canManageOverride(req))) {
        return res.status(403).json({ error: 'Somente administradores podem ver o relatório de pendências de integração' });
      }

      const integrationsId = await this.resolveIntegrationsId(req);
      const requested = req.query.section as IntegrationPendingSection;
      const section = INTEGRATION_PENDING_SECTIONS.includes(requested) ? requested : 'overrides';

      const result = await this.service.getIntegrationPendingReport(integrationsId, section);
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // POST /product/:productId/physical-owner — "Confirmar EAN físico": body supplier_product_code (EAN bipado) e
  // integrations_id opcional (desktop escolhe a integração; coletor usa a do usuário logado).
  assignPhysicalOwner = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { supplier_product_code, integrations_id } = req.body;
      const integrationsId = integrations_id || (await this.resolveIntegrationsId(req));

      const result = await this.service.assignPhysicalOwner({
        productId: req.params.productId as string,
        ean: supplier_product_code,
        integrationsId,
        userId: (req as any).user?.id ?? null,
      });

      return res.status(201).json(result);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const params = this.extractQueryParams(req);

      const result = await this.service.paginate(params, undefined, {
        integrations_id: integrationsId,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // GET /product/:productId — SupplierMappings paginados do produto, só da integração do usuário logado.
  findByProductId = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const params = this.extractQueryParams(req);

      const result = await this.service.findByProductId(
        params,
        req.params.productId as string,
        integrationsId,
      );

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // POST /product/:productId — cria SupplierMapping do produto na integração do usuário logado (erro com code pro front).
  createForProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const { supplier_product_code, supplier_cnpj } = req.body;

      const record = await this.service.createForProduct(
        req.params.productId as string,
        integrationsId,
        { supplier_product_code, supplier_cnpj },
        (req as any).user?.id ?? null,
      );

      return res.status(201).json(record);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  // PUT /product/:productId/:id — atualiza código/CNPJ e/ou desativa EAN físico confirmado (is_physical_override: false);
  // 404 se o mapping não for desse produto/integração.
  updateForProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const { supplier_product_code, supplier_cnpj, is_physical_override } = req.body;

      const record = await this.service.updateForProduct(
        req.params.id as string,
        req.params.productId as string,
        integrationsId,
        { supplier_product_code, supplier_cnpj, is_physical_override },
        await this.canManageOverride(req),
        (req as any).user?.id ?? null,
      );
      if (!record) return res.status(404).json({ error: 'Não encontrado' });

      return res.json(record);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  // DELETE /product/:productId/:id — 404 se o mapping não for desse produto/integração.
  deleteForProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const deleted = await this.service.deleteForProduct(
        req.params.id as string,
        req.params.productId as string,
        integrationsId,
        { userId: (req as any).user?.id ?? null, canManageOverride: await this.canManageOverride(req) },
      );
      if (!deleted) return res.status(404).json({ error: 'Não encontrado' });

      return res.status(204).send();
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const record = await this.service.findById(req.params.id as string);
      if (!record || record.integrations_id !== integrationsId) {
        return res.status(404).json({ error: 'Não encontrado' });
      }

      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      // is_physical_override só nasce pela rota physical-owner (permissão própria + limpeza + auditoria).
      const { is_physical_override, ...body } = req.body;
      // Código (com zero à esquerda) de outro produto ou EAN físico confirmado → erro com code.
      if (body.supplier_product_code && body.product_id) {
        await this.service.assertEanFreeForProduct(body.supplier_product_code, integrationsId, body.product_id);
      }
      const record = await this.service.create({
        ...body,
        integrations_id: integrationsId,
      });

      return res.status(201).json(record);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const existing = await this.service.findById(req.params.id as string);
      if (!existing || existing.integrations_id !== integrationsId) {
        return res.status(404).json({ error: 'Não encontrado' });
      }
      if (existing.is_physical_override) {
        this.service.assertCanManageOverride(await this.canManageOverride(req));
      }

      const { integrations_id, is_physical_override, ...data } = req.body;
      if (data.supplier_product_code) {
        await this.service.assertEanFreeForProduct(
          data.supplier_product_code,
          integrationsId,
          data.product_id ?? existing.product_id,
        );
      }

      const record = await this.service.update(req.params.id as string, data);
      return res.json(record);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  destroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const existing = await this.service.findById(req.params.id as string);
      if (!existing || existing.integrations_id !== integrationsId) {
        return res.status(404).json({ error: 'Não encontrado' });
      }

      // Mesmo caminho do DELETE por produto: guarda + auditoria quando é EAN físico confirmado.
      await this.service.deleteForProduct(existing.id, existing.product_id, integrationsId, {
        userId: (req as any).user?.id ?? null,
        canManageOverride: await this.canManageOverride(req),
      });
      return res.status(204).send();
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  bulkCreate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const items = req.body as Array<Record<string, unknown>>;

      // Mesmo pré-check do create pra cada item, em paralelo.
      await Promise.all(
        items
          .filter((item) => item.supplier_product_code && item.product_id)
          .map((item) =>
            this.service.assertEanFreeForProduct(
              item.supplier_product_code as string,
              integrationsId,
              item.product_id as string,
            ),
          ),
      );

      const records = await this.service.bulkCreate(
        // is_physical_override só nasce pela rota physical-owner.
        items.map(({ is_physical_override, ...item }) => ({
          ...item,
          integrations_id: integrationsId,
        })) as any,
      );

      return res.status(201).json(records);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  bulkUpdate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const { ids, integrations_id, is_physical_override, ...data } = req.body;

      // Troca de código em massa: mesmo pré-check pro produto de cada linha (uma query + checagens em paralelo).
      if (data.supplier_product_code) {
        const targets = await this.service.findAll({
          where: { id: ids, integrations_id: integrationsId },
          attributes: ['product_id'],
        });
        await Promise.all(
          targets.map((target) =>
            this.service.assertEanFreeForProduct(
              data.supplier_product_code,
              integrationsId,
              data.product_id ?? target.product_id,
            ),
          ),
        );
      }

      const conditions: WhereOptions[] = [{ id: ids }, { integrations_id: integrationsId }];
      // EAN físico confirmado fica fora da edição em massa pra quem não é admin/developer.
      if (!(await this.canManageOverride(req))) conditions.push({ is_physical_override: false });
      const records = await this.service.bulkUpdate(data, {
        where: { [Op.and]: conditions },
      });

      return res.status(201).json(records);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  // Vincula um unmapped a um produto já existente (ver SupplierMappingService.createFromUnmapped); 201 com o que foi
  // criado + mappings do produto na integração. Escopa pela integração do usuário (mesmo padrão de show/update/destroy).
  createFromUnmapped = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const { product_id, unmapped_invoice_product_id, supplier_cnpj } = req.body;

      const unmapped = await unmappedInvoiceProductService.findById(
        unmapped_invoice_product_id,
      );
      if (!unmapped || unmapped.integrations_id !== integrationsId) {
        return res.status(404).json({ error: 'Produto não mapeado não encontrado' });
      }

      const result = await this.service.createFromUnmapped({
        productId: product_id,
        unmappedInvoiceProductId: unmapped_invoice_product_id,
        supplierCnpj: supplier_cnpj,
        userId: (req as any).user?.id ?? null,
      });

      return res.status(201).json(result);
    } catch (error: any) {
      return this.errorResponse(req, res, error);
    }
  };

  bulkDestroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const { ids } = req.body as { ids: string[] };

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Informe um array de ids válido.' });
      }

      const where: WhereAttributeHash<SupplierMappingAttributes> = {
        id: { [Op.in]: ids },
        integrations_id: integrationsId,
      };
      // EAN físico confirmado fica fora da remoção em massa pra quem não é admin/developer.
      if (!(await this.canManageOverride(req))) where.is_physical_override = false;
      const deleted = await this.service.bulkDelete({ where });

      return res.json({ deleted });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new SupplierMappingController();
