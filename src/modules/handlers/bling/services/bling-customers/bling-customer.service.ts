import { AxiosInstance } from "axios";
import customersService from "../../../../sales/customers/customers.service";
import {
  customerCreationAttributes,
  userType,
} from "../../../../sales/customers/customers.types";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";

export class BlingCustomerService {
  public blingApi: AxiosInstance;

  constructor(blingApi: AxiosInstance) {
    this.blingApi = blingApi;
  }

  // Bling sends tipoPessoa/numeroDocumento as "" (e.g. ML orders cancelled for missing document).
  private resolveType(tipoPessoa: string, document: string | null): userType {
    if (tipoPessoa === "F" || tipoPessoa === "J") return tipoPessoa;
    return document?.length === 14 ? "J" : "F";
  }

  // Without a document, fall back to the Bling name (ML nickname) so all undocumented contacts don't collapse into one row.
  private findByContact(document: string | null, name: string) {
    return customersService.findOne({
      where: document ? { document } : { document: null, name },
    });
  }

  async updateCustomer(contato: any) {
    const document = cleanDocument(contato.numeroDocumento) || null;
    const customer = await this.findByContact(document, contato.nome);

    if (!customer) {
      console.log(
        `[BlingCustomerService] Cliente ${contato.nome} não encontrado para atualizar, criando...`,
      );
      return await this.getOrCreateCustomer(contato);
    }

    await customersService.update(customer.id, {
      name: contato.nome,
      type: this.resolveType(contato.tipoPessoa, document),
      document,
    });

    console.log(
      `[BlingCustomerService] Cliente ${contato.nome} atualizado com sucesso`,
    );
    return customer;
  }

  async getOrCreateCustomer(contato: any) {
    const document = cleanDocument(contato.numeroDocumento) || null;

    let customer = await this.findByContact(document, contato.nome);

    if (!customer) {
      const customerPayload: customerCreationAttributes = {
        name: contato.nome,
        type: this.resolveType(contato.tipoPessoa, document),
        document,
      };

      try {
        customer = await customersService.create(customerPayload);
      } catch (err: any) {
        if (err?.name === "SequelizeUniqueConstraintError") {
          customer = await this.findByContact(document, contato.nome);
          if (customer) return customer;
        }
        throw err;
      }
    }

    return customer;
  }
}

export default BlingCustomerService;
