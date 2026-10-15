// Erro de regra do import manual: o controller devolve `body` com `httpStatus`.
export class ManualImportError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly body: { code: string; message?: string } & Record<
      string,
      unknown
    >,
  ) {
    super(body.message ?? body.code);
  }
}
