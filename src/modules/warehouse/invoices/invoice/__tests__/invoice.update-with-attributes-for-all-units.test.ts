// // ─── Mocks dos models Sequelize ───────────────────────────────────────────────

// jest.mock("../invoice.model", () => ({
//   __esModule: true,
//   default: {
//     update: jest.fn(),
//   },
// }));

// jest.mock(
//   "../../invoice-unit-business-attributes/invoice-unit-business-attributes.model",
//   () => ({
//     __esModule: true,
//     default: {
//       update: jest.fn(),
//     },
//   }),
// );


// import Invoice from "../invoice.model";
// import InvoiceUnitBusinessAttributes from "../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
// import { InvoiceRepository } from "../invoice.repository";


// const invoiceUpdateMock = Invoice.update as jest.Mock;
// const attrsUpdateMock = InvoiceUnitBusinessAttributes.update as jest.Mock;


// const repository = new InvoiceRepository();

// const INVOICE_IDS = [
//   "invoice-1",
//   "invoice-2",
// ];


// beforeEach(() => {
//   jest.clearAllMocks();

//   invoiceUpdateMock.mockResolvedValue([1]);
//   attrsUpdateMock.mockResolvedValue([1]);
// });

// // ─── Suite ────────────────────────────────────────────────────────────────────

// describe("InvoiceRepository.updateWithAttributesForAllUnits", () => {
//   it("atualiza somente status, sem tocar em Invoice nem em type", async () => {
//     await repository.updateWithAttributesForAllUnits(INVOICE_IDS, {
//       status: "PENDING",
//     });

//     expect(invoiceUpdateMock).not.toHaveBeenCalled();
//     expect(attrsUpdateMock).toHaveBeenCalledTimes(1);
//     expect(attrsUpdateMock).toHaveBeenCalledWith(
//       { status: "PENDING" },
//       { where: { invoice_id: { [Symbol.for("in") as any]: INVOICE_IDS } } },
//     );
//   });

//   it("atualiza somente batch_generated", async () => {
//     await repository.updateWithAttributesForAllUnits(INVOICE_IDS, {
//       batch_generated: true,
//     });

//     expect(invoiceUpdateMock).not.toHaveBeenCalled();
//     const [payload] = attrsUpdateMock.mock.calls[0];
//     expect(payload).toEqual({ batch_generated: true });
//   });

//   it("atualiza status e batch_generated juntos", async () => {
//     await repository.updateWithAttributesForAllUnits(INVOICE_IDS, {
//       status: "FINISHED",
//       batch_generated: true,
//     });

//     const [payload] = attrsUpdateMock.mock.calls[0];
//     expect(payload).toEqual({ status: "FINISHED", batch_generated: true });
//   });

//   it("atualiza campos da invoice (ex: reprocesso via Bling) sem tocar em attributes", async () => {
//     await repository.updateWithAttributesForAllUnits(INVOICE_IDS, {
//       sender_cnpj: "novo-cnpj",
//       invoice_value: 100,
//     } as any);

//     expect(attrsUpdateMock).not.toHaveBeenCalled();
//     const [payload] = invoiceUpdateMock.mock.calls[0];
//     expect(payload).toEqual({
//       sender_cnpj: "novo-cnpj",
//       invoice_value: 100,
//     });
//   });

//   it("não chama nenhum update se data vier vazio", async () => {
//     await repository.updateWithAttributesForAllUnits(INVOICE_IDS, {});

//     expect(invoiceUpdateMock).not.toHaveBeenCalled();
//     expect(attrsUpdateMock).not.toHaveBeenCalled();
//   });

//   it("respeita attrWhere adicional (ex: unit_business_id específico)", async () => {
//     await repository.updateWithAttributesForAllUnits(
//       INVOICE_IDS,
//       { status: "OPEN" },
//       { unit_business_id: "unit-business-a" },
//     );

//     const [, options] = attrsUpdateMock.mock.calls[0];
//     expect(options.where).toMatchObject({ unit_business_id: "unit-business-a" });
//   });

//   // ─── Regressão: update jamais deve tocar em type ──────────────────────────
//   // Mesmo que alguém force `type` no payload via `as any` (bypass do TS),
//   // a função precisa descartar o campo — nem manda pro Invoice.update
//   // (que não deveria ter esse campo) nem pro attributes.update (onde
//   // sobrescrever type sem saber se a invoice tem 1 ou 2 unit business
//   // associadas quebraria o par INCOMING/OUTGOING de transferências internas).
//   it("descarta 'type' mesmo se vier junto de status/batch_generated, forçado via as any", async () => {
//     await repository.updateWithAttributesForAllUnits(INVOICE_IDS, {
//       status: "PENDING",
//       batch_generated: false,
//       type: "INCOMING",
//     } as any);

//     const [attrsPayload] = attrsUpdateMock.mock.calls[0];
//     expect(attrsPayload).not.toHaveProperty("type");
//     expect(attrsPayload).toEqual({ status: "PENDING", batch_generated: false });
//   });

//   it("descarta 'type' mesmo quando é o único campo além de dados de invoice — não gera update de attributes", async () => {
//     await repository.updateWithAttributesForAllUnits(INVOICE_IDS, {
//       sender_cnpj: "novo-cnpj",
//       type: "OUTGOING",
//     } as any);

//     // status e batch_generated continuam undefined -> não deve chamar attrs.update
//     expect(attrsUpdateMock).not.toHaveBeenCalled();

//     // e 'type' também não pode vazar pro Invoice.update
//     const [invoicePayload] = invoiceUpdateMock.mock.calls[0];
//     expect(invoicePayload).not.toHaveProperty("type");
//     expect(invoicePayload).toEqual({ sender_cnpj: "novo-cnpj" });
//   });
// });