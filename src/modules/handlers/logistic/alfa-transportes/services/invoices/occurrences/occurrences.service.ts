import { alfaTransportesApi } from "../../../api/alfa_api.service";
import { AlfaRastreamentoRequest, AlfaRastreamentoResponse } from "./occurrences.types";

export class AlfaTransportesInvoiceOcurrency {

  async buscarOcorrenciasDeNota(payload: AlfaRastreamentoRequest): Promise<AlfaRastreamentoResponse> {
    const {data} = await alfaTransportesApi.post<AlfaRastreamentoResponse>('/rastreamento/v1.3/', payload)
    return data
  }
}