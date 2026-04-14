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

app.use('/api/bling-orders/webhook', (req, _res, next) => {
  express.raw({ type: 'application/json' })(req, _res, (err) => {
    if (err) return next(err);
    (req as any).rawBody = req.body instanceof Buffer
      ? req.body.toString('utf8')
      : JSON.stringify(req.body);
    try {
      req.body = JSON.parse((req as any).rawBody);
    } catch {
      req.body = {};
    }
    next();
  });
});

app.use(express.json())
app.use(express.urlencoded({extended: true}))
app.use(cookieParser());

app.get('/health', (_, res) => res.json({status: 'ok'}))

app.use('/api', router)



export default app