// IDs de grupo (EPGRU_ID) usados no filtro `grupo` do GET /produtos da Tecinco,
// para restringir a busca apenas aos grupos de pneus.
export const tecincoTireGrupoIds: string[] = ["10", "1", "12", "18"];

// Nomes de grupo (grupo_descricao) permitidos para criação/atualização de
// produtos vindos da Tecinco. Produtos de qualquer outro grupo são ignorados.
export const tecincoAllowedGroupNames: string[] = [
  "PNEUS",
  "PNEUS CARGA",
  "PNEUS IMPORTADOS",
  "PNEUS BRIDGESTONE/ FIRESTONE",
];
