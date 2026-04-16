/**
 * seed-unit-businesses.script.ts
 *
 * Seed das lojas Pax no sistema, baseado nas lojas cadastradas na Bling.
 * Faz upsert pelo id_system — seguro rodar múltiplas vezes.
 *
 * Uso:
 *   npx ts-node seed-unit-businesses.script.ts
 */

import { setupAssociations } from '../config/sequelize-associations';
import sequelize from '../config/sequelize';
import { UnitBusiness } from '../modules/warehouse';

const INTEGRATIONS_ID = 'af41c051-ac74-4da0-ad08-c5fe5c7ff8a6';

const LOJAS: Array<{
  id_system: string;
  name: string;
  head_office: boolean;
  cnpj?: string;
  number?: string;
}> = [
  { id_system: '205950316', name: 'Loja 01 - Assis',                  head_office: true },
  { id_system: '205950317', name: 'Loja 02 - Assis',                  head_office: false },
  { id_system: '205950318', name: 'Loja 03 - Santa Cruz',             head_office: false },
  { id_system: '205950320', name: 'Loja 04 - Ourinhos',               head_office: false },
  { id_system: '205950321', name: 'Loja 05 - Botucatu',               head_office: false },
  { id_system: '205950322', name: 'Loja 06 - Bauru',                  head_office: false },
  { id_system: '205950323', name: 'Loja 07 - Marília',                head_office: false },
  { id_system: '205950324', name: 'Loja 08 - Marília',                head_office: false },
  { id_system: '205950326', name: 'Loja 09 - Lençóis Paulista',       head_office: false },
  { id_system: '205950327', name: 'Loja 10 - Lins',                   head_office: false },
  { id_system: '205950328', name: 'Loja 11 - Londrina',               head_office: false },
  { id_system: '205950330', name: 'Loja 13 - Cornélio Procópio',      head_office: false },
  { id_system: '205950331', name: 'Loja 14 - Avaré',                  head_office: false },
  { id_system: '205948370', name: 'Loja 15 - Itu',                    head_office: false },
  { id_system: '205950332', name: 'Loja 16 - Maringá',                head_office: false },
  { id_system: '205950333', name: 'Loja 19 - Indaiatuba',             head_office: false },
  { id_system: '205950335', name: 'Loja 20 - Ponta Grossa',           head_office: false },
  { id_system: '205950336', name: 'Loja 21 - CD MG',                  head_office: false },
  { id_system: '205950337', name: 'Loja 22 - Ourinhos',               head_office: false },
  { id_system: '205950339', name: 'Loja 23 - Indaiatuba',             head_office: false },
  { id_system: '205737004', name: 'Loja Pax Meli',                    head_office: false },
  { id_system: '205955595', name: 'Site Novo - www.paxpneus.com.br',  head_office: false },

];

async function main() {
  console.log('═'.repeat(55));
  console.log('  🏪 Seed — Unit Businesses (Lojas Pax)');
  console.log('═'.repeat(55));

  await sequelize.authenticate();
  setupAssociations();

  let created = 0;
  let updated = 0;

  for (const loja of LOJAS) {
    const payload: any = {
      name:            loja.name,
      head_office:     loja.head_office,
      integrations_id: INTEGRATIONS_ID,
      cnpj:            loja.cnpj   ?? null,
      number:          loja.number ?? null,
    };

    // Sede não tem id_system na Bling — upsert pelo cnpj
    if (!loja.id_system) {
      const [, wasCreated] = await UnitBusiness.upsert(
        { ...payload, id_system: '' },
        { conflictFields: ['cnpj'] as any },
      );
      wasCreated ? created++ : updated++;
      console.log(`  ${wasCreated ? '✅ criado' : '🔄 atualizado'}: ${loja.name}`);
      continue;
    }

    const [, wasCreated] = await UnitBusiness.upsert(
      { ...payload, id_system: loja.id_system },
      { conflictFields: ['id_system'] as any },
    );

    wasCreated ? created++ : updated++;
    console.log(`  ${wasCreated ? '✅ criado' : '🔄 atualizado'}: ${loja.name} (${loja.id_system})`);
  }

  console.log('═'.repeat(55));
  console.log(`  ✅ Concluído — ${created} criado(s), ${updated} atualizado(s)`);
  console.log('═'.repeat(55));

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erro no seed:', err.message);
  process.exit(1);
});