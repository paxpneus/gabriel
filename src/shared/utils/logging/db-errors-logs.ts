/**
 * Extrai e loga detalhes completos de erros do Sequelize,
 * especialmente erros de constraint que ficam em error.parent / error.original.
 */
export function logDbError(
  prefix: string,
  error: any,
  context?: Record<string, any>,
): void {
  const isSequelizeError =
    error?.name?.startsWith("Sequelize") ||
    error?.parent != null ||
    error?.original != null;

  if (!isSequelizeError) {
    console.error(`${prefix}`, error);
    return;
  }

  // O Sequelize encapsula o erro nativo do driver em `parent` ou `original`
  const native = error.parent ?? error.original ?? {};

  const detail: Record<string, any> = {
    // Mensagem de alto nível do Sequelize
    sequelizeMessage: error.message,

    // Campos do driver nativo (pg / mysql2 / etc.)
    nativeMessage: native.message,
    nativeCode: native.code,           // ex: "23505" (unique), "23503" (fk), "23502" (not null)
    detail: native.detail,             // ex: 'Key (ean)=(123) already exists.'
    hint: native.hint,
    schema: native.schema,
    table: native.table,
    column: native.column,
    constraint: native.constraint,     // nome da constraint violada
    dataType: native.dataType,
    where: native.where,

    // Campos específicos do Sequelize
    sequelizeFields: error.fields,     // { ean: '123' }
    sqlPreview: typeof error.sql === "string"
      ? error.sql.substring(0, 600)
      : undefined,

    // Contexto de negócio passado pelo chamador
    ...context,
  };

  // Remove chaves undefined para o log ficar limpo
  const clean = Object.fromEntries(
    Object.entries(detail).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );

  console.error(`${prefix} DB error [${error.name ?? "SequelizeError"}]`, JSON.stringify(clean, null, 2));
}

/**
 * Versão para usar em .catch() encadeado — relança o erro após logar.
 *
 * Exemplo:
 *   await Invoice.upsert({ ... }).catch(rethrowWithLog("[FETCH]", { blingId: 42 }));
 */
export function rethrowWithLog(
  prefix: string,
  context?: Record<string, any>,
): (error: any) => never {
  return (error: any) => {
    logDbError(prefix, error, context);
    throw error;
  };
}