import { spawn } from "node:child_process";

export type DatabaseDumpConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

export type DatabaseDumpFile = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  database: string;
  size: number;
};

export type DownloadDatabaseDumpOptions = {
  config?: Partial<DatabaseDumpConfig>;
  filename?: string;
};

const DEFAULT_DATABASE_NAME = "autointegration_node";
const SQL_MIME_TYPE = "application/sql";

function getRequiredDatabaseConfig(config?: Partial<DatabaseDumpConfig>): DatabaseDumpConfig {
  const databaseConfig = {
    host: config?.host ?? process.env.DB_HOST,
    port: config?.port ?? Number(process.env.DB_PORT),
    database: config?.database ?? process.env.DB_NAME ?? DEFAULT_DATABASE_NAME,
    username: config?.username ?? process.env.DB_USER,
    password: config?.password ?? process.env.DB_PASS,
  };

  const missingFields = Object
    .entries(databaseConfig)
    .filter(([, value]) => value === undefined || value === null || value === "" || Number.isNaN(value))
    .map(([key]) => key);

  if (missingFields.length > 0) {
    throw new Error(`Configuração do banco incompleta para gerar dump: ${missingFields.join(", ")}`);
  }

  return databaseConfig as DatabaseDumpConfig;
}

function buildDumpFilename(database: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${database}-${timestamp}.sql`;
}

export async function downloadDatabaseDump(
  options: DownloadDatabaseDumpOptions = {},
): Promise<DatabaseDumpFile> {
  const config = getRequiredDatabaseConfig(options.config);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    const dumpProcess = spawn("pg_dump", [
      "--format=plain",
      "--no-owner",
      "--no-privileges",
      "--host",
      config.host,
      "--port",
      String(config.port),
      "--username",
      config.username,
      "--dbname",
      config.database,
    ], {
      env: {
        ...process.env,
        PGPASSWORD: config.password,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    dumpProcess.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    dumpProcess.stderr.on("data", (chunk: Buffer) => {
      errorChunks.push(chunk);
    });

    dumpProcess.on("error", (error) => {
      reject(new Error(`Erro ao executar pg_dump: ${error.message}`));
    });

    dumpProcess.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errorChunks).toString("utf-8").trim();
        reject(new Error(`pg_dump finalizou com código ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }

      const buffer = Buffer.concat(chunks);

      resolve({
        buffer,
        filename: options.filename ?? buildDumpFilename(config.database),
        mimeType: SQL_MIME_TYPE,
        database: config.database,
        size: buffer.length,
      });
    });
  });
}
