// Prompt de fallback pro Passo B — só entra quando a regex local (texto
// nativo de PDF) não achou a chave, cobrindo DANFE fotografado/escaneado.
export const DANFE_ACCESS_KEY_EXTRACTION_PROMPT = `Este documento é um DANFE (Documento Auxiliar da Nota Fiscal Eletrônica) brasileiro.

Localize a "CHAVE DE ACESSO" da nota fiscal — um número de exatamente 44 dígitos, geralmente impresso no topo do documento, às vezes espaçado em grupos de 4 dígitos (ex.: "3525 0114 2000 1466 5500 1234 5678 9012 3456 7890 12").

Responda APENAS com os 44 dígitos, sem espaços, pontos ou qualquer outro caractere, sem texto antes ou depois. Se não conseguir localizar uma chave de 44 dígitos legível no documento, responda apenas com a palavra: null`;
