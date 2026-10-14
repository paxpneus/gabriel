import { parseMagentoOrderId } from "../magento-order-id";

describe("parseMagentoOrderId", () => {
  it("pega o entity_id (2º número) do numeroLoja do site", () => {
    expect(parseMagentoOrderId("000001271_631")).toBe("631");
  });

  it("tolera espaços", () => {
    expect(parseMagentoOrderId(" 000000461_239 ")).toBe("239");
  });

  it.each([null, undefined, "", "1271", "2000012345678", "abc_631", "000001271_"])(
    "retorna null pra numeroLoja fora do padrão do site (%p)",
    (value) => {
      expect(parseMagentoOrderId(value as any)).toBeNull();
    },
  );
});
