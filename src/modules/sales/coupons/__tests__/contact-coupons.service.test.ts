// Vínculo afiliado ↔ cupom: validações do link e transferência de dono.

const mockTransaction = {} as any;

jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
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
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

import sequelize from "../../../../config/sequelize";
import contactService from "../../contacts/contacts.service";
import couponService from "../coupons/coupons.service";
import contactCouponRepository from "../contact-coupons/contact-coupons.repository";
import { ContactCouponService } from "../contact-coupons/contact-coupons.service";

const DTO = { contact_id: "affiliate-1", coupon_id: "coupon-1", commission_rate: 5 };

describe("ContactCouponService", () => {
  let service: ContactCouponService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContactCouponService();
    (sequelize.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockTransaction));
    (contactService.findOne as jest.Mock).mockResolvedValue({ id: "affiliate-1" });
    (couponService.findById as jest.Mock).mockResolvedValue({ id: "coupon-1" });
    (contactCouponRepository.findActiveByCoupon as jest.Mock).mockResolvedValue(null);
    (contactCouponRepository.create as jest.Mock).mockImplementation(async (data: any) => ({
      id: "cc-new",
      ...data,
    }));
  });

  describe("link", () => {
    it("vincula afiliado ao cupom sem dono ativo", async () => {
      const result = await service.link(DTO);

      expect(contactService.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "affiliate-1", type: "AFFILIATED" } }),
      );
      expect(result).toEqual(expect.objectContaining({ id: "cc-new", commission_rate: 5 }));
    });

    it("recusa contato que não é afiliado", async () => {
      (contactService.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.link(DTO)).rejects.toThrow(
        "Somente contatos do tipo afiliado podem ter cupom vinculado",
      );
      expect(contactCouponRepository.create).not.toHaveBeenCalled();
    });

    it("recusa cupom inexistente", async () => {
      (couponService.findById as jest.Mock).mockResolvedValue(null);

      await expect(service.link(DTO)).rejects.toThrow("Cupom não encontrado");
      expect(contactCouponRepository.create).not.toHaveBeenCalled();
    });

    it("recusa segundo dono ativo e sugere transferência", async () => {
      (contactCouponRepository.findActiveByCoupon as jest.Mock).mockResolvedValue({ id: "cc-old" });

      await expect(service.link(DTO)).rejects.toThrow(/transferência/);
      expect(contactCouponRepository.create).not.toHaveBeenCalled();
    });
  });

  describe("transfer", () => {
    it("inativa o dono atual e vincula o novo na mesma transação", async () => {
      (contactCouponRepository.findActiveByCoupon as jest.Mock)
        .mockResolvedValueOnce({ id: "cc-old" })
        .mockResolvedValueOnce(null);
      (contactCouponRepository.findById as jest.Mock).mockResolvedValue({ id: "cc-old", active: true });

      const result = await service.transfer(DTO);

      expect(contactCouponRepository.update).toHaveBeenCalledWith(
        "cc-old",
        { active: false, deactivated_at: expect.any(Date) },
        { transaction: mockTransaction },
      );
      expect(contactCouponRepository.create).toHaveBeenCalledWith(
        { contact_id: "affiliate-1", coupon_id: "coupon-1", commission_rate: 5 },
        { transaction: mockTransaction },
      );
      expect(result).toEqual(expect.objectContaining({ id: "cc-new" }));
    });
  });

  describe("deactivate", () => {
    it("vínculo já inativo: não sobrescreve deactivated_at", async () => {
      (contactCouponRepository.findById as jest.Mock).mockResolvedValue({ id: "cc-old", active: false });

      await service.deactivate("cc-old");

      expect(contactCouponRepository.update).not.toHaveBeenCalled();
    });
  });
});
