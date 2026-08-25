import { Request, Response } from "express";
import { authenticate } from "../../../middlewares/auth-token";
import { QueryParams } from "../../../shared/query/query.types";
import BaseController from "../../../shared/utils/base-models/base-controller";
import User from "../../company/users/users/user.model";
import Product from "./product.model";
import ProductService from "./services/product.service";
import { userPermissions } from "../../../middlewares/user-permissions";
import unitBusinessService from "../../company/unit-business/unit-business.service";
import productWithMovementService from './services/product-with-movements'
import { StockUnitFilter } from "./product.types";

type ProductQueryParams = Omit<QueryParams, "filters"> & {
  filters?: Record<string, string | string[] | StockUnitFilter | undefined>;
};

const parseArrayQueryParam = (value: unknown): string[] | undefined => {
  if (value == null) return undefined;

  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }

  const raw = String(value).trim();
  if (!raw) return undefined;

  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
};

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    role: string;
  };
};

export class ProductController extends BaseController<
  Product,
  typeof ProductService
> {
  constructor() {
    super(ProductService);

    this.router.get("/detailed/get", ...this.mw("indexDetailed"), (req, res) =>
      this.indexDetailed(req, res),
    );

    this.router.get(
      "/report/get",
      ...this.mw("productReport"),
      this.productReport,
    );
    this.router.get(
      "/by-unit-business/get",
      ...this.mw("productByUnit"),
      this.productByUnit,
    );
    this.router.get(
      "/sales-report/get",
      ...this.mw("productSalesReport"),
      this.productSalesReport,
    );

    this.router.get("/:id/full", ...this.mw("findByIdFull"), this.findByIdFull);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate],
      indexDetailed: [authenticate],
      findByIdFull: [authenticate],
      productReport: [authenticate, userPermissions],
      productByUnit: [authenticate, userPermissions],
      productSalesReport: [authenticate, userPermissions],
    };
  }

  findByIdFull = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;
      const userId = (req as AuthenticatedRequest).user?.id;
      const user = userId
        ? await User.findByPk(userId, { attributes: ["unit_business_id"] })
        : null;

      const product = await this.service.findByIdFull(
        id as string,
        user?.unit_business_id,
      );

      if (!product) {
        return res.status(404).json({ error: "Produto não encontrado" });
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
        ? await User.findByPk(userId, { attributes: ["unit_business_id"] })
        : null;
      const unitBusinessId = user?.unit_business_id;

      if (unitBusinessId) {
        params.filters = params.filters ?? {};
        const stockUnit = Array.isArray(params.filters.stockUnit)
          ? params.filters.stockUnit[0]
          : params.filters.stockUnit;

        params.filters.stockUnit = {
          unitBusinessId,
          stockUnit:
            stockUnit === "positive" || stockUnit === "zero"
              ? stockUnit
              : undefined,
        };
      }

      const result = await this.service.paginate(
        params as unknown as QueryParams,
      );
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
  indexDetailed = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req) as ProductQueryParams;
      const userId = (req as AuthenticatedRequest).user?.id;
      const user = userId
        ? await User.findByPk(userId, { attributes: ["unit_business_id"] })
        : null;
      const unitBusinessId = user?.unit_business_id;

      if (unitBusinessId) {
        params.filters = params.filters ?? {};
        const stockUnit = Array.isArray(params.filters.stockUnit)
          ? params.filters.stockUnit[0]
          : params.filters.stockUnit;

        params.filters.stockUnit = {
          unitBusinessId,
          stockUnit:
            stockUnit === "positive" || stockUnit === "zero"
              ? stockUnit
              : undefined,
        };
      }

      const result = await productWithMovementService.productDetailedWithMovementsSummary(
        params as unknown as QueryParams,
      );
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  productByUnit = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req) as ProductQueryParams;
      const unitBusiness = req.query.unitBusiness as string | undefined;

      if (!unitBusiness) {
        throw new Error(
          "Erro: Numero da Loja (parâmetro unitBusiness) não informado",
        );
      }

      const foundUnit = await unitBusinessService.findOne({
        where: {
          number: unitBusiness,
        },
      });

      if (!foundUnit) {
        throw new Error("Erro: Loja não encontrada para o número informado");
      }

      const unitBusinessId = foundUnit.id;

      if (unitBusinessId) {
        params.filters = params.filters ?? {};
        const stockUnit = Array.isArray(params.filters.stockUnit)
          ? params.filters.stockUnit[0]
          : params.filters.stockUnit;

        params.filters.stockUnit = {
          unitBusinessId,
          stockUnit:
            stockUnit === "positive" || stockUnit === "zero"
              ? stockUnit
              : undefined,
        };
      }

      const result = await this.service.paginate(
        params as unknown as QueryParams,
      );
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
        ? await User.findByPk(userId, { attributes: ["unit_business_id"] })
        : null;
      const unitBusinessId = user?.unit_business_id;

      if (unitBusinessId) {
        params.filters = params.filters ?? {};
        const stockUnit = Array.isArray(params.filters.stockUnit)
          ? params.filters.stockUnit[0]
          : params.filters.stockUnit;

        params.filters.stockUnit = {
          unitBusinessId,
          stockUnit:
            stockUnit === "positive" || stockUnit === "zero"
              ? stockUnit
              : undefined,
        };
      }

      const result = await this.service.productReport(
        params as unknown as QueryParams,
      );
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  productSalesReport = async (req: Request, res: Response): Promise<Response> => {
    try {
      const dateFrom = req.query.dateFrom ?? req.query.date_from;
      const dateTo = req.query.dateTo ?? req.query.date_to;

      if (!dateFrom || !dateTo) {
        return res.status(400).json({
          error: "Parâmetros dateFrom e dateTo são obrigatórios",
        });
      }

      const result = await this.service.getSalesReport({
        dateFrom: String(dateFrom),
        dateTo: String(dateTo),
        unitBusinessIds: parseArrayQueryParam(
          req.query.unitBusinessIds ?? req.query.unit_business_ids,
        ),
        productIds: parseArrayQueryParam(
          req.query.productIds ?? req.query.product_ids,
        ),
        rim: (req.query.rim as string | undefined) || undefined,
        measure:
          ((req.query.measure ?? req.query.tireMeasure) as
            | string
            | undefined) || undefined,
        productType:
          ((req.query.productType ?? req.query.product_type ?? req.query.type) as
            | string
            | undefined) || undefined,
        minQuantitySold:
          req.query.minQuantitySold != null
            ? Number(req.query.minQuantitySold)
            : undefined,
        maxQuantitySold:
          req.query.maxQuantitySold != null
            ? Number(req.query.maxQuantitySold)
            : undefined,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new ProductController();
