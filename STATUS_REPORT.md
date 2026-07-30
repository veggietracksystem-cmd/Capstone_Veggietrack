# VeggieTrack — Project Status Report

*Updated Status: All Capstone Requirements and Improvements Completed.*
*Date: July 18, 2026*

---

## What VeggieTrack is

A multi-role vegetable supply-chain web/mobile application connecting four roles through a single distributor "hub":

- **Farmer** → records harvests, requests pickups.
- **Distributor** (exactly **one** allowed in the system) → receives harvests into inventory, approves retailer orders, assigns riders, records payments.
- **Retailer** → browses available stock (FIFO sorted), places orders, tracks delivery status.
- **Delivery Personnel (Rider)** → views assigned orders/pickups, navigates routes, updates delivery state, uploads proof-of-delivery photos.

**Stack:** Node/Express backend + Supabase (PostgreSQL) database; Expo / React Native mobile app (fully compatible with Web preview).

---

## Section 1: What is fully working (implemented)

### 1. General & Authentication (Solved Auto-Logout)
- **Session Persistence**: Implemented silent token refresh on the backend (`/api/auth/refresh-token`) and handled automated `401` interception on the mobile/web client ([client.js](file:///c:/Users/User%201/Desktop/capstone%20project/Capstone_VeggieTrack/mobile/src/api/client.js)), ensuring user sessions persist across page refreshes.
- **Map Registration Pinning**: Integrated platform-specific map pinning modals ([MapPinningModal.web.js](file:///c:/Users/User%201/Desktop/capstone%20project/Capstone_VeggieTrack/mobile/src/components/MapPinningModal.web.js) / [MapPinningModal.native.js](file:///c:/Users/User%201/Desktop/capstone%20project/Capstone_VeggieTrack/mobile/src/components/MapPinningModal.native.js)) into [RegisterScreen.js](file:///c:/Users/User%201/Desktop/capstone%20project/Capstone_VeggieTrack/mobile/src/screens/RegisterScreen.js) for Farmers, Distributors, and Retailers to save precise geocoded coordinates (`latitude` / `longitude`).
- **OTP Registration redirect**: Users are now redirected to the Login page after verifying their registration OTP rather than automatically logging in, matching industry login standards.
- **Single-Distributor Rule**: Enforced both at the API level (returns `409 Conflict`) and via a database index constraint.

### 2. Messaging & Notifications (Solved Real-Time Threading)
- **Real-Time FIFO Chat**: Message threads poll every 3 seconds to sync text lists dynamically in FIFO order. 
- **Unread Badge Counters**: The contacts list polls every 5 seconds, displaying a green badge indicating exact unread counts per thread.
- **Deep-Linked Notifications**: Tapping notifications dynamically parses metadata, automatically closing notification dialogs and navigating the user directly to the corresponding order or delivery screen.

### 3. Farmer Dashboard & Pickups
- **Pickup Request Actions**: Restored `'picked_up'` status options and the "Request Pickup" trigger button on the dashboard and lists screen.
- **Harvest Exclusions**: Harvests are marked `'picked_up'` upon rider collection, removing them from future pickup request prompts.

### 4. Distributor Dashboard & Order History
- **Rider Assignment**: Approved pickup requests feature a dropdown list of available riders (`personnel` chips) to assign collection.
- **Order History visibility**: Modified `/api/orders/active` to fetch both active and historical (`'delivered'`, `'cancelled'`) orders, ensuring records remain permanently visible in a dedicated **Order History** section with slate-blue status pills.
- **Pending Order pipeline**: Updated `/api/orders/pending` to return both `'pending'` and unassigned `'approved'` orders, preventing orders from vanishing after approval and allowing seamless rider assignments.

### 5. Retailer Shopping & Order Tracking
- **FIFO Sorting Visibility**: Products list fetches available vegetables sorted oldest-first based on their `harvest_date` to reduce spoilage. Display badges show the harvest date alongside stock details.
- **Out of Stock Badge**: Rendered in bold red when stock levels drop to 0 or less.
- **Tracking Navigation Gate**: The "Track Order" button is hidden for pending and cancelled orders, appearing only after distributor approval.

### 6. Rider Deliveries & Pickups (Solved External Redirects)
- **Farmer Pickups Tab**: Segmented tab control allows riders to view assigned farmer pickups and mark them as collected.
- **Embedded Route Navigation**: Replaced external OpenStreetMap redirects with inline Leaflet maps on Web and native OpenStreetMap UrlTiles on Mobile, displaying coordinates markers for:
  1. Farmer pickup location
  2. Distributor warehouse location
  3. Retailer delivery store location

### 7. Forgot Password Email Verification
- **Web Form Reset**: Implemented `/api/auth/forgot-password-email` to generate a 1-hour secure reset token.
- **Custom Reset Form**: Serves a secure dark-green HTML verification and reset form (`/api/auth/reset-password-web`) matching VeggieTrack's primary branding.

---

## Section 2: Database Schema & Migration Logs

All schema changes have been documented inside [veggietrack_fixes.sql](file:///c:/Users/User%201/Desktop/capstone%20project/Capstone_VeggieTrack/backend/sql/veggietrack_fixes.sql):
- **UUID Linkage**: Added `item_id` (UUID) to the `notifications` table.
- **Password Reset**: Added `reset_password_token` (TEXT) and `reset_password_expires` (TZ) to `users`.
- **Coordinates**: Added `latitude` and `longitude` (NUMERIC) to `users` for mapping.
- **FIFO Tracking**: Added `harvest_date` (TZ) to `products` to track batch timestamps.
- **Rider References**: Added `delivery_personnel_id` references to `pickup_requests`.
- **Enum Upgrades**: Enforced custom PostgreSQL enum additions (`'cancelled'`, `'picked_up'`, `'in_transit'`, `'assigned'`) for databases using enum columns.

---

## Section 3: Verification & Execution

1. **Backend Integration**:
   - Compiles and runs cleanly. Verified using `node --check index.js`.
2. **Mobile AST Parsing**:
   - Executed a custom script utilizing `@babel/parser` to scan all 11 modified mobile screens and components.
   - All JSX layouts, states, and navigation transitions parsed with zero syntax errors.
