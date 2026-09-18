import { datafreteApi } from '../../../api/data-frete_api.service';
import {
  DatafreteImportCteXmlResponse,
  DatafreteImportCteJsonRequest,
  DatafreteListCteFilters,
  DatafreteListCteResponse,
} from './cte.types';

// ─── POST /conhecimento-transporte/xml ───────────────────────────────────────

const buildCteXmlPayload = (cteXmlBase64: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>\n<ct>\n    <xml>\n      ${cteXmlBase64}\n    </xml>\n</ct>`;

export const importCteXml = async (
  cteXmlBase64: string,
): Promise<DatafreteImportCteXmlResponse> => {
  const { data } = await datafreteApi.post<DatafreteImportCteXmlResponse>(
    '/conhecimento-transporte/xml',
    buildCteXmlPayload(cteXmlBase64),
    { headers: { 'Content-Type': 'application/xml' } },
  );
  return data;
};

// ─── POST /conhecimento-transporte (JSON) ────────────────────────────────────

export const importCteJson = async (
  cteXmlBase64: string,
): Promise<DatafreteImportCteXmlResponse> => {
  const payload: DatafreteImportCteJsonRequest = { xml: cteXmlBase64 };

  const { data } = await datafreteApi.post<DatafreteImportCteXmlResponse>(
    '/conhecimento-transporte',
    payload,
  );
  return data;
};

// ─── GET /conhecimento-transporte (Listar CT-e) ──────────────────────────────

export const listCte = async (
  filters: DatafreteListCteFilters,
): Promise<DatafreteListCteResponse> => {
  const { data } = await datafreteApi.get<DatafreteListCteResponse>(
    '/conhecimento-transporte',
    { params: filters },
  );
  return data;
};

export const isCteImported = async (chaveCt: string): Promise<boolean> => {
  const response = await listCte({ chave_ct: chaveCt });
  return response.evento.qtd_registro > 0;
};

// ─── GET /conhecimento-transporte/xml (Buscar XML do CT-e) ──────────────────

export const fetchCteXml = async (chaveCt: string): Promise<string> => {
  const { data } = await datafreteApi.get<string>(
    '/conhecimento-transporte/xml',
    { params: { chave_ct: chaveCt }, responseType: 'text' },
  );
  return data;
};
