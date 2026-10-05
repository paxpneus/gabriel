import {
  CD21_STATUS_LABELS,
  NextActionInput,
  getNextAction,
} from "../next-action.rules";
import {
  PdvSalesRequestStatus as S,
  PdvShippingType,
} from "../../pdv-sales-request.types";

const input = (overrides: Partial<NextActionInput> = {}): NextActionInput => ({
  status: S.OPEN,
  shipping_type: null,
  correction_origin_status: null,
  has_receipt: false,
  ...overrides,
});

describe("getNextAction", () => {
  describe("store", () => {
    it.each([
      [false, null],
      [true, null],
      [false, PdvShippingType.ADT],
    ])("OPEN faltando comprovante ou tipo de envio (receipt=%s, shipping=%s)", (has_receipt, shipping_type) => {
      expect(getNextAction(input({ has_receipt, shipping_type }), "store")).toBe(
        "Anexar comprovante e tipo de envio",
      );
    });

    it("OPEN com comprovante e tipo de envio", () => {
      expect(
        getNextAction(
          input({ has_receipt: true, shipping_type: PdvShippingType.TRANSPORTADORA }),
          "store",
        ),
      ).toBe("Enviar solicitação para análise");
    });

    it("PENDING_CORRECTION vinda do financeiro", () => {
      expect(
        getNextAction(
          input({ status: S.PENDING_CORRECTION, correction_origin_status: S.PENDING_FINANCE }),
          "store",
        ),
      ).toBe("Enviar solicitação para análise");
    });

    it("PENDING_CORRECTION vinda da análise CD21", () => {
      expect(
        getNextAction(
          input({
            status: S.PENDING_CORRECTION,
            correction_origin_status: S.PENDING_CD21_ANALYSIS,
          }),
          "store",
        ),
      ).toBe("Confirmar correção");
    });

    it.each([S.SHIPPING, S.SHIP_TODAY, S.INVOICE_CANCELLED, null])(
      "PENDING_CORRECTION com outra origem (%s)",
      (origin) => {
        expect(
          getNextAction(
            input({ status: S.PENDING_CORRECTION, correction_origin_status: origin }),
            "store",
          ),
        ).toBe("Resolver correção");
      },
    );

    it.each(
      Object.values(S).filter((s) => s !== S.OPEN && s !== S.PENDING_CORRECTION),
    )("%s → null", (status) => {
      expect(getNextAction(input({ status }), "store")).toBeNull();
    });
  });

  describe("finance", () => {
    it("PENDING_FINANCE", () => {
      expect(getNextAction(input({ status: S.PENDING_FINANCE }), "finance")).toBe(
        "Aprovar ou rejeitar comprovante",
      );
    });

    it.each(Object.values(S).filter((s) => s !== S.PENDING_FINANCE))(
      "%s → null (inclusive OPEN/PENDING_CORRECTION, que eram ações da loja)",
      (status) => {
        expect(getNextAction(input({ status }), "finance")).toBeNull();
      },
    );
  });

  describe("cd21", () => {
    it("tem label pros 12 status", () => {
      expect(Object.keys(CD21_STATUS_LABELS).sort()).toEqual(Object.values(S).sort());
      expect(Object.values(S)).toHaveLength(12);
    });

    it.each(Object.values(S))("%s repete o label do status", (status) => {
      expect(getNextAction(input({ status }), "cd21")).toBe(CD21_STATUS_LABELS[status]);
    });
  });

  describe("telesales (TODO: igual à loja)", () => {
    it.each([
      input(),
      input({ has_receipt: true, shipping_type: PdvShippingType.ADT }),
      input({ status: S.PENDING_CORRECTION, correction_origin_status: S.PENDING_FINANCE }),
      input({ status: S.PENDING_CORRECTION, correction_origin_status: S.PENDING_CD21_ANALYSIS }),
      input({ status: S.PENDING_CORRECTION }),
      input({ status: S.FINISHED }),
    ])("mesmo resultado da loja (%#)", (value) => {
      expect(getNextAction(value, "telesales")).toBe(getNextAction(value, "store"));
    });
  });
});
