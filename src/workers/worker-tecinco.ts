import 'dotenv/config'
import sequelize from '../config/sequelize'
import { startTecincoWorkers } from '../queues'
import { setupAssociations } from '../config/sequelize-associations'

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')
    console.log(`Versão ativa: ${process.env.APP_VERSION ?? 'unknown'}`)
    setupAssociations()
    startTecincoWorkers()
}

start()
