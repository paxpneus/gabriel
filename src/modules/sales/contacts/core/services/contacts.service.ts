import dayjs from "dayjs";
import { BulkCreateOptions, CreateOptions, CreationAttributes, UpdateOptions } from "sequelize";
import BaseService from "../../../../../shared/utils/base-models/base-service";
import Contact from "../../contacts.model";
import { formatDate, nowTz } from "../../../../../shared/utils/normalizers/date";
import { ContactAttributes, ContactCustomData, SELLER_MANAGER_CONTACT_TYPE } from "../../contacts.types";
import contactRepository, { ContactRepository } from "../repositories/contacts.repository";

type ContactData = Partial<ContactAttributes>;

// Campos que decidem se o contato é gerente com loja/grupo: update que não mexe neles não precisa checar.
const MANAGER_FIELDS = ["type", "unit_business_id", "unit_business_group_id"] as const;

// Gerente (SELLER_MANAGER) sem loja e sem grupo no cadastro é recusado (vira 400 no BaseController).
function assertManagerHasStoreOrGroup(contacts: ContactData[]): void {
  const invalid = contacts.some(
    (contact) => contact.type === SELLER_MANAGER_CONTACT_TYPE && !contact.unit_business_id && !contact.unit_business_group_id,
  );
  if (invalid) throw new Error("Gerente precisa ter uma loja ou um grupo de lojas.");
}

type ManagerPeriods = NonNullable<ContactCustomData["manager_periods"]>;

// Loja/grupo do cadastro que o período aberto do gerente passa a ter.
function managerRef(contact: ContactData) {
  return { unit_business_id: contact.unit_business_id ?? null, unit_business_group_id: contact.unit_business_group_id ?? null };
}

// Hoje/ontem no fuso de SP (datas dos períodos comparam com a data do pedido).
function managerPeriodDates() {
  const now = nowTz();
  return { today: formatDate(now), yesterday: formatDate(now.subtract(1, "day")) };
}

// Junta período que começa no dia seguinte ao fim do anterior com a mesma loja/grupo (ex.: Paraná → Regional 1 → Paraná).
function mergeAdjacentPeriods(periods: ManagerPeriods): ManagerPeriods {
  const sorted = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
  return sorted.reduce<ManagerPeriods>((merged, period) => {
    const previous = merged[merged.length - 1];
    const sameRef =
      previous?.unit_business_id === period.unit_business_id &&
      previous?.unit_business_group_id === period.unit_business_group_id;
    const adjacent = previous?.end_date === dayjs(period.start_date).subtract(1, "day").format("YYYY-MM-DD");
    if (previous && sameRef && adjacent) {
      merged[merged.length - 1] = { ...previous, end_date: period.end_date };
      return merged;
    }
    return [...merged, period];
  }, []);
}

/**
 * Período do gerente segue a loja/grupo do cadastro: fecha o aberto ontem e abre outro hoje com `contact`.
 * Aberto que começou hoje (ou depois) só troca loja/grupo, senão terminaria antes de começar (várias trocas no mesmo dia).
 * Sem loja nem grupo (Bling mandou o vendedor sem loja): só fecha o aberto, sem abrir outro.
 */
function rollManagerPeriods(periods: ManagerPeriods, contact: ContactData): ManagerPeriods {
  const { today, yesterday } = managerPeriodDates();
  const ref = managerRef(contact);
  const hasRef = !!(ref.unit_business_id || ref.unit_business_group_id);
  const open = periods.find((period) => period.end_date === null);
  if (open && open.start_date >= today) {
    // Aberto de hoje sem loja nem grupo some: fechá-lo ontem deixaria fim antes do início.
    if (!hasRef) return periods.filter((period) => period !== open);
    return mergeAdjacentPeriods(periods.map((period) => (period === open ? { ...period, ...ref } : period)));
  }

  const closed = periods.map((period) => (period === open ? { ...period, end_date: yesterday } : period));
  if (!hasRef) return closed;

  // Sem aberto (ex.: voltou a ser gerente): período fechado que vai até hoje ou depois sobreporia o novo.
  const overlapping = periods.find((period) => period !== open && period.end_date !== null && period.end_date >= today);
  if (overlapping) {
    throw new Error(
      `O gerente já tem um período até ${overlapping.end_date}: ajuste os períodos do gerente antes de trocar a loja ou o grupo.`,
    );
  }
  return mergeAdjacentPeriods([...closed, { ...ref, start_date: today, end_date: null }]);
}

