export interface Resource {
  id: string
  name: string
  kind: 'room' | 'computer'
}

export interface Patron {
  id: string
  name: string
}

export interface Booking {
  id: string
  resourceId: string
  patronId: string
  start: number
  end: number
  status: 'reserved' | 'checked-in' | 'expired' | 'complete'
  releasedFrom?: string
}

export interface FutureSlot {
  resourceId: string
  start: number
  end: number
}

export interface ReleasedSlot {
  bookingId: string
  resourceId: string
  start: number
  end: number
  endOptions: number[]
}

export interface ReserveState {
  now: number
  patrons: Patron[]
  resources: Resource[]
  bookings: Booking[]
  futureSlots: FutureSlot[]
  releasedSlots: ReleasedSlot[]
}

export interface ApiError {
  message: string
  state: ReserveState
}
