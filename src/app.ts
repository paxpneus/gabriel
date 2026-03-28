import express from 'express'
import router from './config/routes'

const app = express()

app.use(express.json())
app.use(express.urlencoded({extended: true}))

app.get('/health', (_, res) => res.json({status: 'ok'}))
app.use('/api', router)

export default app