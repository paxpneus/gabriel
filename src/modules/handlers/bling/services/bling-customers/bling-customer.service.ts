import { AxiosInstance } from "axios";
import customersService from "../../../../sales/customers/customers.service";
import { customerCreationAttributes } from "../../../../sales/customers/customers.types";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";

export class BlingCustomerService {
  public blingApi: AxiosInstance;

  constructor(blingApi: AxiosInstance) {
    this.blingApi = blingApi;
  }


  
   // Método para gerenciar a existência do cliente
   
  async getOrCreateCustomer(contato: any) {
    // Tenta encontrar o cliente existente
    let customer = await customersService.findOne({
      where: {
        name: contato.nome,
        document: cleanDocument(contato.numeroDocumento),
      },
    });

    // Se não existir, cria um novo
    if (!customer) {
      const customerPayload: customerCreationAttributes = {
        name: contato.nome,
        type: contato.tipoPessoa,
        document: contato.numeroDocumento,
      };

      customer = await customersService.create(customerPayload);
    }

    return customer;
  }
}

export default BlingCustomerService