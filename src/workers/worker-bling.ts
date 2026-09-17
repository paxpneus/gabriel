import 'dotenv/config'
import sequelize from '../config/sequelize'
import { startBlingWorkers } from '../queues'
import { setupAssociations } from '../config/sequelize-associations'

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')
    console.log(`Versão ativa: ${process.env.APP_VERSION ?? 'unknown'}`)
    setupAssociations()
    startBlingWorkers()
}

start()
