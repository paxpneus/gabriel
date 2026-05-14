import { FindOptions, Transaction } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Transporter from "../transporter.model";
import CarrierLabelRange from "./carrier-label-ranges.model";
import carrierLabelRangeRepository, {
  CarrierLabelRangeRepository,
} from "./carrier-label-ranges.repository";
import sequelize from "../../../../config/sequelize";
import carrierImportLayoutsService from "../carrier-import-layouts/carrier-import-layouts.service";
import * as XLSX from "xlsx";
import { CarrierLabelRangeCreationAttributes } from "./carrier-label-ranges.types";
export class CarrierLabelRangeService extends BaseService<
  CarrierLabelRange,
  CarrierLabelRangeRepository
> {
  constructor() {
    super(carrierLabelRangeRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: [
        "cep_start",
        "cep_end",
        "route_acronym",
        "service_name",
        "route_code",
        "transporter_code",
      ],
      filterableFields: ["transporter_id", "active"],
      sortableFields: [
        "cep_start",
        "cep_end",
        "route_acronym",
        "service_name",
        "route_code",
        "transporter_code",
        "transporter_id",
        "active",
        "createdAt",
        "updatedAt",
      ],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<CarrierLabelRange>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: Transporter,
          as: "transporter",
        },
      ],
    });
  }


async importLabelsFromExcel(
  transporter_id: string,
  file: { buffer: Buffer; filename: string; mimeType: string },
  transaction?: Transaction
) {
  
  const importLayout = await carrierImportLayoutsService.findOne({
    where: { transporter_id },
    transaction: transaction
  });

  if (!importLayout) {
    throw new Error("O transportador deve ter um layout de importação!");
  }

  // 1. Lê o workbook do buffer
  const workbook = XLSX.read(file.buffer, { type: "buffer" });

  // 2. Seleciona a aba correta
  const sheetName = importLayout.sheet_name ?? workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error(`Aba "${sheetName}" não encontrada no arquivo.`);
  }

  // 3. Converte para array de arrays
  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: false,
  });

  // 4. Resolve índice de coluna
  const resolveColIndex = (label: string | null | undefined): number | null => {
    if (!label) return null;

    if (importLayout.mapping_mode === "HEADER") {
      const headerRow = rows[importLayout.data_start_row - 2] ?? [];
      const idx = headerRow.findIndex(
        (h: any) => String(h ?? "").trim() === label.trim()
      );
      return idx >= 0 ? idx : null;
    }

    const num = parseInt(label, 10);
    if (!isNaN(num)) return num - 1;

    return label
      .toUpperCase()
      .split("")
      .reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1;
  };

  const cols = {
    cep_start:     resolveColIndex(importLayout.zip_from_label),
    cep_end:       resolveColIndex(importLayout.zip_to_label),
    route_acronym: resolveColIndex(importLayout.destination_label),
    route_code:    resolveColIndex(importLayout.route_code_label),
    observation:   resolveColIndex(importLayout.observation_label),
  };

  if (cols.cep_start === null || cols.cep_end === null) {
    throw new Error(
      "Colunas obrigatórias (CEP início/fim) não encontradas no layout."
    );
  }

  // 5. Monta os records ANTES de qualquer operação no banco
  const records: CarrierLabelRangeCreationAttributes[] = [];
  const dataRows = rows.slice(importLayout.data_start_row - 1);

  for (const row of dataRows) {
    const get = (idx: number | null): string | null =>
      idx !== null && row[idx] != null ? String(row[idx]).trim() : null;

    const cep_start = get(cols.cep_start);
    const cep_end   = get(cols.cep_end);

    if (!cep_start && !cep_end) continue;

    records.push({
      transporter_id,
      cep_start:        cep_start ?? "",
      cep_end:          cep_end ?? "",
      route_acronym:    get(cols.route_acronym) ?? "",
      route_code:       get(cols.route_code),
      metadata:         cols.observation ? { observation: get(cols.observation) } : null,
      transporter_code: transporter_id,
      active:           true,
    });
  }

  if (records.length === 0) {
    throw new Error("Nenhum dado encontrado no arquivo para importar.");
  }

  // 6. Delete rápido FORA de transaction longa — sem lock prolongado
  console.log('Header row:', rows[importLayout.data_start_row - 2])
console.log('Cols resolved:', cols)
console.log('Total rows:', rows.length)
console.log('Data rows:', dataRows.length)
console.log('First data row:', dataRows[0])
console.log('Records built:', records.length)
  await this.bulkDelete({ where: { transporter_id }, transaction });

  // 7. Insert em chunks dentro de transactions curtas e independentes
 const CHUNK_SIZE = 500;
let totalInserted = 0;
let totalErrors = 0;

for (let i = 0; i < records.length; i += CHUNK_SIZE) {
  const chunk = records.slice(i, i + CHUNK_SIZE);
  const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;

  try {
    
      await this.repository.bulkCreate(chunk, {
        transaction,
        ignoreDuplicates: true,
      });
    

    totalInserted += chunk.length;
    console.log(`Chunk ${chunkNum} OK — ${totalInserted}/${records.length}`)
  } catch (err: any) {
    totalErrors += chunk.length;
    console.error(`Chunk ${chunkNum} ERRO:`, err.message)
    throw err
  }
}
console.log(`Importação finalizada: ${totalInserted} inseridos, ${totalErrors} erros`)

}
}

export default new CarrierLabelRangeService();
