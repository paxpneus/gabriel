const mockTransaction = {} as any;
jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb(mockTransaction)) },
}));

jest.mock("../../contacts/contacts.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("../coupons/coupons.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../contact-coupons/contact-coupons.repository", () => ({
  __esModule: true,
  default: {
    findActiveByCoupon: jest.fn(),
    findOwnerAt: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

import contactService from "../../contacts/contacts.service";
import couponService from "../coupons/coupons.service";
import contactCouponRepository from "../contact-coupons/contact-coupons.repository";
import { ContactCouponService } from "../contact-coupons/contact-coupons.service";

describe("ContactCouponService", () => {
  const service = new ContactCouponService();
  const dto = { contact_id: "affiliate-1", coupon_id: "coupon-1", commission_rate: 5 };

  beforeEach(() => {
    jest.clearAllMocks();
    (contactService.findOne as jest.Mock).mockResolvedValue({ id: "affiliate-1" });
    (couponService.findById as jest.Mock).mockResolvedValue({ id: "coupon-1" });
    (contactCouponRepository.findActiveByCoupon as jest.Mock).mockResolvedValue(null);
    (contactCouponRepository.create as jest.Mock).mockImplementation(async (data) => ({ id: "cc-new", ...data }));
  });

  it("vincula cupom a um afiliado", async () => {
    await service.link(dto);

    expect(contactService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "affiliate-1", type: "AFFILIATED" } }),
    );
    expect(contactCouponRepository.create).toHaveBeenCalledWith(
      { contact_id: "affiliate-1", coupon_id: "coupon-1", commission_rate: 5 },
      { transaction: undefined },
    );
  });

  it("recusa contato que não é afiliado", async () => {
    (contactService.findOne as jest.Mock).mockResolvedValue(null);
    await expect(service.link(dto)).rejects.toThrow("Somente contatos do tipo afiliado");
    expect(contactCouponRepository.create).not.toHaveBeenCalled();
  });

  it("recusa cupom inexistente", async () => {
    (couponService.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.link(dto)).rejects.toThrow("Cupom não encontrado");
  });

  it("recusa segundo dono ativo pro mesmo cupom", async () => {
    (contactCouponRepository.findActiveByCoupon as jest.Mock).mockResolvedValue({ id: "cc-old" });
    await expect(service.link(dto)).rejects.toThrow("Use a transferência");
  });

  it("transferência inativa o dono atual e cria o vínculo novo na mesma transação", async () => {
    (contactCouponRepository.findActiveByCoupon as jest.Mock)
      .mockResolvedValueOnce({ id: "cc-old" })
      .mockResolvedValueOnce(null);

    await service.transfer({ ...dto, contact_id: "affiliate-2" });

    expect(contactCouponRepository.update).toHaveBeenCalledWith(
      "cc-old",
      expect.objectContaining({ active: false, deactivated_at: expect.any(Date) }),
      { transaction: mockTransaction },
    );
    expect(contactCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: "affiliate-2" }),
      { transaction: mockTransaction },
    );
  });
});
