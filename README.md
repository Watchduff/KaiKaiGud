# KAIKAIGUD restaurant ordering MVP

A small QR-based ordering app for KAIKAIGUD with a public customer menu and a staff-only kitchen/menu workspace. The supplied KAIKAIGUD logo is used in the header and on the printable menu QR. Customers choose English or Bislama before ordering. Menu categories, item names, and descriptions stay in English; sample beverages include Coke, Sprite, and Fanta. Prices display in whole Vanuatu vatu (VT).

## What it does

- Customers scan the same QR code to open the menu, then choose dine-in (and enter their table number) or take-away.
- Customers can add beverages, meals, and desserts to their order, add optional preferences to meals, and see the total in Vatu.
- Staff orders clearly identify whether each ticket is dine-in (with table number) or take-away.
- Submitting creates an order in the kitchen queue immediately, before the customer pays.
- The receipt is read-only. The server exposes no customer order-edit or cancellation endpoint.
- Customers pay in person at the counter; staff can mark the order paid.
- Staff can move kitchen tickets from queued to preparing to ready, and temporarily mark menu items sold out.
- Staff can add menu items, adjust item details/prices, and change item availability.
- Staff can copy and print one universal menu QR code for every table.
- The kitchen workspace requires the staff username and password configured on the server.

For local development, the starter menu and orders are stored in SQLite in `data/orders.db`. When `DATABASE_URL` is set, the app connects to PostgreSQL (including Neon) instead.

## Run locally

Requires Node.js 20 or newer.

1. Run `npm install`.
2. Run `npm start`. On the first run, the app creates a private `.env` file with a random staff password and prints the password in the terminal. Save it for staff sign-in. Later starts reuse the same `.env` and do not replace your password.
3. Open `http://localhost:3000/`. The staff dashboard is at `http://localhost:3000/staff`; sign in as `owner`, choose **QR kod**, and print the same code for all tables.

Keep the terminal running while using the app. If the browser shows `ERR_CONNECTION_REFUSED`, the server is stopped; run `npm start` again and open the address printed in the terminal. If you want to use another port (for example, to keep using a browser tab on port 3191), set `PORT=3191` in `.env` and restart the server.

## Deploy to Render with Neon

1. Push this project to a GitHub repository you control. In Render, create a **Blueprint** using that repository and approve the `render.yaml` service.
2. In the Render service environment settings, enter `DATABASE_URL` (the newly rotated Neon connection string), `ADMIN_USERNAME`, and a strong `ADMIN_PASSWORD`. These are secrets: never commit them, put them in frontend files, or send them in chat. `COOKIE_SECURE` is already set to `true` in the Render Blueprint.
3. Deploy the service and open its `onrender.com` URL. Confirm the `/health` check succeeds, then sign in at `/staff` and verify the menu and ordering workflow. Print the universal QR only after deployment; its link must be the public Render URL.
4. To preserve this computer's menu and order history, run the one-time migration from the project folder before taking live orders. Put `DATABASE_URL` only in your ignored local `.env` file for the migration, then run `npm run migrate:neon`. The command copies menu items, orders, and their saved meal preferences, and records its successful completion so it will not copy twice. Keep a private backup of `data/orders.db`; do not remove it until the Neon data is verified.

The starter menu uses rounded demo prices in Vatu (for example, VT 1,800 for a grilled chicken bowl and VT 250 for a soft drink); edit these in the staff menu workspace. Before launch, configure your actual menu/prices, test kitchen operations, and set up individual staff accounts rather than sharing the initial owner login.

The customer menu must be reachable for QR ordering; only the staff dashboard and management APIs are restricted to authenticated staff. Payment processing is intentionally not integrated.
