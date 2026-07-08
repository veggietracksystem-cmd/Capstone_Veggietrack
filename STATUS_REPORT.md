# VeggieTrack — Project Status Report

*Prepared for handoff to a teammate continuing development.*
*Based on a direct review of the code in this repository (backend `index.js`, the mobile `src/` tree, SQL, and config). Date: 2026-06-14.*

---

## What VeggieTrack is

A vegetable supply-chain app connecting four roles through one distributor "hub":

- **Farmer** → records harvests, requests pickups.
- **Distributor** (only **one** allowed) → receives harvests into inventory, approves retailer orders, assigns deliveries, records payments.
- **Retailer** → browses available stock, places orders, tracks delivery.
- **Delivery personnel** → sees assigned orders, advances delivery status, uploads proof of delivery.

**Stack:** Node/Express backend + Supabase (Postgres) database; Expo / React Native mobile app (also runs as a web preview). Auth is **phone + password + OTP**, with JWTs valid for 7 days.

---

## Section 1: What is already working (fully implemented)

### General / Auth
- **Registration** with OTP verification (`/api/auth/register` → `/api/auth/verify-registration`). Password is optional at sign-up; if omitted the account is OTP-only ("legacy" marker).
- **Login** = password check **then** OTP (`/api/auth/login` → `/api/auth/send-otp` → `/api/auth/verify-otp`).
- **Forgot / reset password** via OTP (`/api/auth/forgot-password` → `/api/auth/reset-password`).
- **Change password** in-app, and **profile edit** (name, email, role-specific location field).
- **Delete own account.**
- **JWT auth middleware** on all protected routes, plus **token refresh** (`/api/auth/refresh-token`).
- **OTP security**: 5-minute code expiry; max 5 failed attempts → 15-min lockout (shared across login, registration, reset); send-OTP rate limit (3 per 10 min); 60-second resend cooldown.
- **Single-distributor rule** enforced in the API *and* by a unique DB index.
- Role-based navigation: each role lands on its own dashboard automatically (`App.js`).

### Farmer
- Add / edit / delete harvests; list view (`HarvestListScreen`).
- Weekly harvest report (`/api/harvests/weekly-report`).
- **Request pickup** from distributors (notifies every distributor).

### Distributor
- **Receive pickup requests** → folds the harvest quantity into inventory at a chosen price (creates the product or adds to existing stock).
- Product inventory CRUD (add / edit / delete, with stock + price).
- View **pending**, **active**, and **unpaid** orders.
- **Approve orders** (auto-creates a delivery record).
- **Assign delivery personnel** to approved orders.
- **Record payments** (one per order) and view payment history.
- Weekly business report (revenue, completed orders, current inventory).

### Retailer
- Browse available stock (`/api/products/available`).
- **Place multi-item orders** with stock validation and total calculation.
- View own orders with line items and delivery status.

### Delivery personnel
- See assigned orders.
- Advance status: **picked up → in transit**, mirrored onto the parent order.
- **Complete delivery** with **proof-of-delivery photo** (Cloudinary upload).

### Cross-cutting
- **In-app messaging** (1:1, unread counts, contacts list; farmers restricted to messaging distributors).
- **Notifications** for every key event (pickup, approval, assignment, status change, delivery, payment) with read / read-all.
- **Order tracking** screen with map (separate native/web implementations).
- **Offline-first layer** (SQLite + AsyncStorage caches for harvests/products, queue-and-sync on reconnect, offline banner).
- **SUS survey screen** (usability questionnaire) — present and wired into navigation.
- **Error boundary** wrapping the whole app.

---

## Section 2: Partially working / known rough edges

- **OTP is console-only.** Twilio was removed from the code — the 6-digit code is **printed to the backend terminal**, not texted. Fine for demo; not usable by real end users yet. (The `twilio` package and `TWILIO_*` env vars still linger but are unused — see Section 4.)
- **No order cancel / reject flow.** A distributor can approve but cannot decline; a retailer cannot cancel. Stock is only ever decremented, never restored except inside the create-order rollback.
- **Order-creation stock rollback is "best effort," not atomic.** `POST /api/orders` validates everything first, then writes order → items → decrements stock with manual rollback on failure. If the backend process crashes *mid-loop*, you can be left with partially decremented stock (no real DB transaction). Low risk in demo, real risk at scale.
- **Weekly revenue counts all orders**, including not-yet-delivered ones, since there's no cancellation. Numbers are slightly optimistic.
- **Account enumeration**: login / send-OTP / forgot-password return "No account found," which lets someone probe which phone numbers are registered. Acceptable for a capstone, worth noting.

---

## Section 3: Missing / not yet implemented

