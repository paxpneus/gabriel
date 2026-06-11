import "dotenv/config";
import { UnitBusiness } from "../modules/warehouse";
import { sefazApiService } from "../modules/handlers/sefaz/api/sefaz_api.service";

const FILIAIS = [
  '02316749002111',
];

async function main() {
  const cUF = process.env.SEFAZ_CUF ?? "42";

  const filiais = await UnitBusiness.findAll({
    where: { cnpj: FILIAIS },
  });

  for (const filial of filiais) {
    const cnpj = filial.cnpj.replace(/\D/g, "");
    try {
      const maxNSU = await sefazApiService.descobrirMaxNSU(cnpj, cUF);
      await filial.update({ ult_nsu: maxNSU });
      console.log(`✅ ${filial.name} | novo ult_nsu = ${maxNSU}`);
    } catch (err) {
      console.error(`❌ ${filial.name}:`, err);
    }

    // Respeita o rate limit entre CNPJs
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main().catch(console.error);