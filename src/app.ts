import express from 'express'
import router from './config/routes'
import 'dotenv/config'
import cors from 'cors'
import cookieParser from 'cookie-parser'
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? []
const app = express()
import crypto from 'crypto'


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

// app.use('/api/bling-orders/webhook', express.raw({ type: 'application/json' }))

// app.post('/api/bling-orders/webhook', (req, res) => {
//   const rawBody = req.body.toString('utf8')

//   const signature = req.headers['x-signature'] as string

//   const expected = crypto
//     .createHmac('sha256', process.env.WEBHOOK_SECRET!)
//     .update(rawBody)
//     .digest('hex')

//   if (expected !== signature) {
//     console.log('❌ HMAC inválido')
//     return res.sendStatus(401)
//   }

//   const parsed = JSON.parse(rawBody)

//   console.log('✅ webhook válido:', parsed)

//   res.sendStatus(200)
// })

app.use(express.json())
app.use(express.urlencoded({extended: true}))
app.use(cookieParser());
app.set("query parser", "extended");

app.get('/health', (_, res) => res.json({status: 'ok'}))

app.use('/api', router)



export default app