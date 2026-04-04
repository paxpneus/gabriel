import 'dotenv/config'
import app from './app'
import sequelize from './config/sequelize'
import '../src/modules/association/index'
import { initQueues } from './queues'

const PORT = process.env.PORT || 3000

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')
    // await sequelize.sync({ alter: true })

    initQueues(app)

    app.listen(PORT, () => {
        console.log(`------------------- SERVER: Rodando em http//localhost:${PORT} ------------------- `)
        })
}

start()