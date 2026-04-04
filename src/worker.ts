import 'dotenv/config'
import express from 'express'
import sequelize from './config/sequelize'
import { initQueues } from './queues'

const app = express() // necessário só para passar no initQueues

async function start() {
  await sequelize.authenticate()
  initQueues(app)
  console.log('Workers ativos')
}

start()