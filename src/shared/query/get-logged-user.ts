import { Request } from 'express';
import { User } from '../../modules/warehouse';

interface UserContext {
  userId: string;
  unitBusinessId: string;
}

export async function getUserContext(
  req: Request,
): Promise<UserContext> {
  const userId = (req as any).user?.id;

  if (!userId) {
    throw new Error('Usuário autenticado não encontrado.');
  }

  const user = await User.findByPk(userId, {
    attributes: ['unit_business_id'],
  });

  if (!user?.unit_business_id) {
    throw new Error(
      `unit_business_id não encontrado para o usuário ${userId}.`,
    );
  }

  return {
    userId,
    unitBusinessId: user.unit_business_id,
  };
}
// Id do usuário logado pra auditoria/escopo — null quando quem chama é uma application (req.user.id é o id dela,
// não de users, e quebraria a FK de audit_logs.user_id).
export function getRequestUserId(req: Request): string | null {
  if ((req as any).application) return null;
  return (req as any).user?.id ?? null;
}
