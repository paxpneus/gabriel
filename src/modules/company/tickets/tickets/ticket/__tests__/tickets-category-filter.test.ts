import { Op } from "sequelize";
import ticketService from "../tickets.service";

const customFields = () => ticketService.getQueryConfig().customFields!;
const sql = (where: any): string => where.id[Op.in].val;

describe("tickets filters[category_id]/[category_option_id] — IN cru", () => {
  it.each(["category_id", "category_option_id"])("%s: inteiros entram no IN", (field) => {
    expect(sql(customFields()[field](["3", "7"]))).toMatch(/IN \(3,7\)/);
  });

  it.each(["category_id", "category_option_id"])(
    "%s: valor não inteiro é descartado (antes virava NaN no SQL → 500)",
    (field) => {
      expect(sql(customFields()[field](["3) OR (1=1", "7"]))).toMatch(/IN \(7\)/);
    },
  );

  it.each(["category_id", "category_option_id"])("%s: nenhum id válido → nada bate", (field) => {
    expect(customFields()[field]("abc")).toEqual({ id: null });
  });
});
