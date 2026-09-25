import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { TEMP_FILE_ENTITY_TYPES, TempFileEntityType } from "../../../shared/constants/temp-file-entity-type";
import { TempFileAttributes, TempFileCreationAttributes } from "./temp-file.types";

class TempFile
  extends Model<TempFileAttributes, TempFileCreationAttributes>
  implements TempFileAttributes
{
  public id!: string;
  public buffer!: Buffer;
  public mime_type!: string;
  public original_filename!: string;
  public upload_directory!: string | null;
  public preserve_filename!: boolean;
  public entity_type!: TempFileEntityType | null;
  public entity_id!: string | null;
  public reconcile_attempts!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TempFile.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    buffer: {
      type: DataTypes.BLOB,
      allowNull: false,
    },
    mime_type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    original_filename: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    upload_directory: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    preserve_filename: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    entity_type: {
      type: DataTypes.ENUM(...TEMP_FILE_ENTITY_TYPES),
      allowNull: true,
    },
    entity_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    reconcile_attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: "temp_files",
    timestamps: true,
    underscored: true,
  },
);

export default TempFile;
