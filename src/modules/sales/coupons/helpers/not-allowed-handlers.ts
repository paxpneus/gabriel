import { Request, Response } from "express";

const notAllowed =
  (message: string) =>
  async (_req: Request, res: Response): Promise<Response> =>
    res.status(405).json({ error: message });

// Cupom/vínculo nunca é apagado (histórico de pedidos/comissões aponta pra ele); só inativado.
export const deletionNotAllowed = notAllowed("Exclusão não permitida. Inative o registro.");
// Bulk pularia a normalização/validação do service.
export const bulkNotAllowed = notAllowed("Operação em lote não suportada.");
