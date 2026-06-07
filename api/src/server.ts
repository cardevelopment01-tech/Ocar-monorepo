import { config } from './config'
import { createApp } from './app'
import { testConnection, pool } from './db/client'
import { testConnection as testRedis, client as redisClient } from './db/redis'

async function start(): Promise<void> {
  const dbOk = await testConnection()
  if (!dbOk) {
    console.error('ERROR: Could not connect to database. Exiting.')
    process.exit(1)
  }
  console.log('Database connected')

  const redisOk = await testRedis()
  if (!redisOk) {
    console.error('ERROR: Could not connect to Redis. Exiting.')
    process.exit(1)
  }

  const app = createApp()

  const server = app.listen(config.API_PORT, () => {
    console.log(
      `Server running on port ${config.API_PORT} [${config.NODE_ENV}]`
    )
  })

  async function shutdown(): Promise<void> {
    console.log('Shutting down gracefully...')
    server.close(async () => {
      await pool.end()
      redisClient.disconnect()
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
