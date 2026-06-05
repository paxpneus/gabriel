import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController from "../../../shared/utils/base-models/base-controller";
import UnmappedInvoiceProduct from "./unmapped-invoice-product.model";
import UnmappedInvoiceProductService from "./unmapped-invoice-product.service";
import { Request, Response } from "express";
import { UnmappedInvoiceProductCreationAttributes } from "./unmapped-invoice-product.types";

import multer from "multer";
import uploaderService from "../../handlers/uploader/services/uploader.service";
import { UnitBusiness, User } from "../../warehouse";

const upload = multer({ storage: multer.memoryStorage() });
export class UnmappedInvoiceProductController extends BaseController<
  UnmappedInvoiceProduct,
  typeof UnmappedInvoiceProductService
> {
  constructor() {
    super(UnmappedInvoiceProductService);

    this.router.post(
      "/mark-updated/update",
      ...this.mw("markMapped"),
      this.markMapped,
    );
    this.router.post(
      "/from-ean/create",
      ...this.mw("createUnmappedFromReadingEan"),
      this.createUnmappedFromReadingEan,
    );
    this.router.get("/full/:id", ...this.mw("getFullById"), this.getFullById)
    this.router.get("/:id/image", ...this.mw("getImage"), this.getImage);

  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      login: [authenticate, userPermissions],
      getFullById: [authenticate, userPermissions],
      markMapped: [authenticate, userPermissions],
      getImage: [authenticate, userPermissions],
      createUnmappedFromReadingEan: [
        authenticate,
        userPermissions,
        upload.single("image"),
      ],
    };
  }

  markMapped = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { ids } = req.body;

      await this.service.markMapped(ids as string[]);

      return res
        .status(201)
        .json({ message: "Produtos marcados como mapeados com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

    getFullById = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;

      const data = await this.service.getFullById(id as string);

      return res
        .status(201)
        .json(data);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const unmapped = await this.service.findById(req.params.id as string);
    if (!unmapped?.image_path) {
      res.status(404).end();
      return;
    }

    const buffer = await uploaderService.getFile(unmapped.image_path);
    const ext = unmapped.image_path.split('.').pop() || 'jpeg';

    res.set('Content-Type', `image/${ext}`);
    res.set('Cache-Control', 'public, max-age=86400'); 
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

  createUnmappedFromReadingEan = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Imagem obrigatória" });
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const user = await User.findByPk(userId, {
      include: [{ model: UnitBusiness, as: 'unitBusiness' }],
    });

    if (!user?.unitBusiness?.integrations_id) {
      return res.status(400).json({ error: "Unidade de negócio ou integração não encontrada para o usuário" });
    }

    const integrationsId = user.unitBusiness.integrations_id;

    const { ean } = req.body;
    const { buffer, originalname, mimetype } = req.file;

    const image = {
      buffer,
      filename: originalname,
      mimeType: mimetype,
    };

    await this.service.createUnmappedFromReadingEan(ean as string, image, integrationsId);

    return res.status(201).json({ message: "Produto não mapeado registrado com sucesso!" });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
}

export default new UnmappedInvoiceProductController();
