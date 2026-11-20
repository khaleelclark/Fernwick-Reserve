# Fernwick Reserve Demo Spec

## What the Demo Covers

Fernwick Reserve already provides public PC booking and a basic room calendar, as listed in the candidate kit's `pricing.csv`. This demo implements both existing workflows and adds room check-in, automatic release and immediate rebooking. It uses fictional sample patrons and resources.

- **Room Calendar:** Browse existing bookings and reserve an available future slot.
- **Public PC Booking:** Choose a computer and reserve an available future slot. Future room and PC slots use 30-minute sessions on the half-hour from 10:00 AM through 5:30 PM. Room-only check-in and release rules do not apply to PCs.
- **Room Check-In:** The booked patron can check in from the scheduled start until just before the 10-minute deadline. Check-in holds the room through the booking's end.
- **No-Show Release:** At the deadline, an unchecked room booking expires automatically. The original patron sees **Your Booking Expired** and can select **View Available Times**.
- **Book and Check In:** Any patron can claim a currently released interval. The booking starts at the current demo time and is checked in immediately. Show 15-minute duration increments that fit, plus the exact remaining duration when it is not a multiple of 15. Cap choices at the earlier of the original booking end or the next reservation. After a partial claim ends, any remaining released time becomes available again.
- **Conflicts:** Only the first valid claim for overlapping time succeeds. A stale request shows an explanation and refreshed availability. A booking that ends exactly when the next one starts is valid. Future reservations can only start after the current demo time. The room claim path handles immediate use of a released slot.

## Interface

Use the EnvisionWare site's purple and green as the main accents on light surfaces. Use navy from the supplied logo for text and keep the original Fernwick branding. Use title case for headings, navigation, buttons and status labels. Use ordinary sentence case for explanatory sentences. The agenda groups related information, shows exact start and end times, and uses text as well as color for status. Messages announce success and conflicts to assistive technology. The simulated clock, patron switcher and reset live in a separate demo panel.

## Architecture

React and TypeScript with Rsbuild. Fastify validates and owns bookings, time and availability. A single process stores fictional state in memory so browser tabs share the calendar. Clock controls advance the simulation deterministically. Reset restores the initial dataset. The Docker image serves both the compiled UI and API from one port. The README also covers running with Node.

### HTTP Contract

All times are integer minutes after midnight on one simulated day. Successful API responses contain the full state defined in `shared/reserve.ts`. Failed booking actions return an HTTP error with `{ message, state }`. Conflict responses use HTTP 409. A released-slot claim must use the current start and one of the current end options. An outdated start or unavailable end returns the refreshed agenda. Include content-type JSON for POST requests.

| Endpoint | Method | Request |
|---|---|---|
| `/api/state` | GET | No body |
| `/api/bookings` | POST | `{ patronId, resourceId, start, end }` |
| `/api/check-in` | POST | `{ patronId, bookingId }` |
| `/api/claim` | POST | `{ patronId, bookingId, start, end }` where bookingId is the expired source and start is the last observed demo time |
| `/api/demo/advance` | POST | `{ minutes }` |
| `/api/demo/reset` | POST | `{}` |

## Pilot Measures

Staff View shows the session totals for no-show bookings released, distinct releases reclaimed, and released minutes covered by new bookings with confirmed check-ins. Each release counts once as reclaimed even if multiple patrons book portions of it. Totals reset with the demo. Use the first two totals to calculate the share reclaimed. Track confirmed wrongful releases and double bookings, with a target of zero for both. For a rollout funding decision, update the payback model using paid commitments and activation dates.

## Acceptance Scenarios

| Given | When | Then |
| --- | --- | --- |
| The agenda has a free future slot for a room or public PC | A patron reserves the slot | Reserve creates the reservation and removes that interval from availability. |
| A room reservation is scheduled | The booked patron tries before the start, or a different patron tries during the grace period | The server rejects the check-in and preserves the reservation. |
| The booked patron is within the room's check-in window | They check in and the grace period ends | Reserve holds the room through the original end time. |
| A patron has not checked in to a room | The 10-minute deadline arrives | The room releases automatically. The expired reservation offers **View Available Times**. |
| A room was released and remains free | The original patron or another patron selects an available duration and submits **Book and Check In** | Reserve creates a new checked-in reservation starting now. |
| A released slot has 37 minutes left | A patron opens the duration menu | Reserve offers 15, 30 and 37 minutes, with exact end times. If eight minutes remain it offers eight minutes. |
| A patron claims a portion of released time | That claim ends before the original cutoff | The leftover time becomes available until the cutoff, and the next reservation stays intact. |
| Two tabs display the same released time | One tab books it and the other submits its stale choice | Reserve rejects the second claim and displays updated availability. |

Also verify that PC reservations do not use room check-in and release, resetting restores demo data, and the Node and Docker setup commands work. Check keyboard access, status announcements and the layout at a narrow viewport.
