// import { InvoiceUnitBusinessAttributesCreationAttributes } from "../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
// import { InvoiceCreationData, ItemWithFiscal } from './../invoice.types';

// // ─── Mocks dos módulos externos ───────────────────────────────────────────────

// jest.mock("../../../../../config/sequelize", () => ({
//   __esModule: true,
//   default: {
//     transaction: jest.fn(),
//   },
// }));

// jest.mock("../invoice.repository", () => ({
//   __esModule: true,
//   default: {
//     findUnitBusinessesByCnpj: jest.fn(),
//     createInvoice: jest.fn(),
//     createInvoiceItems: jest.fn(),
//     createInvoiceFiscalItems: jest.fn(),
//     createInvoiceAttributes: jest.fn(),
//   },
// }));

// import sequelize from "../../../../../config/sequelize";
// import mockedRepository from "../invoice.repository";
// import invoiceService from "../invoice.service";

// const repo = mockedRepository as unknown as {
//   findUnitBusinessesByCnpj: jest.Mock;
//   createInvoice: jest.Mock;
//   createInvoiceItems: jest.Mock;
//   createInvoiceFiscalItems: jest.Mock;
//   createInvoiceAttributes: jest.Mock;
// };

// // ─── Helpers ──────────────────────────────────────────────────────────────────

// const UNIT_A = "unit-business-a"; // ex: matriz — sempre unit business conhecida
// const UNIT_B = "unit-business-b"; // ex: filial — também unit business conhecida
// const EXTERNAL_CNPJ = "11222333000144"; // cliente/fornecedor externo, nunca é unit business

// const fakeTransaction = { commit: jest.fn(), rollback: jest.fn() };

// const baseInvoiceData: InvoiceCreationData = {
//   sender_cnpj: "",
//   receiver_cnpj: "",
// } as InvoiceCreationData;

// const items: ItemWithFiscal[] = [
//   { product_id: "prod-1", quantity_expected: 2, fiscal: undefined },
// ];

// // Extrai as attributes que foram efetivamente passadas pro bulkCreate,
// // pra não depender de mockar retorno de createInvoice em cada teste.
// const getCreatedAttributes = ():
//   | InvoiceUnitBusinessAttributesCreationAttributes[]
//   | undefined => repo.createInvoiceAttributes.mock.calls[0]?.[0];

// beforeEach(() => {
//   jest.clearAllMocks();
//   (sequelize.transaction as jest.Mock).mockResolvedValue(fakeTransaction);
//   repo.createInvoice.mockResolvedValue({ id: "invoice-1" });
//   repo.createInvoiceItems.mockResolvedValue(undefined);
//   repo.createInvoiceFiscalItems.mockResolvedValue(undefined);
//   repo.createInvoiceAttributes.mockResolvedValue(undefined);
// });

// // ─── Suite ────────────────────────────────────────────────────────────────────

// describe("InvoiceService.createWithRelations — resolução de type por cnpj", () => {
//   describe("caso 1: transferência interna (sender e receiver são unit business conhecidas)", () => {
//     it("cria dois attributes: sender OUTGOING/OPEN e receiver INCOMING/initialStatus, ignorando invoiceType", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([
//         { id: UNIT_A, cnpj: "sender-cnpj" },
//         { id: UNIT_B, cnpj: "receiver-cnpj" },
//       ]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: "receiver-cnpj" },
//         items,
//         { initialStatus: "WAITING_SCHEDULE_SALES", invoiceType: "INCOMING" }, // mesmo passando invoiceType, deve ser ignorado quando os dois lados batem
//       );

//       const attrs = getCreatedAttributes();
//       expect(attrs).toHaveLength(2);
//       expect(attrs).toContainEqual(
//         expect.objectContaining({
//           unit_business_id: UNIT_A,
//           type: "OUTGOING",
//           status: "OPEN",
//         }),
//       );
//       expect(attrs).toContainEqual(
//         expect.objectContaining({
//           unit_business_id: UNIT_B,
//           type: "INCOMING",
//           status: "WAITING_SCHEDULE_SALES",
//         }),
//       );
//     });
//   });

//   describe("caso 2: só sender é unit business conhecida (nota de saída normal)", () => {
//     it("sem invoiceType, assume OUTGOING por padrão (comportamento normal)", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([
//         { id: UNIT_A, cnpj: "sender-cnpj" },
//       ]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: EXTERNAL_CNPJ },
//         items,
//       );

