import express from 'express'
import router from './config/routes'
import 'dotenv/config'
import cors from 'cors'
import cookieParser from 'cookie-parser'
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? []
const app = express()


app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS bloqueado para origem: ${origin}`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}))
app.use(express.json())
app.use(express.urlencoded({extended: true}))
app.use(cookieParser());

app.get('/health', (_, res) => res.json({status: 'ok'}))

app.use('/api', router)



export default app