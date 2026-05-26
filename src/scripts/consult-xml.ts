// sefaz-consultar-chave.script.ts
//
// Uso:
//   npx ts-node sefaz-consultar-chave.script.ts
//   CHAVE=35260508029776000146550010001973241311973247 CNPJ=02316749001573 npx ts-node sefaz-consultar-chave.script.ts

import { setupAssociations } from '../config/sequelize-associations';
import sequelize from '../config/sequelize';
import { sefazApiService } from '../modules/handlers/sefaz/api/sefaz_api.service';
import { BlingApiFetchQueue } from '../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue';

const apiFetchQueue = new BlingApiFetchQueue({ workless: true });

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

async function main() {
  const chave = process.env.CHAVE?.trim();
  const cnpj  = process.env.CNPJ?.trim();

  if (!chave || chave.length !== 44) {
    console.error('❌ Informe a chave de acesso com 44 dígitos: CHAVE=... npx ts-node ...');
    process.exit(1);
  }

  if (!cnpj || cnpj.length !== 14) {
    console.error('❌ Informe o CNPJ da filial destinatária (14 dígitos): CNPJ=... npx ts-node ...');
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(55));
  console.log('  🔍 SEFAZ — Consulta por Chave de Acesso');
  console.log('═'.repeat(55));
  console.log(`  Chave : ${chave}`);
  console.log(`  CNPJ  : ${cnpj}`);
  console.log('═'.repeat(55) + '\n');

  await bootstrap();

  console.log('  → Consultando SEFAZ via consChNFe...');
  const xml = await sefazApiService.consultarPorChave(chave, cnpj);

  if (!xml) {
    console.warn('  ⚠️  procNFe não disponível — nota ainda não liberada pela SEFAZ.');
    console.warn('     Possíveis causas: manifestação pendente ou nota muito recente.');
    process.exit(0);
  }

  console.log('  ✅ procNFe recebido — processando invoice...\n');
  await apiFetchQueue.upsertInvoiceFromXml(xml);
  console.log('\n  ✅ Invoice processada com sucesso.\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});