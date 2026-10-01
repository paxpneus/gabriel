import {
  aggregateProductStockFlow,
  listMonthsDescending,
} from "../services/main/product-stock-flow/product-stock-flow.aggregation";

const info = new Map([
  ["p1", { name: "Pneu A", sku: "SKU-A" }],
  ["p2", { name: "Pneu B", sku: "SKU-B" }],
]);

describe("listMonthsDescending", () => {
  it("lista todos os meses do range, mais recente primeiro", () => {
    expect(listMonthsDescending("2026-05-10", "2026-07-02")).toEqual([
      "2026-07",
      "2026-06",
      "2026-05",
    ]);
  });

  it("range dentro de um único mês", () => {
    expect(listMonthsDescending("2026-05-01", "2026-05-31")).toEqual(["2026-05"]);
  });
});

describe("aggregateProductStockFlow", () => {
  const months = ["2026-06", "2026-05"];

  const inputs = [
    {
      month: "2026-05",
      product_id: "p1",
      total_input_quantity: "10.0000",
      total_input_value: "940.0000",
      inputs_without_net_amount: "0",
    },
    {
      month: "2026-06",
      product_id: "p1",
      total_input_quantity: "5.0000",
      total_input_value: "0.1000",
      inputs_without_net_amount: "1",
    },
  ];
  const outputs = [
    {
      month: "2026-05",
      product_id: "p1",
      total_output_quantity: "4.0000",
      total_output_value: "6800.00000000",
      outputs_without_price: "0",
    },
    {
      month: "2026-06",
      product_id: "p2",
      total_output_quantity: "2.0000",
      total_output_value: "0",
      outputs_without_price: "2",
    },
  ];

  const report = aggregateProductStockFlow(inputs, outputs, [], info, months);

  it("agrupa por mês em ordem decrescente, com produtos de entrada e saída juntos", () => {
    expect(report.months.map((m) => m.month)).toEqual(["2026-06", "2026-05"]);

    const may = report.months[1].products;
    expect(may).toEqual([
      {
        product_id: "p1",
        product_name: "Pneu A",
        sku: "SKU-A",
        total_input_quantity: 10,
        total_input_value: 940,
        total_output_quantity: 4,
        total_output_value: 6800,
        total_return_quantity: 0,
        total_return_value: 0,
      },
    ]);

    const june = report.months[0].products;
    expect(june.map((p) => p.product_id)).toEqual(["p1", "p2"]);
    expect(june[1]).toMatchObject({ total_output_quantity: 2, total_output_value: 0 });
  });

  it("consolida o período somando todos os meses por produto", () => {
    expect(report.consolidated).toEqual([
      expect.objectContaining({
        product_id: "p1",
        total_input_quantity: 15,
        total_input_value: 940.1,
        total_output_quantity: 4,
        total_output_value: 6800,
      }),
      expect.objectContaining({
        product_id: "p2",
        total_output_quantity: 2,
        total_output_value: 0,
      }),
    ]);
  });

  it("calcula o summary geral", () => {
    expect(report.summary).toEqual({
      total_input_quantity: 15,
      total_output_quantity: 6,
      total_input_value: 940.1,
      total_output_value: 6800,
      total_return_quantity: 0,
      total_return_value: 0,
    });
  });

  it("conta saídas sem preço e entradas sem valor líquido em warnings", () => {
    expect(report.warnings).toEqual({
      outputs_without_price: 2,
      inputs_without_net_amount: 1,
      returns_without_price: 0,
    });
  });

  it("mês sem movimento aparece com lista vazia", () => {
    const empty = aggregateProductStockFlow([], [], [], info, months);

    expect(empty.months).toEqual([
      { month: "2026-06", products: [] },
      { month: "2026-05", products: [] },
    ]);
    expect(empty.consolidated).toEqual([]);
    expect(empty.summary.total_input_value).toBe(0);
  });

  it("soma valores monetários sem erro de ponto flutuante", () => {
    const tiny = aggregateProductStockFlow(
      ["0.1", "0.2"].map((value) => ({
        month: "2026-05",
        product_id: "p1",
        total_input_quantity: "1",
        total_input_value: value,
        inputs_without_net_amount: 0,
      })),
      [],
      [],
      info,
      ["2026-05"],
    );

    expect(tiny.summary.total_input_value).toBe(0.3);
  });
  it("omite produto zerado nos 4 campos no mês e fora do relatório se zerado em todos", () => {
    const zero = (month: string, product_id: string) => ({
      month,
      product_id,
      total_input_quantity: "0",
      total_input_value: "0",
      inputs_without_net_amount: 0,
    });
    const result = aggregateProductStockFlow(
      [
        { ...zero("2026-05", "p1"), total_input_quantity: "3", total_input_value: "30" },
        zero("2026-06", "p1"),
        zero("2026-05", "p2"),
        zero("2026-06", "p2"),
      ],
      [],
      [],
      info,
      ["2026-06", "2026-05"],
    );

    expect(result.months.find((m) => m.month === "2026-06")!.products).toEqual([]);
    expect(
      result.months.find((m) => m.month === "2026-05")!.products.map((p) => p.product_id),
    ).toEqual(["p1"]);
    expect(result.consolidated.map((p) => p.product_id)).toEqual(["p1"]);
    expect(result.summary.total_input_quantity).toBe(3);
  });
});

