import { AxiosInstance } from "axios";
import customersService from "../../../../sales/customers/customers.service";
import { customerCreationAttributes } from "../../../../sales/customers/customers.types";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";
import Order from "../../../../sales/orders/order/orders.model";

export class BlingCustomerService {
  public blingApi: AxiosInstance;

  constructor(blingApi: AxiosInstance) {
    this.blingApi = blingApi;
  }

  async updateCustomer(contato: any) {
    // Busca dados completos do contato na Bling

    const customer = await customersService.findOne({
      where: {
        document: cleanDocument(contato.numeroDocumento),
      },
    });

    if (!customer) {
      console.log(
        `[BlingCustomerService] Cliente ${contato.nome} não encontrado para atualizar, criando...`,
      );
      return await this.getOrCreateCustomer(contato);
    }

    await customersService.update(customer.id, {
      name: contato.nome,
      type: contato.tipoPessoa,
      document: contato.numeroDocumento,
    });

    console.log(
      `[BlingCustomerService] Cliente ${contato.nome} atualizado com sucesso`,
    );
    return customer;
  }

  // Método para gerenciar a existência do cliente

  async getOrCreateCustomer(contato: any) {
    // Tenta encontrar o cliente existente
    const document = cleanDocument(contato.numeroDocumento);

    let customer = await customersService.findOne({
      where: {
        document,
      },
    });

    // Se não existir, cria um novo
    if (!customer) {
      const customerPayload: customerCreationAttributes = {
        name: contato.nome,
        type: contato.tipoPessoa,
        document: cleanDocument(contato.numeroDocumento),
      };

      try {
        customer = await customersService.create(customerPayload);
      } catch (err: any) {
        if (err?.name === "SequelizeUniqueConstraintError") {
          customer = await customersService.findOne({ where: { document } });
          if (customer) return customer;
        }
        throw err;
      }
    }

    return customer;
  }
}

export default BlingCustomerService;
