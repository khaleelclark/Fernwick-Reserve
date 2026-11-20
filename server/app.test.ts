import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeRoomRecovery } from '../shared/reserve.js'
import type { ApiError, ReserveState } from '../shared/reserve.js'
import { buildApp } from './app.js'

function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const app = buildApp({ browserDist: 'server/no-browser-build' })
  t.after(() => app.close())

  async function post(path: string, payload: object, code = 200): Promise<ReserveState> {
    const response = await app.inject({ method: 'POST', url: `/api/${path}`, payload })
    assert.equal(response.statusCode, code, response.body)
    if (code < 400) return response.json<ReserveState>()
    const error = response.json<ApiError>()
    assert.ok(error.message)
    return error.state
  }

  return { app, post, advance: (minutes: number) => post('demo/advance', { minutes }) }
}

test('only the booked patron can check in and the room stays occupied until the end', async (t) => {
  const { post, advance } = fixture(t)
  const checkIn = { patronId: 'maya', bookingId: 'booking-1' }
  await post('check-in', checkIn, 409)
  await advance(14)
  await post('check-in', { ...checkIn, patronId: 'jordan' }, 409)
  const checkedIn = await post('check-in', checkIn)
  assert.equal(checkedIn.bookings[0].status, 'checked-in')
  const deadline = await advance(1)
  assert.equal(deadline.bookings[0].status, 'checked-in')
  assert.deepEqual(deadline.releasedSlots, [])
  assert.equal((await advance(40)).bookings[0].status, 'complete')
})

test('expiry at the deadline enables competing claims and the remainder reopens', async (t) => {
  const { post, advance } = fixture(t)
  assert.equal((await advance(14)).bookings[0].status, 'reserved')
  const expired = await advance(1)
  assert.equal(expired.bookings[0].status, 'expired')
  assert.deepEqual(expired.releasedSlots[0].endOptions, [625, 640, 650])
  assert.deepEqual(summarizeRoomRecovery(expired.bookings), { releasedBookings: 1, reclaimedBookings: 0, recoveredMinutes: 0 })
  await post('check-in', { patronId: 'maya', bookingId: 'booking-1' }, 409)
  const request = { bookingId: 'booking-1', start: 610, end: 640 }
  const responses = await Promise.all([
    post('claim', { ...request, patronId: 'jordan' }),
    post('claim', { ...request, patronId: 'maya' }, 409),
  ])
  const claim = responses[0].bookings[2]
  assert.equal(claim.patronId, 'jordan')
  assert.equal(claim.status, 'checked-in')
  assert.equal(claim.releasedFrom, 'booking-1')
  assert.deepEqual(responses[1].releasedSlots, [])
  const remainder = await advance(30)
  assert.deepEqual(remainder.releasedSlots[0].endOptions, [650])
  await post('claim', { ...request, patronId: 'maya', end: 650 }, 409)
  await post('claim', { ...request, patronId: 'maya', start: 640, end: 651 }, 409)
  const atBoundary = await post('claim', { ...request, patronId: 'maya', start: 640, end: 650 })
  assert.equal(atBoundary.bookings[3].end, atBoundary.bookings[1].start)
  const ended = await advance(10)
  assert.equal(ended.bookings[1].status, 'reserved')
  assert.deepEqual(summarizeRoomRecovery(ended.bookings), { releasedBookings: 1, reclaimedBookings: 1, recoveredMinutes: 40 })
  const reset = await post('demo/reset', {})
  assert.deepEqual(summarizeRoomRecovery(reset.bookings), { releasedBookings: 0, reclaimedBookings: 0, recoveredMinutes: 0 })
})

test('future room and PC bookings reject overlaps and reset restores the seed', async (t) => {
  const { app, post, advance } = fixture(t)
  const seed = (await app.inject('/api/state')).json<ReserveState>()
  assert.equal(seed.now, 595)
  assert.equal(seed.resources.length, 3)
  assert.equal(seed.patrons.length, 2)

  const room = { patronId: 'maya', resourceId: 'room', start: 690, end: 720 }
  const pc = { patronId: 'jordan', resourceId: 'pc-1', start: 600, end: 630 }
  await post('bookings', { ...room, start: 630, end: 660 }, 409)
  await post('bookings', { ...room, patronId: 'unauthorized' }, 400)
  await post('bookings', room)
  await post('bookings', room, 409)
  const booked = await post('bookings', pc)
  const pcBooking = booked.bookings[3]
  await advance(15)
  await post('check-in', { patronId: pc.patronId, bookingId: pcBooking.id }, 409)
  const pcActive = await advance(1)
  assert.equal(pcActive.bookings[3].status, 'reserved')
  assert.ok(pcActive.releasedSlots.every(({ resourceId }) => resourceId === 'room'))
  assert.equal((await advance(19)).bookings[3].status, 'complete')
  assert.deepEqual(await post('demo/reset', {}), seed)
})