describe("aggregateProductStockFlow — devoluções", () => {
  const month = ["2026-05"];
  const purchase = {
    month: "2026-05",
    product_id: "p1",
    total_input_quantity: "1.0000",
    total_input_value: "500.0000",
    inputs_without_net_amount: "0",
  };
  const sale = {
    month: "2026-05",
    product_id: "p1",
    total_output_quantity: "1.0000",
    total_output_value: "1000.0000",
    outputs_without_price: "0",
  };
  const oneReturn = {
    month: "2026-05",
    product_id: "p1",
    total_return_quantity: "1.0000",
    total_return_value: "390.8300",
    returns_without_price: "0",
  };

  it("devolução não entra nas entradas, aparece nas colunas de devolução e abate a saída", () => {
    const report = aggregateProductStockFlow(
      [purchase],
      [sale],
      [oneReturn],
      info,
      month,
    );

    expect(report.months[0].products).toEqual([
      expect.objectContaining({
        product_id: "p1",
        total_input_quantity: 1,
        total_input_value: 500,
        total_output_quantity: 0,
        total_output_value: 609.17,
        total_return_quantity: 1,
        total_return_value: 390.83,
      }),
    ]);
  });

  it("entradas menos saídas líquidas fecha com a variação do estoque (compra 1, venda 1, devolução 1 = +1)", () => {
    const { summary } = aggregateProductStockFlow(
      [purchase],
      [sale],
      [{ ...oneReturn, total_return_value: "1000.0000" }],
      info,
      month,
    );

    expect(summary.total_input_quantity - summary.total_output_quantity).toBe(1);
    expect(summary.total_output_value).toBe(0);
  });

  it("consolida e soma o summary das devoluções de vários meses", () => {
    const report = aggregateProductStockFlow(
      [],
      [],
      [oneReturn, { ...oneReturn, month: "2026-04", total_return_value: "100.1000" }],
      info,
      ["2026-05", "2026-04"],
    );

    expect(report.consolidated[0]).toMatchObject({
      total_return_quantity: 2,
      total_return_value: 490.93,
      total_output_quantity: -2,
      total_output_value: -490.93,
    });
    expect(report.summary).toMatchObject({
      total_return_quantity: 2,
      total_return_value: 490.93,
      total_input_quantity: 0,
    });
  });

  it("produto só com devolução no mês aparece no relatório", () => {
    const report = aggregateProductStockFlow([], [], [oneReturn], info, month);

    expect(report.months[0].products.map((p) => p.product_id)).toEqual(["p1"]);
  });

  it("devolução sem preço abate só a quantidade da saída e conta em warnings", () => {
    const report = aggregateProductStockFlow(
      [],
      [sale],
      [{ ...oneReturn, total_return_value: "0", returns_without_price: "1" }],
      info,
      month,
    );

    expect(report.consolidated[0]).toMatchObject({
      total_output_quantity: 0,
      total_output_value: 1000,
      total_return_quantity: 1,
      total_return_value: 0,
    });
    expect(report.warnings.returns_without_price).toBe(1);
  });
});
