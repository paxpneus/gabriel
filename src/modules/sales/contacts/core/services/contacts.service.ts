import dayjs from "dayjs";
import {
  BulkCreateOptions,
  Op,
  CreateOptions,
  CreationAttributes,
  DestroyOptions,
  ForeignKeyConstraintError,
  Transaction,
  UpdateOptions,
} from "sequelize";
import sequelize from "../../../../../config/sequelize";
import BaseService from "../../../../../shared/utils/base-models/base-service";
import Contact from "../../contacts.model";
import { formatDate, nowTz } from "../../../../../shared/utils/normalizers/date";
import { ContactAttributes, ContactCustomData, SELLER_MANAGER_CONTACT_TYPE } from "../../contacts.types";
import contactRepository, { ContactRepository } from "../repositories/contacts.repository";
import { ContactInUseError } from "../helpers/errors";

const IN_USE_PERIODS_MESSAGE =
  "Este contato tem períodos de gerente e não pode ser apagado: o histórico de comissão de gerente dele sumiria.";
const IN_USE_ORDERS_MESSAGE =
  "Este contato tem pedidos ou notas fiscais e não pode ser apagado: o histórico de comissão dele sumiria.";

// FK RESTRICT de pedido/nota (m338) vira erro de negócio; o resto sobe como está.
function rethrowInUse(error: unknown): never {
  if (error instanceof ForeignKeyConstraintError) throw new ContactInUseError(IN_USE_ORDERS_MESSAGE);
  throw error;
}

type ContactData = Partial<ContactAttributes>;

// Campos que decidem se o contato é gerente com loja/grupo: update que não mexe neles não precisa checar nem rolar período.
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
  const open = periods.find((period) => period.end_date === null);
  const hasOpen = !!open;
  const becameManager = before.type !== SELLER_MANAGER_CONTACT_TYPE;
  // Voltou a ser gerente com período aberto antigo: compara com a loja/grupo do período (cadastro pode ter mudado enquanto era SELLER).
  let refBefore = managerRef(before);
  if (becameManager && open) refBefore = managerRef(open);
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

    // Lê e grava travado: sync do Bling (ou outra edição) rolando o período ao mesmo tempo não se sobrescrevem.
    const run = async (transaction: Transaction) => {
      const current = await this.repository.findById(id, {
        attributes: [...MANAGER_FIELDS, "custom_data"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!current) return null;
      const before = current.get() as ContactData;
      const after = { ...before, ...data };
      assertManagerHasStoreOrGroup([after]);

      // Tela: trocar loja/grupo reativa até gerente desligado (quem edita quer ele gerente ali).
      const customData = rolledManagerCustomData(before, after, true);
      if (!customData) return super.update(id, data, { ...options, transaction });
      return super.update(id, { ...data, custom_data: customData }, { ...options, transaction });
    };
    if (options?.transaction) return run(options.transaction);
    return sequelize.transaction(run);
  }

  /**
   * Update vindo da integração (sync do vendedor do Bling): sem a trava de loja/grupo (Bling pode mandar sem loja),
   * mas rola o período do gerente igual à tela (troca de loja fecha a antiga ontem e abre a nova hoje).
   */
  async updateFromIntegration(contact: Contact, data: Partial<ContactAttributes>) {
    // Relê travado (o `contact` do upsert pode estar velho) pra não perder período gravado pela tela no meio.
    return sequelize.transaction(async (transaction) => {
      const current = await this.repository.findById(contact.id, {
        attributes: [...MANAGER_FIELDS, "custom_data"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!current) return null;
      const before = current.get() as ContactData;
      // Bling não reativa gerente desligado: troca de loja de quem já saiu da gerência só atualiza o cadastro.
      const customData = rolledManagerCustomData(before, { ...before, ...data }, false);
      if (!customData) return this.repository.update(contact.id, data, { transaction });
      return this.repository.update(contact.id, { ...data, custom_data: customData }, { transaction });
    });
  }

  /** Bulk com tipo/loja/grupo: mesma trava e rolagem de período do update, contato a contato, numa transação. */
  async bulkUpdate(data: Partial<ContactAttributes>, options: UpdateOptions) {
    if (!MANAGER_FIELDS.some((field) => field in data)) return super.bulkUpdate(data, options);

    // `ids` vem junto no body do BaseController (é o where), não é campo do contato.
    const { ids: _ids, ...fields } = data as Partial<ContactAttributes> & { ids?: string[] };
    return sequelize.transaction(async (transaction): Promise<[number]> => {
      const rows = await this.repository.findAll({
        where: options.where,
        attributes: ["id", ...MANAGER_FIELDS, "custom_data"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const changes = rows.map((row) => {
        const before = row.get() as ContactData;
        return { id: row.id, before, after: { ...before, ...fields } };
      });
      assertManagerHasStoreOrGroup(changes.map((change) => change.after));

      // Uma transação, updates em paralelo (sem await por item).
      await Promise.all(
        changes.map(({ id, before, after }) => {
          const customData = rolledManagerCustomData(before, after, true);
          if (!customData) return this.repository.update(id, fields, { transaction });
          return this.repository.update(id, { ...fields, custom_data: customData }, { transaction });
        }),
      );
      return [rows.length];
    });
  }

  /** Nomes dos gerentes com algum período (vigente ou não) em um dos grupos de lojas: grupo usado no histórico de comissão. */
  async findManagerNamesByPeriodGroups(groupIds: string[]): Promise<string[]> {
    if (!groupIds.length) return [];
    // jsonb @> por grupo (um período com aquele unit_business_group_id), numa query só.
    const managers = await this.repository.findAll({
      where: {
        [Op.or]: groupIds.map((groupId) => ({
          custom_data: { [Op.contains]: { manager_periods: [{ unit_business_group_id: groupId }] } },
        })),
      },
      attributes: ["name"],
    });
    return managers.map((manager) => manager.name);
  }

  /** Recusa apagar contato com período de gerente ou com pedido/nota (FK RESTRICT): sumiria com o histórico de comissão. */
  async delete(id: string, options?: DestroyOptions) {
    const contact = await this.repository.findById(id, { attributes: ["id", "custom_data"], transaction: options?.transaction });
    if (!contact) return false;
    if (contact.custom_data?.manager_periods?.length) throw new ContactInUseError(IN_USE_PERIODS_MESSAGE);
    return super.delete(id, options).catch(rethrowInUse);
  }

  /** Mesma trava do delete pra exclusão em lote: qualquer contato com período ou pedido/nota barra o lote inteiro. */
  async bulkDelete(options: DestroyOptions) {
    const contacts = await this.repository.findAll({
      where: options.where,
      attributes: ["id", "custom_data"],
      transaction: options.transaction,
    });
    if (contacts.some((contact) => contact.custom_data?.manager_periods?.length)) {
      throw new ContactInUseError(IN_USE_PERIODS_MESSAGE);
    }
    return super.bulkDelete(options).catch(rethrowInUse);
  }
}

export default new ContactService();
