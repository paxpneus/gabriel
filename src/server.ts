import 'dotenv/config'
import app from './app'
import sequelize from './config/sequelize'
import { registerQueues, startWorkers } from './queues'
import { setupAssociations } from './config/sequelize-associations'

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0'

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')
    // await sequelize.sync({ alter: true })


    setupAssociations()
    registerQueues(app)

    app.listen(PORT, HOST, () => {
console.log(`Servidor rodando em http://187.50.246.187:${PORT}`);    })
}

start()