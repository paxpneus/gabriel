import { TempFileEntityType } from "../../../shared/constants/temp-file-entity-type";

export interface TempFileAttributes {
  id: string;
  buffer: Buffer;
  mime_type: string;
  original_filename: string;
  upload_directory: string | null;
  preserve_filename: boolean;
  entity_type: TempFileEntityType | null;
  entity_id: string | null;
  reconcile_attempts: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TempFileCreationAttributes = Omit<
  TempFileAttributes,
  "id" | "reconcile_attempts" | "createdAt" | "updatedAt"
> & {
  // Default no banco (0) — opcional aqui só pra o sweep poder incrementá-lo via update().
  reconcile_attempts?: number;
};