/**
 * `custom_data` com o período do gerente rolado quando a mudança pede; null = não mexe nos períodos.
 * Rola: virou gerente sem período aberto, ou trocou loja/grupo — com período aberto, ou sem (desligado) só se `reopenClosed` (tela).
 */
function rolledManagerCustomData(before: ContactData, after: ContactData, reopenClosed: boolean): ContactCustomData | null {
  if (after.type !== SELLER_MANAGER_CONTACT_TYPE) return null;

  const periods = before.custom_data?.manager_periods ?? [];
  const hasOpen = periods.some((period) => period.end_date === null);
  const becameManager = before.type !== SELLER_MANAGER_CONTACT_TYPE;
  const refBefore = managerRef(before);
  const refAfter = managerRef(after);
  // Compara valor, não presença: tela que manda o cadastro inteiro sem mudar loja/grupo não rola.
  const refChanged =
    refBefore.unit_business_id !== refAfter.unit_business_id ||
    refBefore.unit_business_group_id !== refAfter.unit_business_group_id;
  if (!(becameManager && !hasOpen) && !(refChanged && (hasOpen || reopenClosed))) return null;

  return { ...before.custom_data, manager_periods: rollManagerPeriods(periods, after) };
}

// Contato novo já gerente nasce com período aberto de hoje com a loja/grupo do cadastro.
function withNewManagerPeriod<T extends ContactData>(data: T): T {
  if (data.type !== SELLER_MANAGER_CONTACT_TYPE) return data;
  const { today } = managerPeriodDates();
  return { ...data, custom_data: { manager_periods: [{ ...managerRef(data), start_date: today, end_date: null }] } };
}

// CRUD genérico e listagem de contatos; regra de vendedor/gerente fica no domínio sellers/.
export class ContactService extends BaseService<Contact, ContactRepository> {
  constructor() {
    super(contactRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ['created_at', 'name'],
        sortDir: 'DESC',
      },
      searchFields: ['name'],
    };
  }

  // Create/update do CRUD genérico: trava gerente sem loja nem grupo e abre/rola o período dele (sync do Bling grava pelo model, não passa aqui).
  create(data: Partial<ContactAttributes>, options?: CreateOptions) {
    assertManagerHasStoreOrGroup([data]);
    return super.create(withNewManagerPeriod(data), options);
  }

  bulkCreate(datas: CreationAttributes<Contact>[], options?: BulkCreateOptions<Contact>) {
    assertManagerHasStoreOrGroup(datas);
    return super.bulkCreate(datas.map(withNewManagerPeriod), options);
  }

  /** Update do CRUD genérico: gerente com loja/grupo trocado (mesmo desligado) ou que acabou de virar gerente tem o período rolado. */
  async update(id: string, data: Partial<ContactAttributes>, options?: Partial<UpdateOptions>) {
    if (!MANAGER_FIELDS.some((field) => field in data)) return super.update(id, data, options);

    const current = await this.repository.findById(id, { attributes: [...MANAGER_FIELDS, "custom_data"] });
    if (!current) return null;
    const before = current.get() as ContactData;
    const after = { ...before, ...data };
    assertManagerHasStoreOrGroup([after]);

    // Tela: trocar loja/grupo reativa até gerente desligado (quem edita quer ele gerente ali).
    const customData = rolledManagerCustomData(before, after, true);
    if (!customData) return super.update(id, data, options);
    return super.update(id, { ...data, custom_data: customData }, options);
  }

  /**
   * Update vindo da integração (sync do vendedor do Bling): sem a trava de loja/grupo (Bling pode mandar sem loja),
   * mas rola o período do gerente igual à tela (troca de loja fecha a antiga ontem e abre a nova hoje).
   */
  async updateFromIntegration(contact: Contact, data: Partial<ContactAttributes>) {
    const before = contact.get() as ContactData;
    // Bling não reativa gerente desligado: troca de loja de quem já saiu da gerência só atualiza o cadastro.
    const customData = rolledManagerCustomData(before, { ...before, ...data }, false);
    if (!customData) return this.repository.update(contact.id, data);
    return this.repository.update(contact.id, { ...data, custom_data: customData });
  }

  // Bulk só trava (não rola período): troca de loja de gerente em lote não é fluxo da tela.
  async bulkUpdate(data: Partial<ContactAttributes>, options: UpdateOptions) {
    if (MANAGER_FIELDS.some((field) => field in data)) {
      const current = await this.repository.findAll({ where: options.where, attributes: [...MANAGER_FIELDS] });
      assertManagerHasStoreOrGroup(current.map((contact) => ({ ...contact.get(), ...data })));
    }
    return super.bulkUpdate(data, options);
  }
}

export default new ContactService();
