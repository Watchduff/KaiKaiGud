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

## Deploy to Vercel with Neon

The app uses Vercel's Node.js server deployment, with the public assets included in the server bundle. Staff sessions are signed with `SESSION_SECRET`, and login rate limits are stored in PostgreSQL so they work across serverless instances.

1. In Vercel, choose **Add New → Project**, import `Watchduff/KaiKaiGud`, and deploy the `main` branch. Vercel detects the root `server.mjs`; [vercel.json](./vercel.json) includes the public assets used by the server.
2. In the project **Settings → Environment Variables**, add `DATABASE_URL` (the rotated Neon connection string), `ADMIN_USERNAME`, a unique `ADMIN_PASSWORD` of at least 12 characters, and a randomly generated `SESSION_SECRET` of at least 32 characters. Apply them to Production and Preview as desired, then redeploy. Do not commit or share secret values.
3. Open the Vercel deployment URL. Confirm `/health` returns `{"status":"ok"}`, sign in at `/staff`, and verify menu and ordering. The site enforces secure staff cookies on Vercel.
4. The local SQLite menu and order history have already been copied to Neon. Do not run the one-time migration again unless intentionally resetting the migration process. Keep a private backup of `data/orders.db` until you verify the deployed menu and orders.
5. Print the universal QR only after confirming the deployment URL works on a phone using mobile data. The QR code points to the current public app origin.

For local development, `.env` remains private and is ignored by Git. `npm start` uses Neon when `DATABASE_URL` is present; if it is absent, the app uses SQLite.

The starter menu uses rounded demo prices in Vatu (for example, VT 1,800 for a grilled chicken bowl and VT 250 for a soft drink); edit these in the staff menu workspace. Before launch, configure your actual menu/prices, test kitchen operations, and set up individual staff accounts rather than sharing the initial owner login.

Only the staff dashboard and management APIs are restricted to authenticated staff. Payment processing is intentionally not integrated.
