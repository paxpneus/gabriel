import { mapMercadoLivreLabelStatus } from "../map-label-status";
import { MarketPlaceLabelStatus } from "../../../../sales/orders/order/orders.types";

describe("mapMercadoLivreLabelStatus", () => {
  it.each(["ready_to_print", "printed"])(
    "status=ready_to_ship + substatus=%s → READY_TO_PRINT",
    (substatus) => {
      expect(mapMercadoLivreLabelStatus("ready_to_ship", substatus)).toBe(
        MarketPlaceLabelStatus.READY_TO_PRINT,
      );
    },
  );

  it("status=ready_to_ship mas substatus fora da lista de impressão: não é READY_TO_PRINT", () => {
    expect(mapMercadoLivreLabelStatus("ready_to_ship", "buffered")).not.toBe(
      MarketPlaceLabelStatus.READY_TO_PRINT,
    );
  });

  it.each(["invoice_pending", "waiting_for_invoice"])(
    "substatus=%s (independente do status) → WAITING_MARKETPLACE_PROCESS_NFE",
    (substatus) => {
      expect(mapMercadoLivreLabelStatus("ready_to_ship", substatus)).toBe(
        MarketPlaceLabelStatus.WAITING_MARKETPLACE_PROCESS_NFE,
      );
    },
  );

  it.each(["waiting_for_label_generation", "buffered"])(
    "substatus=%s → WAITING_MARKETPLACE_LABEL_GENERATION",
    (substatus) => {
      expect(mapMercadoLivreLabelStatus("ready_to_ship", substatus)).toBe(
        MarketPlaceLabelStatus.WAITING_MARKETPLACE_LABEL_GENERATION,
      );
    },
  );

  it("status/substatus desconhecidos: default UNKNOWN", () => {
    expect(mapMercadoLivreLabelStatus("algo_novo", "outra_coisa")).toBe(
      MarketPlaceLabelStatus.UNKNOWN,
    );
  });

  it("status/substatus nulos: default UNKNOWN, sem lançar", () => {
    expect(mapMercadoLivreLabelStatus(null, null)).toBe(MarketPlaceLabelStatus.UNKNOWN);
  });
});
