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

  const native = error.parent ?? error.original ?? {};

  const detail: Record<string, any> = {
    sequelizeMessage: error.message,
    nativeMessage: native.message,
    nativeCode: native.code,
    detail: native.detail,
    hint: native.hint,
    schema: native.schema,
    table: native.table,
    column: native.column,
    constraint: native.constraint,
    sequelizeFields: error.fields,
    sqlPreview: typeof error.sql === "string"
      ? error.sql.substring(0, 300)
      : undefined,
    ...context,
  };

  const clean = Object.fromEntries(
    Object.entries(detail).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );

  // ← Enriquece a mensagem do erro original para aparecer no dashboard
  const enrichedMessage = `${prefix} [${error.name ?? "SequelizeError"}] ${native.message ?? error.message} | ${JSON.stringify(clean)}`;
  error.message = enrichedMessage;

  console.error(enrichedMessage);
}

export function rethrowWithLog(
  prefix: string,
  context?: Record<string, any>,
): (error: any) => never {
  return (error: any) => {
    logDbError(prefix, error, context);
    throw error;
  };
}