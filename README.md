# Fernwick Reserve

A working library reservation demo. Patrons can browse the room calendar, reserve a future room or public PC time, check in for a room, and book room time released after a no-show.

## Start With Docker

From this repository, run:

```sh
docker build -t fernwick-reserve .
docker run --rm -p 127.0.0.1:3000:3000 fernwick-reserve
```

Open [http://localhost:3000](http://localhost:3000). Press **Ctrl+C** in the terminal to stop the app. If port 3000 is in use, publish it with `-p 127.0.0.1:3100:3000` and open port 3100 instead.

## Start With Node

Use Node.js 24 or newer and npm.

```sh
npm ci
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is in use, run `PORT=3100 npm start` and open port 3100.

For development with hot reload, run `npm run dev:api` and `npm run dev` in separate terminals, then open [http://localhost:3001](http://localhost:3001). To use a different API port during development, run `PORT=3100 npm run dev:api` and `RESERVE_API_PORT=3100 npm run dev`.

## Try the Demo

1. **Check In on Time.** The demo starts at 9:55 AM. Start as Maya Chen, whose room reservation starts at 10:00 AM. Advance to the booking start, select **Check In**, then advance to 10:10 AM. The room stays booked.
2. **Release a No-Show.** Reset the demo and advance to 10:10 AM without checking in. The original booking expires. Open **View Available Times** in Maya’s tab. Before claiming a slot, open a second tab, set its patron to Jordan Ellis, and open **Book and Check In** in both tabs.
3. **Try a Stale Claim.** Claim 15 minutes in Maya’s tab. Submit the old choice in Jordan’s tab. Reserve rejects the conflict and refreshes the choices. Open **Staff View** in Maya’s tab to see one no-show released, one release reclaimed, and **15 of 40** minutes recovered.
4. **Make a Future Reservation.** Choose **Room Calendar** or **Public PC Booking**, then select **Reserve Time** on an available 30-minute slot. Public PC reservations use the timeline without the room check-in rule.

**Demo Controls** apply to the shared simulated clock and data. Advancing or resetting in one tab affects the server state for every tab. A tab may keep its previous view until it refreshes or submits an action. The selected patron is a demo identity. Restarting the app resets its fictional data.

## Staff View

Open **Staff View** beside the room agenda. Reset the demo, advance to 10:10 AM, and claim 15 minutes. The counters show one no-show released, one released booking reclaimed, and 15 of 40 room minutes recovered. The total counts time freed after the check-in window ends. Multiple claims on the same release count as one reclaimed booking. Their minutes add up, including after the claims end. Reset clears all three counters. Select **Refresh Availability** to see changes made in another tab.

## Checks and Design Notes

Run `npm test` for the booking rules and API tests. Run `npm run build` to type-check and produce the application. [SPEC.md](SPEC.md) covers the release rules, API, and pilot measures.

The UI uses React, TypeScript, and Rsbuild. Fastify serves the compiled frontend and owns availability, validation, and state. The demo runs as a single local instance with an in-memory store.
