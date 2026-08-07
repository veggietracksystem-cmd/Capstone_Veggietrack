# VeggieTrack 🥬

A multi-role vegetable supply-chain application that connects **farmers**, a **distributor**, **retailers**, and **delivery riders** through a single digital hub — from harvest to doorstep.

Built as a capstone project with a Node/Express + Supabase (PostgreSQL) backend and an Expo / React Native frontend that runs on Android, iOS, and Web from one codebase.

---

## How it works

VeggieTrack models a real farm-to-retail supply chain around one central **distributor hub**:

1. **Farmers** log their harvests and request pickups.
2. The **Distributor** (only one account is allowed system-wide) receives pickups into inventory, lists produce for sale, approves retailer orders, and assigns delivery riders.
3. **Retailers** browse available stock (sorted FIFO by harvest date), place orders, and track delivery in real time.
4. **Delivery Personnel** view assigned pickups/deliveries, navigate to locations on a map, update delivery status, and upload proof-of-delivery photos.

Everyone stays in sync through in-app messaging, notifications, and status tracking end-to-end.

## Roles at a glance

| Role | Icon | Core capabilities |
|---|---|---|
| Farmer | 👨‍🌾 | Record harvests, request pickups, view weekly reports |
| Distributor | 🏢 | Manage inventory, approve orders, assign riders, record payments (single account enforced) |
| Retailer | 🛒 | Browse stock, place orders, track deliveries |
| Delivery Personnel | 🛵 | View tasks, navigate routes, update status, upload delivery proof |

## Key features

- **Streamlined auth** — registration and login by phone number + password (no email/OTP), with silent token refresh so sessions persist across restarts.
- **Real-time messaging** — polling-based FIFO chat threads with unread badge counts and deep-linked notifications.
- **Location & mapping** — OpenStreetMap (Nominatim) geocoding search, GPS auto-pinning, and manual map pinning for pickup/delivery addresses.
- **FIFO inventory** — produce listings sorted by harvest date to keep stock rotation accurate.
- **Bilingual UI** — full English and Tagalog translations, including Tagalog vegetable-name validation for harvest/product entry.
- **Offline support** — local caching/queueing (SQLite) for spotty-connectivity field use.
- **PDF reports** — weekly harvest and inventory reports, exportable/shareable from the app.
- **Cross-platform** — one Expo/React Native codebase targeting iOS, Android, and Web.

## Tech stack

**Backend** (`backend/`)
- Node.js + Express 5
- Supabase (PostgreSQL) via `@supabase/supabase-js`
- JWT auth (`jsonwebtoken`) + `bcrypt` password hashing
- Twilio / SMS API PH for SMS
- `date-fns` for date handling

**Mobile / Web** (`mobile/`)
- Expo (SDK 54) + React Native 0.81 + React 19
- React Navigation (stack + bottom tabs)
- `expo-sqlite` + AsyncStorage for offline storage
- `expo-location`, `react-native-maps` for mapping
- `expo-secure-store` for token storage
- Cloudinary for image uploads
- `expo-print` / `expo-sharing` for PDF report generation
- Custom theme (Baloo 2 + Inter fonts, leaf/gold/cream design system)

## Project structure

```
Capstone_VeggieTrack/
├── backend/
│   ├── index.js            # Express app & all API routes
│   ├── lib/                # Shared helpers (e.g. vegetable name validation)
│   ├── config/              # Configuration
│   ├── scripts/              # Maintenance scripts (e.g. Cloudinary cleanup)
│   └── sql/                  # Schema & migration SQL files
└── mobile/
    ├── App.js               # App entry / navigation setup
    └── src/
        ├── api/              # Backend API client
        ├── components/       # Shared UI components
        ├── context/          # Auth context
        ├── i18n/             # English & Tagalog translations
        ├── lib/              # Client-side helpers (vegetables, PDF, etc.)
        ├── offline/          # Local cache / SQLite queueing
        ├── screens/          # Role dashboards & app screens
        └── theme/            # App theme (colors, typography)
```

## Getting started

### Prerequisites
- Node.js (LTS)
- A [Supabase](https://supabase.com) project
- [Expo CLI](https://docs.expo.dev/) (`npx expo`) — no global install required
- (Optional) Cloudinary account for image uploads, Twilio/SMS API PH for SMS

### 1. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `backend/.env`:

```
PORT=3000
NODE_ENV=development
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_role_key
JWT_SECRET=replace_with_a_long_random_string
SMS_API_PH_KEY=your_sms_api_ph_key
```

Run the SQL files in `backend/sql/` (starting with `schema_complete.sql`, then the incremental fix/migration files) against your Supabase database, then start the server:

```bash
npm run dev
```

### 2. Mobile / Web setup

```bash
cd mobile
npm install
cp .env.example .env
```

Fill in `mobile/.env`:

```
BACKEND_URL=http://YOUR_LAN_IP:3000   # or your deployed backend URL
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_UPLOAD_PRESET=your_unsigned_preset
```

Then run the app:

```bash
npm start        # Expo dev server (scan QR with Expo Go)
npm run android  # Android emulator/device
npm run ios      # iOS simulator/device
npm run web      # Web browser preview
```

## Deployment

- **Backend**: deployable to any Node host (e.g. Render) — set the environment variables above in the hosting dashboard.
- **Mobile**: built/distributed via [EAS](https://docs.expo.dev/eas/) (see `mobile/eas.json`); point `BACKEND_URL` at the deployed backend before building.

## Status

See [STATUS_REPORT.md](STATUS_REPORT.md) for the latest detailed changelog of completed features and fixes.
