import 'dotenv/config'
import app from './app'
import sequelize from './config/sequelize'
import '../src/modules/association/index'

const PORT = process.env.PORT || 3000

async function start(): Promise<void> {
    await sequelize.authenticate()
    console.log('------------------- DB: Banco Conectado! ------------------- ')
    // await sequelize.sync({ alter: true })


    app.listen(PORT, () => {
        console.log(`------------------- SERVER: Rodando em http//localhost:${PORT} ------------------- `)
        })
}

start()