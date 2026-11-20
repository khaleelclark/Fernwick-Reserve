import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Booking, FutureSlot, Patron, ReleasedSlot, ReserveState, Resource } from '../shared/reserve.js'

const patrons: Patron[] = [
  { id: 'maya', name: 'Maya Chen' },
  { id: 'jordan', name: 'Jordan Ellis' },
]
const resources: Resource[] = [
  { id: 'room', name: 'Study Room', kind: 'room' },
  { id: 'pc-1', name: 'Public PC 1', kind: 'computer' },
  { id: 'pc-2', name: 'Public PC 2', kind: 'computer' },
]
const roomId = resources[0].id

function seed(): Booking[] {
  return [
    { id: 'booking-1', resourceId: roomId, patronId: patrons[0].id, start: 600, end: 650, status: 'reserved' },
    { id: 'booking-2', resourceId: roomId, patronId: patrons[1].id, start: 650, end: 680, status: 'reserved' },
  ]
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>
  }
  return {}
}

export function buildApp({ browserDist = resolve('dist') } = {}) {
  const app = Fastify()
  let now = 595
  let bookings = seed()

  function state(): ReserveState {
    const futureSlots: FutureSlot[] = []
    for (const { id: resourceId } of resources) {
      // Offer 30-minute slots on the half-hour from 10:00 through 17:30.
      for (let start = 600; start < 1080; start += 30) {
        const end = start + 30
        // Keep expired intervals in the room's immediate-claim workflow until they end.
        if (start > now && !bookings.some((booking) =>
          booking.resourceId === resourceId && start < booking.end && end > booking.start
        )) {
          futureSlots.push({ resourceId, start, end })
        }
      }
    }

    const releasedSlots: ReleasedSlot[] = []
    for (const source of bookings) {
      if (source.status !== 'expired' || source.end <= now) continue
      let end = source.end
      for (const booking of bookings) {
        if (booking.resourceId !== source.resourceId || booking.status === 'expired' || booking.end <= now) continue
        // An active claim starts at or before now, so it also suppresses this release.
        end = Math.min(end, booking.start)
      }
      if (end <= now) continue

      const endOptions = []
      for (let option = now + 15; option < end; option += 15) endOptions.push(option)
      endOptions.push(end)
      releasedSlots.push({ bookingId: source.id, resourceId: source.resourceId, start: now, end, endOptions })
    }
    return { now, patrons, resources, bookings, futureSlots, releasedSlots }
  }

  function addBooking(slot: FutureSlot, patronId: string, releasedFrom?: string) {
    bookings.push({
      ...slot,
      id: `booking-${bookings.length + 1}`,
      patronId,
      status: releasedFrom ? 'checked-in' : 'reserved',
      ...(releasedFrom ? { releasedFrom } : {}),
    })
    return state()
  }

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined
    if (typeof statusCode === 'number' && statusCode < 500) {
      return reply.code(statusCode).send({ message: 'Send a valid JSON request.', state: state() })
    }
    return reply.send(error)
  })

  app.get('/api/state', () => state())

  app.post('/api/bookings', (request, reply) => {
    const { patronId, resourceId, start, end } = bodyRecord(request.body)
    const patron = patrons.find(({ id }) => id === patronId)
    if (!patron || !resources.some(({ id }) => id === resourceId) || !Number.isInteger(start) || !Number.isInteger(end)) {
      return reply.code(400).send({ message: 'Choose a valid patron, resource and time.', state: state() })
    }
    const current = state()
    const slot = current.futureSlots.find((slot) =>
      slot.resourceId === resourceId && slot.start === start && slot.end === end
    )
    if (!slot) {
      return reply.code(409).send({ message: 'That time is no longer available. Choose another time.', state: current })
    }
    return addBooking(slot, patron.id)
  })

  app.post('/api/check-in', (request, reply) => {
    const { patronId, bookingId } = bodyRecord(request.body)
    const booking = bookings.find(({ id }) => id === bookingId)
    if (!patrons.some(({ id }) => id === patronId) || typeof bookingId !== 'string') {
      return reply.code(400).send({ message: 'Choose a valid patron and booking.', state: state() })
    }
    if (booking?.resourceId === roomId && booking.patronId === patronId && booking.status === 'expired') {
      return reply.code(409).send({ message: 'Your Booking Expired', state: state() })
    }
    if (!booking || booking.resourceId !== roomId || booking.patronId !== patronId || booking.status !== 'reserved' || booking.start > now) {
      return reply.code(409).send({ message: 'Only the booked patron can check in to a room during its check-in window.', state: state() })
    }
    booking.status = 'checked-in'
    return state()
  })

  app.post('/api/claim', (request, reply) => {
    const { patronId, bookingId, start, end } = bodyRecord(request.body)
    const patron = patrons.find(({ id }) => id === patronId)
    if (!patron || typeof bookingId !== 'string' || typeof end !== 'number' || !Number.isInteger(end) || !Number.isInteger(start)) {
      return reply.code(400).send({ message: 'Choose a valid patron, booking and time.', state: state() })
    }
    const current = state()
    const slot = current.releasedSlots.find((slot) => slot.bookingId === bookingId)
    if (!slot || slot.start !== start || !slot.endOptions.includes(end)) {
      return reply.code(409).send({ message: 'That released time has changed. Choose from the updated availability.', state: current })
    }
    return addBooking({ resourceId: slot.resourceId, start: slot.start, end }, patron.id, slot.bookingId)
  })

  app.post('/api/demo/advance', (request, reply) => {
    const { minutes } = bodyRecord(request.body)
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 1439 - now) {
      return reply.code(400).send({ message: 'Advance by a positive whole number of minutes within the demo day.', state: state() })
    }
    now += minutes
    for (const booking of bookings) {
      if (booking.status === 'reserved' && booking.resourceId === roomId && now >= booking.start + 10) {
        booking.status = 'expired'
      } else if ((booking.status === 'reserved' || booking.status === 'checked-in') && now >= booking.end) {
        booking.status = 'complete'
      }
    }
    return state()
  })

  app.post('/api/demo/reset', () => {
    now = 595
    bookings = seed()
    return state()
  })

  if (existsSync(browserDist)) app.register(fastifyStatic, { root: browserDist })
  return app
}
