import { Request, Response } from 'express';
import { authenticate } from '../../../middlewares/auth-token';
import { QueryParams } from '../../../shared/query/query.types';
import BaseController from '../../../shared/utils/base-models/base-controller';
import User from '../../company/users/users/user.model';
import Product from './product.model';
import ProductService from './product.service';
import { userPermissions } from '../../../middlewares/user-permissions';

type StockUnitFilter = {
  unitBusinessId?: string;
  stockUnit?: 'positive' | 'zero';
};

type ProductQueryParams = Omit<QueryParams, 'filters'> & {
  filters?: Record<string, string | string[] | StockUnitFilter | undefined>;
};

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    role: string;
  };
};

export class ProductController extends BaseController<Product, typeof ProductService> {
  constructor() {
    super(ProductService);    

    this.router.get("/report/get", ...this.mw("productReport"), this.productReport)
    

    this.router.get("/:id/full", ...this.mw("findByIdFull"), this.findByIdFull)

  }

  protected middlewaresFor() {
    return {
      index: [authenticate],
      findByIdFull: [authenticate],
      productReport: [authenticate, userPermissions]
    };
  }

  findByIdFull = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;
    const userId = (req as AuthenticatedRequest).user?.id;
    const user = userId
      ? await User.findByPk(userId, { attributes: ['unit_business_id'] })
      : null;

    const product = await this.service.findByIdFull(id as string, user?.unit_business_id);

    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    return res.json(product);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req) as ProductQueryParams;
      const userId = (req as AuthenticatedRequest).user?.id;
      const user = userId
        ? await User.findByPk(userId, { attributes: ['unit_business_id'] })
        : null;
      const unitBusinessId = user?.unit_business_id;

      if (unitBusinessId) {
        params.filters = params.filters ?? {};
        const stockUnit = Array.isArray(params.filters.stockUnit)
          ? params.filters.stockUnit[0]
          : params.filters.stockUnit;

        params.filters.stockUnit = {
          unitBusinessId,
          stockUnit: stockUnit === 'positive' || stockUnit === 'zero' ? stockUnit : undefined,
        };
      }

      const result = await this.service.paginate(params as unknown as QueryParams);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

    productByUnit = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req) as ProductQueryParams;
      const unitBusinessId = req.query.unitBusinessId as string | undefined;

      if (!unitBusinessId) {
        throw new Error("Erro: Loja (parâmetro unitBusinessId) não informada")
      }

      if (unitBusinessId) {
        params.filters = params.filters ?? {};
        const stockUnit = Array.isArray(params.filters.stockUnit)
          ? params.filters.stockUnit[0]
          : params.filters.stockUnit;

        params.filters.stockUnit = {
          unitBusinessId,
          stockUnit: stockUnit === 'positive' || stockUnit === 'zero' ? stockUnit : undefined,
        };
      }

      const result = await this.service.paginate(params as unknown as QueryParams);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  productReport = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req) as ProductQueryParams;
      const userId = (req as AuthenticatedRequest).user?.id;
      const user = userId
        ? await User.findByPk(userId, { attributes: ['unit_business_id'] })
        : null;
      const unitBusinessId = user?.unit_business_id;

      if (unitBusinessId) {
        params.filters = params.filters ?? {};
        const stockUnit = Array.isArray(params.filters.stockUnit)
          ? params.filters.stockUnit[0]
          : params.filters.stockUnit;

        params.filters.stockUnit = {
          unitBusinessId,
          stockUnit: stockUnit === 'positive' || stockUnit === 'zero' ? stockUnit : undefined,
        };
      }

      const result = await this.service.productReport(params as unknown as QueryParams);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new ProductController();
