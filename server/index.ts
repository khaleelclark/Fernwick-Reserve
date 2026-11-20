import { buildApp } from './app.js'

const app = buildApp()
const address = await app.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
})
console.log(`Fernwick Reserve is listening at ${address}`)

async function shutdown() {
  try {
    await app.close()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
