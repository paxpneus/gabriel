import express from 'express'
import router from './config/routes'
import { serverAdapter } from './queues'
import 'dotenv/config'

const bull_board_path = process.env.BULL_BOARD_PATH
const app = express()

app.use(express.json())
app.use(express.urlencoded({extended: true}))

app.get('/health', (_, res) => res.json({status: 'ok'}))
app.use('/api', router)
app.use('/admin/queues/', serverAdapter.getRouter());

export default app