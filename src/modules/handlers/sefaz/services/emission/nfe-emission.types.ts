// src/modules/fiscal/nfe-emission/nfe-emission.types.ts

export interface NfeEmissionResult {
  cStat: string;
  xMotivo: string;
  chNFe?: string;
  nProt?: string;
  dhRecbto?: string;
  xml?: string;
}

export interface NfeStatusResult {
  cStat: string;
  xMotivo: string;
  tpAmb: string;
  verAplic: string;
  dhRecbto?: string;
}