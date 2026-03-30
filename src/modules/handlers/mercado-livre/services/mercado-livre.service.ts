import { MLOrderData } from './mercado-livre.types';

export class MLOrderService {

  // TODO: receber instância da API do ML quando estiver disponível
  constructor() {}

  async getOrderData(order: any): Promise<MLOrderData> {
    // TODO: substituir pela busca real no ML
    // A busca será por cliente + data + outro campo (a definir)
    // const result = await mlApi.get(...)

    // Simulação — retorna amanhã como data de coleta
    const collectionDate = new Date();
    collectionDate.setDate(collectionDate.getDate() + 1);

    return {
      ml_order_id: "ML-SIMULADO-123",
      collection_date: collectionDate,
    };
  }
}