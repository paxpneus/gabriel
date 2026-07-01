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