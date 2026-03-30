import { AxiosInstance } from "axios";
import customersService from "../../../../sales/customers/customers.service";
import { customerCreationAttributes } from "../../../../sales/customers/customers.types";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";
import Order from "../../../../sales/orders/orders.model";

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
      name: contato.nome
    }
  })

  if (!customer) {
    console.log(`[BlingCustomerService] Cliente ${contato.nome} não encontrado para atualizar, criando...`)
    return await this.getOrCreateCustomer(contato)
  }

  await customersService.update(
    customer.id,
    {
      name: contato.nome,
      type: contato.tipoPessoa,
      document: contato.numeroDocumento,
    },
  )

  console.log(`[BlingCustomerService] Cliente ${contato.nome} atualizado com sucesso`)
  return customer
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