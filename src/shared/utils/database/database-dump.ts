import { spawn } from "node:child_process";
import { Readable, Transform, TransformCallback } from "node:stream";

// Transform (não PassThrough + listener "data"): um listener "data" força o
// stream a modo flowing assim que é criado, antes do axios anexar o próprio
// consumo — qualquer chunk emitido nesse intervalo seria perdido (evento
// "data" só entrega a quem já está inscrito no momento da emissão). Um
// Transform só processa/conta o que cabe no buffer interno até ter um
// consumidor de verdade (pipe do axios), sem descartar nada.
class ByteCountingStream extends Transform {
  private bytes = 0;

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.bytes += chunk.length;
    callback(null, chunk);
  }

  get size(): number {
    return this.bytes;
  }
}

export type DatabaseDumpConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

export type DownloadDatabaseDumpOptions = {
  config?: Partial<DatabaseDumpConfig>;
  filename?: string;
};

export type DatabaseDumpStream = {
  stream: Readable;
  filename: string;
  mimeType: string;
  database: string;
  getSize: () => number;
  kill: () => void;
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

// Streama o pg_dump direto pro consumidor (upload), sem nunca materializar o
// dump inteiro em memória — bancos grandes geravam picos de RAM/swap na VM.
export function streamDatabaseDump(
  options: DownloadDatabaseDumpOptions = {},
): DatabaseDumpStream {
  const config = getRequiredDatabaseConfig(options.config);

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

  const errorChunks: Buffer[] = [];
  dumpProcess.stderr.on("data", (chunk: Buffer) => {
    errorChunks.push(chunk);
  });

  const output = new ByteCountingStream();

  dumpProcess.on("error", (error) => {
    output.destroy(new Error(`Erro ao executar pg_dump: ${error.message}`));
  });

  // "exit" (não "close"): aborta o stream antes que o consumidor ache que já
  // recebeu o dump completo — "close" só dispara depois do stdout ser drenado.
  dumpProcess.on("exit", (code) => {
    if (code !== 0) {
      const stderr = Buffer.concat(errorChunks).toString("utf-8").trim();
      output.destroy(new Error(`pg_dump finalizou com código ${code}${stderr ? `: ${stderr}` : ""}`));
    }
  });

  dumpProcess.stdout.pipe(output);

  return {
    stream: output,
    filename: options.filename ?? buildDumpFilename(config.database),
    mimeType: SQL_MIME_TYPE,
    database: config.database,
    getSize: () => output.size,
    kill: () => {
      dumpProcess.kill();
    },
  };
}
