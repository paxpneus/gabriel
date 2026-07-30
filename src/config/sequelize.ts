import { Sequelize } from 'sequelize'
import dotenv from 'dotenv'

dotenv.config()

const isTestEnvironment = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID)

const sequelize = new Sequelize(
  isTestEnvironment
    ? {
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false,
      }
    : {
        dialect: 'postgres',
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        database: process.env.DB_NAME,
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        logging: true,
      },
)

export default sequelize