- **Real SMS delivery.** Needs a provider wired back into `deliverOtp()` (Twilio code was stripped) **or** a documented decision to stay console-only.
- **In-memory state won't survive restart or scale.** OTP codes, pending registrations, and all rate-limit/cooldown counters live in plain JavaScript `Map`s in `index.js`. They are **wiped on every server restart** and are **not shared across multiple instances**. On a host that sleeps/restarts (e.g. Render free tier), a user mid-OTP can get stranded. Needs Redis or a DB table if deployed seriously.
- **No automated tests.** `backend` test script is a placeholder; there are no unit/integration tests anywhere.
- **No admin role / admin tooling.** (A debug "list all users" route was intentionally disabled for privacy.)
- **Payments are record-keeping only** — no real payment gateway, no partial payments.
- **CORS is wide open** (`app.use(cors())` with no allowlist) — fine for dev, tighten before production.

> Note: features the original template guessed were missing — distributor pickup UI, an always-on offline banner bug — are **not** issues here. The pickup-receive UI exists in `DistributorDashboard.js`, and the banner only renders when actually offline or with pending changes.

---

## Section 4: Immediate next steps (prioritised)

1. **Decide the OTP strategy.** Either (a) keep console-only and clearly label it as demo, or (b) re-integrate an SMS provider in `deliverOtp()`. If staying console-only, **remove the unused `twilio` dependency and `TWILIO_*` vars** so they don't mislead.
2. **Make OTP / rate-limit state restart-safe** *if* you deploy to a host that restarts (move the `Map`s to a DB table or Redis). Skip if you only run locally for the demo.
3. **Add an order cancel / reject flow** with proper stock restoration (and exclude cancelled orders from revenue).
4. **Harden order creation** — ideally move the create-order + stock-decrement into a single Postgres function/transaction (RPC) so it's truly atomic.
5. **Tighten CORS** to your real frontend origin before any public deployment.
6. **(Config) Set up `.env` files** on every machine — see Section 6.
7. **(Nice to have) Add a few backend tests** for the auth and order flows, since those carry the most logic.

---

## Section 5: How to run and test

**Prerequisites:** Node.js installed; a Supabase project with the tables created and the SQL in `backend/sql/veggietrack_fixes.sql` applied.

**1. Backend**
```bash
cd VeggieTrack/backend
npm install
npm start          # runs node index.js → "Server running on port 3000"
```

**2. Mobile (web preview is easiest)**
```bash
cd VeggieTrack/mobile
npm install
npm run web        # opens the Expo web build
# or: npm start  → press w (web), a (Android), i (iOS)
```

**3. Logging in / registering**
- Register or log in from the app. When prompted for the OTP, **look at the backend terminal** — the code is printed there in a box like:
  ```
  ========== OTP for +639... (login) ==========
  CODE: 123456
  ```
- There is **no SMS** — the terminal is the only place the code appears right now.

**Test accounts:** create one of each role. Remember **only one distributor** can exist; a second distributor registration is rejected by design.

---

## Section 6: Environment setup reminders

Two `.env` files are required (both are git-ignored; `.env.example` templates exist for each). Copy the example and fill in real values — **do not commit the real `.env`**.

**`backend/.env`** (see `backend/.env.example`):
- `PORT` (default 3000)
- `NODE_ENV`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY` (service role — keep secret)
- `JWT_SECRET` (long random string)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` *(currently unused — see Section 4)*

**`mobile/.env`** (see `mobile/.env.example`):
- `BACKEND_URL` — your backend URL (e.g. `http://YOUR_LAN_IP:3000` for LAN testing, or the deployed HTTPS URL). Defaults to `http://localhost:3000` if unset.
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_UPLOAD_PRESET` (unsigned preset — needed for proof-of-delivery photo uploads)

**Don't forget `npm install`** in **both** `backend/` and `mobile/` after pulling.

---

## Section 7: Other notes

- **Git:** Repo is on the `main` branch, working tree clean. History is minimal (initial commit + a fix converting `mobile` from a submodule to a normal folder). Standard workflow: `git pull` → make changes → `git commit` → `git push`. Consider feature branches + pull requests so you and your teammate don't collide on `main`.
- **`.gitignore`** already excludes `node_modules/`, all `.env` files, `.expo/`, and `web-build/` — so dependencies and secrets stay out of git.
- **Deployment tips (optional):** backend deploys well to Render/Railway (set the env vars in the dashboard; remember the in-memory OTP caveat from Section 3). The mobile app builds to web (`expo start --web`) or to native via EAS (`eas.json` is present).
- **Database changes** live in `backend/sql/veggietrack_fixes.sql` — run them in the Supabase SQL editor. Most status columns are plain `TEXT`, so new status values need no migration; only enum columns would.

---

*Questions on any section — the backend is a single file (`backend/index.js`, ~1700 lines) and the mobile screens are under `mobile/src/screens/`, so it's quick to trace any feature end to end.*
