import 'dotenv/config'
import sequelize from './config/sequelize'
import './modules/association/index'
import { startWorkers } from './queues'

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')

    // startWorkers()
}

start()