//       const attrs = getCreatedAttributes();
//       expect(attrs).toHaveLength(1);
//       expect(attrs![0]).toMatchObject({
//         unit_business_id: UNIT_A,
//         type: "OUTGOING",
//         status: "OPEN",
//       });
//     });

//     it("com invoiceType=INCOMING (nota de retorno), grava INCOMING mesmo sendo o sender — é o bug original que estamos corrigindo", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([
//         { id: UNIT_A, cnpj: "sender-cnpj" },
//       ]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: EXTERNAL_CNPJ },
//         items,
//         { invoiceType: "INCOMING" },
//       );

//       const attrs = getCreatedAttributes();
//       expect(attrs).toHaveLength(1);
//       expect(attrs![0]).toMatchObject({
//         unit_business_id: UNIT_A,
//         type: "INCOMING", // nota de retorno: mesmo sendo sender, o Bling diz que é entrada
//         status: "OPEN",
//       });
//     });
//   });

//   describe("caso 3: só receiver é unit business conhecida (nota de entrada normal)", () => {
//     it("sem invoiceType, assume INCOMING por padrão", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([
//         { id: UNIT_B, cnpj: "receiver-cnpj" },
//       ]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "receiver-cnpj" },
//         items,
//         { initialStatus: "WAITING_SCHEDULE_SALES" },
//       );

//       const attrs = getCreatedAttributes();
//       expect(attrs).toHaveLength(1);
//       expect(attrs![0]).toMatchObject({
//         unit_business_id: UNIT_B,
//         type: "INCOMING",
//         status: "WAITING_SCHEDULE_SALES",
//       });
//     });

//     it("com invoiceType=OUTGOING (caso simétrico ao de retorno, do lado do destinatário), respeita o tipo vindo da fonte", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([
//         { id: UNIT_B, cnpj: "receiver-cnpj" },
//       ]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "receiver-cnpj" },
//         items,
//         { invoiceType: "OUTGOING" },
//       );

//       const attrs = getCreatedAttributes();
//       expect(attrs![0]).toMatchObject({
//         unit_business_id: UNIT_B,
//         type: "OUTGOING",
//       });
//     });
//   });

//   describe("caso 4: nem sender nem receiver são unit business conhecidas", () => {
//     it("não cria nenhum attribute e não chama createInvoiceAttributes", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro-externo" },
//         items,
//       );

//       expect(repo.createInvoiceAttributes).not.toHaveBeenCalled();
//     });
//   });

//   describe("deduplicação de items", () => {
//     it("soma quantity_expected de items com mesmo product_id antes de criar", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([
//         { id: UNIT_A, cnpj: "sender-cnpj" },
//       ]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: EXTERNAL_CNPJ },
//         [
//           { product_id: "prod-1", quantity_expected: 2.4, fiscal: undefined },
//           { product_id: "prod-1", quantity_expected: 1.4, fiscal: undefined },
//           { product_id: "prod-2", quantity_expected: 5, fiscal: undefined },
//         ],
//       );

//       const createdItems = repo.createInvoiceItems.mock.calls[0][0];
//       expect(createdItems).toHaveLength(2);
//       const prod1 = createdItems.find((i: any) => i.product_id === "prod-1");
//       // Math.trunc(2.4 + 1.4) = Math.trunc(3.8) = 3
//       expect(prod1.quantity_expected).toBe(3);
//     });
//   });

//   describe("transação", () => {
//     it("usa transação externa quando fornecida e não faz commit/rollback próprio", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([]);
//       const externalTx = { commit: jest.fn(), rollback: jest.fn() };

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro" },
//         items,
//         { transaction: externalTx as any },
//       );

//       expect(externalTx.commit).not.toHaveBeenCalled();
//       expect(sequelize.transaction).not.toHaveBeenCalled();
//     });

//     it("cria e comita própria transação quando nenhuma é fornecida", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([]);

//       await invoiceService.createWithRelations(
//         { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro" },
//         items,
//       );

//       expect(fakeTransaction.commit).toHaveBeenCalledTimes(1);
//       expect(fakeTransaction.rollback).not.toHaveBeenCalled();
//     });

//     it("faz rollback da própria transação se algo falhar, e propaga o erro", async () => {
//       repo.findUnitBusinessesByCnpj.mockResolvedValue([]);
//       repo.createInvoice.mockRejectedValue(new Error("db error"));

//       await expect(
//         invoiceService.createWithRelations(
//           { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro" },
//           items,
//         ),
//       ).rejects.toThrow("db error");

//       expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
//       expect(fakeTransaction.commit).not.toHaveBeenCalled();
//     });
//   });
// });