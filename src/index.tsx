import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ROOM_CHECK_IN_GRACE_MINUTES, roomCheckInDeadline, summarizeRoomRecovery } from '../shared/reserve'
import type { ApiError, Booking, FutureSlot, ReleasedSlot, ReserveState, Resource } from '../shared/reserve'
import './styles.css'

const statusLabels = {
  reserved: 'Reserved', 'checked-in': 'Checked In', expired: 'Expired', complete: 'Completed',
}

type View = Resource['kind']
type Selection =
  | { kind: 'future'; slot: FutureSlot }
  | { kind: 'released'; slot: ReleasedSlot }

type Notice = { text: string; error?: boolean }

function time(minutes: number) {
  const hour = Math.floor(minutes / 60)
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

function range(start: number, end: number) {
  return `${time(start)}–${time(end)}`
}

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return [hours ? `${hours} hr` : '', remainder ? `${remainder} min` : ''].filter(Boolean).join(' ')
}

function Glyph({ name }: { name: 'brand' | 'room' | 'computer' | 'clock' }) {
  const paths = {
    brand: 'M5 21c3-7 7-12 14-17M8 16c-4-1-5-4-4-8 4 0 7 2 7 5m1-1c-2-4 0-7 4-9 2 3 1 6-2 8m-4 3c4-4 7-4 11-2-2 4-6 6-11 4',
    room: 'M3 8h18v13H3zM7 3v7m10-7v7M3 12h18m4 3h-5m-3 0h-5',
    computer: 'M3 4h18v12H3zM12 16v5m-4 0h8',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

function App() {
  const [state, setState] = useState<ReserveState>()
  const [view, setView] = useState<View>('room')
  const [patron, setPatron] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [selection, setSelection] = useState<Selection>()
  const [end, setEnd] = useState(0)
  const [advanceBy, setAdvanceBy] = useState(5)
  const agenda = useRef<HTMLHeadingElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const recovery = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const pending = useRef(false)

  async function request(path: string, body?: object, success?: string) {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      const response = await fetch(`/api/${path}`, body === undefined ? { cache: 'no-store' } : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const error: ApiError = await response.json()
        if (error.state) setState(error.state)
        setNotice({ text: error.message || 'The reservation service returned an error.', error: true })
        return false
      }
      const next: ReserveState = await response.json()
      setState(next)
      if (success) setNotice({ text: success })
      return true
    } catch {
      setNotice({ text: 'The reservation service could not be reached. Refresh availability before trying again.', error: true })
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  useEffect(() => { void request('state') }, [])
  useEffect(() => {
    if (selection && !dialog.current?.open) dialog.current?.showModal()
    if (!selection && dialog.current?.open) dialog.current.close()
  }, [selection])

  function openBooking(next: Selection, button: HTMLElement) {
    opener.current = button
    setNotice(undefined)
    setEnd(next.kind === 'released' ? next.slot.endOptions[0] : next.slot.end)
    setSelection(next)
  }

  function restoreFocus() {
    setSelection(undefined)
    if (opener.current?.isConnected) opener.current.focus()
    else agenda.current?.focus()
  }

  const patronId = patron || state?.patrons[0]?.id || ''
  const bookingName = (id: string) => state?.resources.find(resource => resource.id === id)?.name ?? id
  const live = state && selection?.kind === 'released'
    ? state.releasedSlots.find(slot => slot.bookingId === selection.slot.bookingId && slot.start === selection.slot.start)
    : undefined
  const future = state && selection?.kind === 'future'
    ? state.futureSlots.find(slot => slot.resourceId === selection.slot.resourceId && slot.start === selection.slot.start && slot.end === selection.slot.end)
    : undefined
  const stale = selection && (selection.kind === 'released' ? !live?.endOptions.includes(end) : !future)

  useEffect(() => {
    if (stale && !busy) recovery.current?.focus()
  }, [stale, busy])

  async function submitBooking() {
    if (!selection || stale) return
    const label = bookingName(selection.slot.resourceId)
    const { start } = selection.slot
    const payload = { patronId, start, end }
    if (selection.kind === 'released') {
      const ok = await request('claim', { ...payload, bookingId: selection.slot.bookingId }, `You’re checked in to ${label} from ${range(start, end)}.`)
      if (ok) setSelection(undefined)
    } else {
      const ok = await request('bookings', { ...payload, resourceId: selection.slot.resourceId }, `${label} is reserved for you from ${range(start, end)}.`)
      if (ok) setSelection(undefined)
    }
  }

  async function checkIn(booking: Booking) {
    const ok = await request('check-in', { patronId, bookingId: booking.id }, `You’re checked in to ${bookingName(booking.resourceId)} until ${time(booking.end)}.`)
    if (ok) agenda.current?.focus()
  }

  function findRoomTimes() {
    setView('room')
    agenda.current?.focus()
  }

  function canCheckIn(booking: Booking) {
    return state && booking.status === 'reserved' && booking.patronId === patronId &&
      state.resources.some(resource => resource.id === booking.resourceId && resource.kind === 'room') &&
      state.now >= booking.start && state.now < roomCheckInDeadline(booking)
  }

  function bookingStatus(booking: Booking) {
    if (canCheckIn(booking)) return 'Check-In Open'
    return statusLabels[booking.status]
  }

  const resources = state?.resources.filter(resource => resource.kind === view) ?? []
  const ownBookings = state?.bookings.filter(booking => booking.patronId === patronId)
    .sort((a, b) => a.start - b.start) ?? []
  const recoveryMetrics = state && summarizeRoomRecovery(state.bookings)
  const expiredBookings = ownBookings.filter(booking => booking.status === 'expired')
  const currentBookings = ownBookings.filter(booking => booking.status === 'reserved' || booking.status === 'checked-in')

  return <>
    <a className="skip-link" href="#main">Skip to Main Content</a>
    <header className="site-header">
      <div className="shell masthead">
        <div className="brand">
          <span className="brand-mark"><Glyph name="brand" /></span>
          <span><strong>Fernwick Reserve</strong><small>Library Reservations</small></span>
        </div>
        {state && <a className="header-time" href="#demo-heading"><Glyph name="clock" /><span>Demo Time<strong>{time(state.now)}</strong></span></a>}
      </div>
    </header>

    <main className="shell" id="main" tabIndex={-1}>
      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">Library Reservations</h1>
        <p>Find a study room or reserve a public computer at the library.</p>
      </section>

      <div className="layout">
        <section className="schedule" aria-labelledby="agenda-heading">
          <nav className="views" aria-label="Resource Type">
            <button type="button" aria-pressed={view === 'room'} onClick={() => setView('room')}><Glyph name="room" /> Room Calendar</button>
            <button type="button" aria-pressed={view === 'computer'} onClick={() => setView('computer')}><Glyph name="computer" /> Public PC Booking</button>
          </nav>
          <div className="schedule-heading">
            <div><h2 id="agenda-heading" ref={agenda} tabIndex={-1}>{view === 'room' ? 'Room Agenda' : 'Computer Agenda'}</h2>
              <p>{view === 'room' ? `Check in within ${ROOM_CHECK_IN_GRACE_MINUTES} minutes of your room booking’s start to keep it.` : 'Select an available time to reserve a computer.'}</p></div>
            <button type="button" className="secondary small" disabled={busy} onClick={() => void request('state', undefined, 'Availability refreshed.')}>Refresh Availability</button>
          </div>
          <div role="status" aria-atomic="true">{!selection && notice && !notice.error && <p className="notice success">{notice.text}</p>}</div>
          <div role="alert" aria-atomic="true">{!selection && notice?.error && <p className="notice error">{notice.text}</p>}</div>
          {!state && !notice?.error && <p role="status" className="empty">Loading availability…</p>}
          {state && !resources.length && <p className="empty">There are no resources of this type.</p>}
          {resources.map(resource => {
            const bookings = state!.bookings.filter(booking => booking.resourceId === resource.id && (booking.status === 'reserved' || booking.status === 'checked-in'))
            const futureSlots = state!.futureSlots.filter(slot => slot.resourceId === resource.id)
            const releasedSlots = state!.releasedSlots.filter(slot => slot.resourceId === resource.id)
            return <section className="resource" key={resource.id} aria-labelledby={`resource-${resource.id}`}>
              <h3 id={`resource-${resource.id}`}><span className="resource-glyph"><Glyph name={resource.kind} /></span>{resource.name}</h3>
              {(releasedSlots.length > 0 || bookings.length > 0) && <ul className="agenda">
                {releasedSlots.map(slot => <li className="released-row" key={slot.bookingId}>
                  <div><strong>{range(slot.start, slot.end)}</strong></div>
                  <span className="badge available">Available Now</span>
                  <div className="row-action">
                    <button type="button" className="primary small" disabled={busy}
                      aria-label={`Book and Check In for ${resource.name}, ${range(slot.start, slot.end)}`}
                      onClick={event => openBooking({ kind: 'released', slot }, event.currentTarget)}>Book and Check In</button>
                  </div>
                </li>)}
                {bookings.map(booking => {
                  const checkInOpen = canCheckIn(booking)
                  return <li key={booking.id}>
                    <div>
                      <strong>{range(booking.start, booking.end)}</strong>
                      {booking.patronId === patronId && <small>Your Reservation</small>}
                      {checkInOpen && <small>Check in before {time(roomCheckInDeadline(booking))}.</small>}
                    </div>
                    <span className={`badge ${checkInOpen ? 'available' : booking.status}`}>{bookingStatus(booking)}</span>
                    {checkInOpen && <div className="row-action">
                      <button type="button" className="primary small" disabled={busy} onClick={() => void checkIn(booking)}>Check In</button>
                    </div>}
                  </li>
                })}
              </ul>}
              <section className="future-times" aria-labelledby={`future-${resource.id}`}>
                <h4 id={`future-${resource.id}`}>Reserve for Later</h4>
                {futureSlots.length === 0 && <p>No future times are available today.</p>}
                {(['Morning', 'Afternoon'] as const).map(group => {
                  const slots = futureSlots.filter(slot => (slot.start < 12 * 60) === (group === 'Morning'))
                  if (slots.length === 0) return null
                  return <div className="time-group" key={group}>
                    <h5>{group}</h5>
                    <ul className="time-grid">
                      {slots.map(slot => <li key={slot.start}>
                        <button type="button" className="time-slot" disabled={busy}
                          aria-label={`Reserve Time for ${resource.name}, ${range(slot.start, slot.end)}`}
                          onClick={event => openBooking({ kind: 'future', slot }, event.currentTarget)}>
                          <strong>{time(slot.start)}</strong>
                          <span>Until {time(slot.end)}</span>
                        </button>
                      </li>)}
                    </ul>
                  </div>
                })}
              </section>
            </section>
          })}
        </section>

        <aside aria-label="Reservations, Demo Controls, and Staff View">
          <section className="side-card" aria-labelledby="reservations-heading">
            <h2 id="reservations-heading">Your Reservations</h2>
            {expiredBookings.map(booking => <div className="expiry" key={booking.id}>
              <h3>Your Booking Expired</h3>
              <p>{bookingName(booking.resourceId)} · {range(booking.start, booking.end)}</p>
              <p>The check-in window ended at {time(roomCheckInDeadline(booking))}.</p>
              <button type="button" className="secondary small" onClick={findRoomTimes}>View Available Times</button>
            </div>)}
            {!currentBookings.length && <p className="side-empty">You have no upcoming or active reservations.</p>}
            <ul className="own-bookings">
              {currentBookings.map(booking => {
                const room = state?.resources.some(resource => resource.id === booking.resourceId && resource.kind === 'room')
                return <li key={booking.id}>
                  <strong>{bookingName(booking.resourceId)}</strong>
                  <p>{range(booking.start, booking.end)}</p>
                  <span className={`badge ${canCheckIn(booking) ? 'available' : booking.status}`}>{bookingStatus(booking)}</span>
                  {room && booking.status === 'reserved' && <p>Check in from {time(booking.start)} to before {time(roomCheckInDeadline(booking))}.</p>}
                  {canCheckIn(booking) && <button type="button" className="primary small" disabled={busy} onClick={() => void checkIn(booking)}>Check In</button>}
                </li>
              })}
            </ul>
          </section>

          <section className="side-card demo" aria-labelledby="demo-heading">
            <h2 id="demo-heading" tabIndex={-1}><Glyph name="clock" /> Demo Controls</h2>
            <p>Switch patrons or advance the demo clock to see how reservations change.</p>
            <label htmlFor="patron">Acting Patron</label>
            <select id="patron" value={patronId} disabled={busy || !state} onChange={event => {
              setPatron(event.target.value)
              setNotice(undefined)
            }}>{state?.patrons.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <label htmlFor="advance">Advance Clock By</label>
            <div className="advance">
              <select id="advance" value={advanceBy} disabled={busy || !state} onChange={event => setAdvanceBy(Number(event.target.value))}>
                {[1, 5, 10, 15, 30, 60].map(minutes => <option value={minutes} key={minutes}>{minutes} {minutes === 1 ? 'Minute' : 'Minutes'}</option>)}
              </select>
              <button type="button" className="secondary small" disabled={busy || !state} onClick={() => void request('demo/advance', { minutes: advanceBy }, 'Demo clock advanced.')}>Advance Clock</button>
            </div>
            <button type="button" className="secondary small reset" disabled={busy || !state} onClick={async () => {
              if (await request('demo/reset', {}, 'Demo reset to its starting reservations.')) {
                setPatron('')
                setAdvanceBy(5)
                setView('room')
              }
            }}>Reset Demo</button>
          </section>

          <details className="side-card staff">
            <summary>Staff View</summary>
            <p>Room recovery for this demo session.</p>
            <div role="status" aria-atomic="true">
              {recoveryMetrics ? <dl className="recovery-metrics">
                <div><dt>No-Show Bookings Released</dt><dd>{recoveryMetrics.releasedBookings}</dd></div>
                <div><dt>Released Bookings Reclaimed</dt><dd>{recoveryMetrics.reclaimedBookings}</dd></div>
                <div><dt>Room Minutes Recovered</dt><dd>{recoveryMetrics.recoveredMinutes} of {recoveryMetrics.releasedMinutes}</dd></div>
              </dl> : <p>Waiting for booking data.</p>}
            </div>
            <p>This compares minutes in new bookings with confirmed check-ins with all minutes freed by no-shows.</p>
          </details>
        </aside>
      </div>
    </main>

    <dialog className="booking-dialog" ref={dialog} aria-labelledby="dialog-heading" onClose={restoreFocus} onCancel={event => { if (pending.current) event.preventDefault() }}>
      {selection && <form onSubmit={event => { event.preventDefault(); void submitBooking() }}>
        <h2 id="dialog-heading">{selection.kind === 'released' ? 'Book and Check In' : 'Reserve Time'}</h2>
        <p className="selected-time">{bookingName(selection.slot.resourceId)} · {range(selection.slot.start, selection.slot.end)}</p>
        {selection.kind === 'released' && <p>Your booking starts immediately and checks you in automatically.</p>}
        <div role="alert" aria-atomic="true">{notice?.error && <p className="notice error">{notice.text}</p>}</div>
        {stale && <p>Close this dialog to choose from the refreshed times.</p>}
        {!stale && selection.kind === 'released' && <>
          <label htmlFor="duration">Duration</label>
          <select id="duration" value={end} disabled={busy} onChange={event => setEnd(Number(event.target.value))}>
            {live?.endOptions.map(option => <option key={option} value={option}>{duration(option - selection.slot.start)} · Until {time(option)}</option>)}
          </select>
        </>}
        <div className="dialog-actions">
          <button ref={recovery} className="secondary" type="button" disabled={busy} onClick={() => setSelection(undefined)}>{stale ? 'View Available Times' : 'Cancel'}</button>
          {!stale && <button className="primary" type="submit" disabled={busy}>{selection.kind === 'released' ? 'Book and Check In' : 'Confirm Reservation'}</button>}
        </div>
      </form>}
    </dialog>
  </>
}

document.documentElement.lang = 'en'
createRoot(document.getElementById('root')!).render(<App />)
