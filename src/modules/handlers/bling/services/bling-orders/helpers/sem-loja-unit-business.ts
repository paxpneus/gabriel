import { UnitBusiness } from "../../../../../warehouse";

// id_system reservado pro UnitBusiness placeholder usado quando o loja.id
// da Bling não bate com nenhuma loja cadastrada — única fonte pra não
// divergir entre a criação do fallback e a checagem de re-resolução no
// update (bling-order.service.ts).
export const SEM_LOJA_ID_SYSTEM = "SEM_LOJA";

export async function findOrCreateSemLojaUnitBusiness(): Promise<UnitBusiness> {
  const existing = await UnitBusiness.findOne({
    where: { id_system: SEM_LOJA_ID_SYSTEM },
  });
  if (existing) return existing;

  return UnitBusiness.create({
    id_system: SEM_LOJA_ID_SYSTEM,
    name: "Sem Loja",
    cnpj: "00000000000000",
    head_office: false,
    number: "0",
  });
}
