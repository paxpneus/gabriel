import { mapBlingWebhook } from "../bling-webhook.mapper";
import { BlingWebhookEnvelope } from "../bling-webhook.types";

function makeEnvelope(
  event: string,
  data: unknown,
): BlingWebhookEnvelope {
  return {
    eventId: "evt-1",
    date: "2026-01-01T00:00:00Z",
    version: "1",
    event,
    companyId: "company-1",
    data,
  };
}

describe("mapBlingWebhook — product", () => {
  it("product.deleted: NÃO usa directUpsert — delega pro mesmo requiresApiFetch de created/updated, pra fetchAndUpsertProduct decidir a partir da situacao fresca da API", () => {
    const result = mapBlingWebhook(makeEnvelope("product.deleted", { id: 90001 }));

    expect(result?.directUpsert).toBeUndefined();
    expect(result?.requiresApiFetch).toEqual(
      expect.objectContaining({
        resource: "product",
        blingId: 90001,
        action: "deleted",
      }),
    );
  });

  it("product.created e product.updated continuam indo por requiresApiFetch, igual antes", () => {
    for (const action of ["created", "updated"]) {
      const result = mapBlingWebhook(makeEnvelope(`product.${action}`, { id: 90002 }));

      expect(result?.directUpsert).toBeUndefined();
      expect(result?.requiresApiFetch).toEqual(
        expect.objectContaining({
          resource: "product",
          blingId: 90002,
          action,
        }),
      );
    }
  });
});
