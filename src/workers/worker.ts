import 'dotenv/config'
import sequelize from '../config/sequelize'
import { startWorkers } from '../queues'
import { setupAssociations } from '../config/sequelize-associations'
import { startHealthServer } from './health-server'

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')
    setupAssociations()
    startWorkers()
    startHealthServer()
}

start()
