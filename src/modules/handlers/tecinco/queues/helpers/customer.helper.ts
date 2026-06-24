 
 import Customer from "../../../../sales/customers/customers.model";
import TCarClienteService from "../../service/clientes/clientes.service";

 export async function upsertCustomerFromTCar(
    branchId: number,
    clnCodigo: number | string,
    logPrefix: string,
  ): Promise<void> {
    const clienteService = new TCarClienteService();

    let raw: any;
    try {
      raw = await clienteService.obterCliente(branchId, clnCodigo);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.warn(
          `${logPrefix} — cliente cln_codigo=${clnCodigo} não encontrado na TeCinco (404)`,
        );
        return;
      }
      console.error(
        `${logPrefix} — erro ao buscar cliente cln_codigo=${clnCodigo}: ${err?.message ?? err}`,
      );
      return; // não interrompe o fluxo da invoice
    }

    // A resposta do GET /clientes/:id não é paginada — é o objeto direto
    const c = raw?.data ?? raw;

    const document =
      (c?.CLN_CPFCNPJ ?? c?.cln_cpfcnpj)?.replace(/\D/g, "") || null;

    if (!document) {
      console.warn(
        `${logPrefix} — cliente cln_codigo=${clnCodigo} sem CPF/CNPJ — ignorado`,
      );
      return;
    }

    const name: string = (c?.CLN_NOME ?? c?.cln_nome ?? c?.nome ?? "").trim();
    const type: "F" | "J" =
      (c?.CLN_FISJUR ?? c?.cln_fisjur ?? c?.tipo_pessoa) === "J" ? "J" : "F";

    const existing = await Customer.findOne({ where: { document } });

    if (existing) {
      await existing.update({ name, type });
    } else {
      await Customer.create({ name, type, document });
    }

    console.log(`${logPrefix} — customer upsertado: document=${document}`);
  }