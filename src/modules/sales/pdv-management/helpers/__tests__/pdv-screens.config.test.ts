import {
  PDV_BOARD_SCREENS,
  PdvBoardScreen,
  findVisibleColumn,
  resolveBoardScreen,
  resolveColumns,
} from "../pdv-screens.config";
import { PdvSalesRequestStatus as S } from "../../sales-request/pdv-sales-request.types";
import { PdvAccessScreen } from "../../pdv-access/pdv-access.types";

const keys = (screen: PdvBoardScreen, includeClosed: boolean, includeOtherScreens: boolean) =>
  resolveColumns(screen, { includeClosed, includeOtherScreens }).map((c) => c.key);

const statusesOf = (screen: PdvBoardScreen) =>
  resolveColumns(screen, { includeClosed: true, includeOtherScreens: true }).flatMap(
    (c) => c.statuses,
  );

describe("pdv-screens.config", () => {
  describe("resolveColumns — colunas por tela × flags", () => {
    it.each<[PdvBoardScreen, boolean, boolean, string[]]>([
      ["store", false, false, ["open", "finance_analysis", "correction", "cd21_analysis", "cd21_billing"]],
      ["store", true, false, ["open", "finance_analysis", "correction", "cd21_analysis", "cd21_billing", "finished", "excluded"]],
      ["store", false, true, ["open", "finance_analysis", "correction", "cd21_analysis", "cd21_billing"]],
      ["store", true, true, ["open", "finance_analysis", "correction", "cd21_analysis", "cd21_billing", "finished", "excluded"]],
      ["finance", false, false, ["awaiting_analysis", "correction", "approved", "cancelled"]],
      ["finance", true, false, ["awaiting_analysis", "correction", "approved", "finished", "cancelled"]],
      ["finance", false, true, ["open", "awaiting_analysis", "correction", "approved", "cancelled"]],
      ["finance", true, true, ["open", "awaiting_analysis", "correction", "approved", "finished", "cancelled"]],
      ["cd21", false, false, ["correction", "awaiting_analysis", "nf_sale", "nf_transfer", "shipping", "ship_today"]],
      ["cd21", true, false, ["correction", "awaiting_analysis", "nf_sale", "nf_transfer", "shipping", "ship_today", "finished"]],
      ["cd21", false, true, ["open", "finance_analysis", "correction", "awaiting_analysis", "nf_sale", "nf_transfer", "shipping", "ship_today"]],
      ["cd21", true, true, ["open", "finance_analysis", "correction", "awaiting_analysis", "nf_sale", "nf_transfer", "shipping", "ship_today", "finished"]],
    ])("%s closed=%s other=%s", (screen, includeClosed, includeOtherScreens, expected) => {
      expect(keys(screen, includeClosed, includeOtherScreens)).toEqual(expected);
    });

    it("telesales usa as colunas da loja (TODO)", () => {
      expect(PDV_BOARD_SCREENS.telesales).toBe(PDV_BOARD_SCREENS.store);
    });

    it("cd21_billing da loja agrupa os 4 status de faturamento/expedição", () => {
      const column = findVisibleColumn("store", "cd21_billing", {
        includeClosed: false,
        includeOtherScreens: false,
      });
      expect(column?.statuses).toEqual([
        S.PENDING_NF_SALE,
        S.PENDING_NF_TRANSFER,
        S.SHIPPING,
        S.SHIP_TODAY,
      ]);
    });
  });

  describe("description/highlighted", () => {
    const all = { includeClosed: true, includeOtherScreens: true };
    const highlightedKeys = (screen: PdvBoardScreen) =>
      resolveColumns(screen, all)
        .filter((c) => c.highlighted && !c.extra)
        .map((c) => c.key);

    it.each<[PdvBoardScreen, string[]]>([
      ["store", ["open", "correction"]],
      ["telesales", ["open", "correction"]],
      ["finance", ["awaiting_analysis"]],
      ["cd21", ["awaiting_analysis", "nf_sale", "nf_transfer", "shipping", "ship_today"]],
    ])("%s: colunas destacadas", (screen, expected) => {
      expect(highlightedKeys(screen)).toEqual(expected);
    });

    it.each<PdvBoardScreen>(["store", "finance", "cd21", "telesales"])(
      "%s: toda coluna tem descrição",
      (screen) => {
        resolveColumns(screen, all).forEach((c) => expect(c.description).toBeTruthy());
      },
    );
  });

  describe("EXCLUDED", () => {
    it.each<PdvBoardScreen>(["store", "telesales"])(
      "%s: só com include_closed",
      (screen) => {
        const visible = (includeClosed: boolean) =>
          resolveColumns(screen, { includeClosed, includeOtherScreens: true }).flatMap(
            (c) => c.statuses,
          );
        expect(visible(false)).not.toContain(S.EXCLUDED);
        expect(visible(true)).toContain(S.EXCLUDED);
      },
    );

    it.each<PdvBoardScreen>(["finance", "cd21"])("%s: nunca", (screen) => {
      expect(statusesOf(screen)).not.toContain(S.EXCLUDED);
    });
  });

  describe("CANCELLED/INVOICE_CANCELLED", () => {
    it.each<PdvBoardScreen>(["store", "telesales", "cd21"])("%s: nunca", (screen) => {
      expect(statusesOf(screen)).not.toContain(S.CANCELLED);
      expect(statusesOf(screen)).not.toContain(S.INVOICE_CANCELLED);
    });

    it("finance: na coluna cancelled, por padrão", () => {
      const column = findVisibleColumn("finance", "cancelled", {
        includeClosed: false,
        includeOtherScreens: false,
      });
      expect(column?.statuses).toEqual([S.CANCELLED, S.INVOICE_CANCELLED]);
    });
  });

  describe("findVisibleColumn", () => {
    const noFlags = { includeClosed: false, includeOtherScreens: false };

    it("coluna closed sem include_closed → null", () => {
      expect(findVisibleColumn("store", "finished", noFlags)).toBeNull();
    });

    it("coluna extra sem include_other_screens → null", () => {
      expect(findVisibleColumn("cd21", "open", noFlags)).toBeNull();
    });

    it("key de outra tela → null, mesmo com todas as flags", () => {
      expect(
        findVisibleColumn("store", "nf_sale", { includeClosed: true, includeOtherScreens: true }),
      ).toBeNull();
      expect(
        findVisibleColumn("cd21", "cancelled", { includeClosed: true, includeOtherScreens: true }),
      ).toBeNull();
    });

    it("coluna visível → a própria coluna", () => {
      expect(findVisibleColumn("finance", "approved", noFlags)?.label).toBe("Aprovado");
    });
  });

  describe("resolveBoardScreen", () => {
    it.each([
      [PdvAccessScreen.FINANCE, "STORE_LINK", "finance"],
      [PdvAccessScreen.FINANCE, "LOGIN", "finance"],
      [PdvAccessScreen.CD21, "STORE_LINK", "cd21"],
      [PdvAccessScreen.CD21, "LOGIN", "cd21"],
      [PdvAccessScreen.STORE_REQUEST, "TELESALES_LINK", "telesales"],
      [PdvAccessScreen.STORE_REQUEST, "STORE_LINK", "store"],
      [PdvAccessScreen.STORE_REQUEST, "LOGIN", "store"],
    ] as const)("%s via %s → %s", (screen, via, expected) => {
      expect(resolveBoardScreen({ screen, via })).toBe(expected);
    });
  });
});
