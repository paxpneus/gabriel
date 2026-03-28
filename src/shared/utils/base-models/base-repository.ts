import { Model, ModelStatic, FindOptions, CreateOptions, UpdateOptions, DestroyOptions } from 'sequelize'

class BaseRepository<T extends Model> {
  protected model: ModelStatic<T>

  constructor(model: ModelStatic<T>) {
    this.model = model
  }

  findAll(options?: FindOptions): Promise<T[]> {
    return this.model.findAll(options)
  }

  findOne(options?: FindOptions): Promise<T | null> {
    return this.model.findOne(options)
  }

  findById(id: string, options?: FindOptions): Promise<T | null> {
    return this.model.findByPk(id, options)
  }

  create(
    data: Partial<T['_creationAttributes']>,
    options?: CreateOptions
  ): Promise<T> {
    return this.model.create(data as any, options)
  }

  async update(
    id: string,
    data: Partial<T['_creationAttributes']>,
    options?: UpdateOptions
  ): Promise<T | null> {
    const record = await this.model.findByPk(id, options)
    if (!record) return null
    return record.update(data as any, options)
  }

  async delete(
    id: string,
    options?: DestroyOptions
  ): Promise<boolean> {
    const record = await this.model.findByPk(id, options)
    if (!record) return false
    await record.destroy(options)
    return true
  }
}

export default BaseRepository