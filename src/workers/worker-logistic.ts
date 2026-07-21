import 'dotenv/config'
import sequelize from '../config/sequelize'
import { startLogisticWorkers } from '../queues'
import { setupAssociations } from '../config/sequelize-associations'

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')
    setupAssociations()
    startLogisticWorkers()
}

start()
