export interface UnitBusinessGroupAttributes {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UnitBusinessGroupCreationAttributes
  extends Omit<UnitBusinessGroupAttributes, "id" | "createdAt" | "updatedAt"> {}

/** Grupo que não pode ser apagado (usado em período de gerente regional): o controller responde 409 com a mensagem. */
export class UnitBusinessGroupInUseError extends Error {}
