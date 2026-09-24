# VeggieTrack Functionality Testing Documentation

## Codebase basis and test setup

This document is derived from the implemented `mobile/` application as inspected on 24 September 2026. It intentionally excludes unimplemented or unreachable features (for example, the registered `HarvestList` route is documented in code as unreachable).

**Technology stack:** Expo SDK 57; React Native 0.86; React Navigation; Supabase (`@supabase/supabase-js`) for email authentication and backend data; SQLite (`expo-sqlite`) and AsyncStorage for local persistence; NetInfo for connection state; Expo Location; Expo Image Picker/camera; Expo Print/Sharing for reports; React Native Web/WebView for web and map surfaces. The app also contains Cloudinary image-upload utilities. Map provider behavior is **TO VERIFY** from the runtime configuration.

Run the UI tests in English, since labels below are the English strings in `src/i18n/translations/en.json`. Use approved accounts for each role and realistic linked test data (harvests, pickups, products, orders, riders) where a test requires it. “TO VERIFY” means the implementation does not fully establish the observable result without a configured backend, external service, permission decision, or target device.

## Login / Authentication

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| AUTH-01 | `Landing` → **Get Started** → `Login` | The **Log In** screen opens. | Tap **Get Started**. |  |  |
| AUTH-02 | `Landing` → **Create an account** → `Register` | The **Create Account** screen opens. | Tap **Create an account**. |  |  |
| AUTH-03 | `Login` → **Continue** | Validation shows “Enter a valid email address.”; no sign-in request is made. | Enter an invalid email and any password, then tap **Continue**. |  |  |
| AUTH-04 | `Login` → **Continue** | Validation shows “Enter your password.”; no sign-in request is made. | Enter a valid email with an empty password, then tap **Continue**. |  |  |
| AUTH-05 | `Login` → **Continue** → `Verify Email` | A valid credential sign-in starts an emailed login OTP flow and opens **Verify Email** for that address. | Enter valid credentials and tap **Continue**. |  |  |
| AUTH-06 | `Login` → **Continue** | The mapped authentication error is shown and the password remains usable for retry. | Use an incorrect password or unavailable backend. |  |  |
| AUTH-07 | `Login` → **Forgot password?** → `Forgot Password` → **Send reset link** | An invalid address is rejected; a valid configured address displays the “reset link sent” message, or a mapped service error. | Test invalid and valid email entries. |  |  |
| AUTH-08 | `Verify Email` → **Verify** | **Verify** remains disabled until all six OTP characters are entered; an empty code produces “Enter the verification code.” if invoked programmatically/accessibly. | Open verification and enter fewer than six digits. |  |  |
| AUTH-09 | `Verify Email` → **Verify** | Correct login OTP refreshes the profile and routes by approved role; correct signup OTP signs out locally and returns to `Login`. Invalid/expired OTP displays a mapped error. | Verify a correct code, then repeat with an invalid/expired code. |  |  |
| AUTH-10 | `Verify Email` → **Resend code** | A successful resend shows a confirmation alert and changes the label to **Resend in 60s**; resend is disabled during the countdown. | Tap **Resend code**, then try again before 60 seconds. |  |  |
| AUTH-11 | `Register` → Farmer/Retailer → **Create account** | Missing name or required location, invalid email, password under 8 characters, or mismatched passwords is rejected. A password-match/mismatch hint appears once confirmation is typed. | Exercise each invalid field combination. |  |  |
| AUTH-12 | `Register` → **Farmer** or **Retailer** → **Pin Map** | The location-pinning modal opens; confirming a pin stores its address and shows “Location pinned.” | Select a Farmer or Retailer role, tap **Pin Map**, and confirm a location. |  |  |
| AUTH-13 | `Register` → **Delivery Personnel** | Location and coordinates are cleared and no farm/store-location field is required. | Choose **Delivery Personnel**, enter name/email/password, and submit. |  |  |
| AUTH-14 | `Register` → **Create account** → `Verify Email` | A successful registration opens **Verify Email** with signup purpose; after valid verification it returns to **Log In**. Backend failures are surfaced in an alert. | Register a new supported role account and verify its OTP. |  |  |
| AUTH-15 | Password-reset deep link → `Reset Password` → **Save new password** | Without a recovery session, the screen instructs the user to open the emailed link. With one, passwords under 8 characters or mismatches are rejected; a valid change signs out and returns to `Login`. | Open reset screen with and without a valid recovery link. |  |  |
| AUTH-16 | Authenticated but unapproved/disabled/error profile → `Application Status` | Appropriate account status/reason is displayed. **Refresh status** retries profile retrieval; when status retrieval fails, title becomes connection problem and button becomes **Try again**. **Log Out** returns to login. | Use unverified, pending, declined/disabled, and connection-failure conditions. |  |  |

## Farmer Module

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| FARM-01 | Approved farmer login → `Farmer Hub` → **Home** | Dashboard presents marketplace/harvest summary, active pickup state, this-week summary, ready-for-pickup list, and role tabs **Home**, **Harvest**, **Messages**, **Pick-up**, **Profile**. Empty states render when no harvests exist. | Sign in as an approved farmer. |  |  |
| FARM-02 | `Farmer Hub` → **Home** → **Add harvest vegetables** → `Add harvest` sheet | Sheet provides vegetable name, quantity, status, harvest-date options, optional **Add photo (optional)**, and **Save harvest**. | Tap **Add harvest vegetables**. |  |  |
| FARM-03 | Add harvest sheet → **Save harvest** | Empty/non-vegetable vegetable name and quantity not greater than zero are rejected with the implemented validation. | Submit with blank name, a non-vegetable name, zero, negative, and nonnumeric quantity. |  |  |
| FARM-04 | Add harvest sheet → **Save harvest** | Valid harvest is added to the farmer’s local list and server queue. Image upload failure shows **Photo upload failed**; the user can retry selecting a photo. | Save a valid Available harvest, then test an upload failure. |  |  |
| FARM-05 | `Farmer Hub` → **Harvest** → harvest row → **Edit** | The edit sheet allows quantity/status updates and **Save** or **Delete**. Harvests pending pickup or already picked up show the lock note and cannot be edited/deleted. | Open both an Available harvest and a pending/picked-up harvest. |  |  |
| FARM-06 | Edit harvest → **Delete** → confirmation | Confirmation names the harvest/quantity; confirming removes the available harvest. Backend failure is shown as an error. | Delete an editable harvest; repeat while backend is unavailable. |  |  |
| FARM-07 | `Farmer Hub` → **Pick-up** | Available harvests can be selected; selected rows show **Selected**, cart count/kg updates, and **Review** opens the **Pick-up request** sheet. | Select one or more available harvests and tap **Review**. |  |  |
| FARM-08 | Pick-up request sheet → **Request pick-up** | With no selected vegetable, the app displays “Select at least one vegetable.” Valid selected harvests create pickup requests, mark harvests `for_pickup`, and show **Pick-up request sent**. | Submit first empty, then with available harvest(s). |  |  |
| FARM-09 | `Farmer Hub` → active pickup → **Track** → `FarmerPickupTracking` | The active pickup tracking screen opens for the selected pickup. With no active pickup, the Home tab states “No active pickups yet.” | Tap **Track** when a pickup exists; test a farmer with none. |  |  |
| FARM-10 | `Farmer Hub` → **Home** → **View Reports** → `Weekly report` sheet | Auto-generated report displays harvest/pickup fields. **Export PDF** exports and **Print** invokes printing/sharing; **View report history** opens week-grouped history. Empty-week message is shown where applicable. | Open report and use Export/Print/history with data and with no weekly data. |  |  |
| FARM-11 | `Farmer Hub` → **Messages** / header notifications | Messages and notifications can be opened/read/refreshed. Service/load behavior is **TO VERIFY** against the configured backend. | Open each tab/icon with unread and empty states. |  |  |
| FARM-12 | Any farmer data screen → pull to refresh | Data refreshes from the backend when reachable; request failures retain saved harvest data rather than clearing it. | Refresh online, then with network disabled after data has been loaded. |  |  |

## Distributor Module

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| DIST-01 | Approved distributor login → `Distributor Hub` | Bottom tabs are **Home**, **Orders**, **Stocks**, **Inventory**, **Profile**. Header/quick actions expose account management, pickup requests, payments, and order work when data exists. | Sign in as an approved distributor. |  |  |
| DIST-02 | `Distributor Hub` → **Orders** → pending order → **Approve** | Order is approved and confirmation says it now needs a delivery-person assignment. Failure displays a friendly error. | Approve a valid pending retailer order, then simulate server failure. |  |  |
| DIST-03 | `Distributor Hub` → **Orders** → pending order → **Reject** | Reject modal requires a reason before it submits cancellation; accepted rejection updates the order list. | Try blank reason, then enter a reason and submit. |  |  |
| DIST-04 | `Distributor Hub` → approved order → delivery-person selector → assign | No selection displays “Select a delivery person first.” A valid selection assigns delivery and reports success. | Test with no rider selected and with a valid delivery-personnel account. |  |  |
| DIST-05 | `Distributor Hub` → **Pickup Requests** → request → assign/receive flow | A delivery person must be selected; valid rider assignment is confirmed and backend errors are displayed. | Test no rider, valid rider, and failing request. |  |  |
| DIST-06 | `Distributor Hub` → **Payments** → order → record payment | Invalid/nonpositive payment is rejected. A valid amount records payment and displays the order/amount confirmation. | Submit blank, zero, negative, nonnumeric, then valid amount. |  |  |
| DIST-07 | `Distributor Hub` → **Stocks** → **Batches** | Received batches are shown; an eligible batch offers **Add to Product List** and **Edit**. Empty state appears when no records exist. | Open Batches with eligible and noneligible batches. |  |  |
| DIST-08 | `Stocks` → batch → **Add to Product List** | Price is required to be valid; successful confirmation lists the batch as a product. | Submit blank/invalid price, then a valid price. |  |  |
| DIST-09 | `Stocks` → header **+** → `Add Product` | Vegetable name, valid price/kg, valid stock/kg, and optional batch photo are accepted; invalid fields are rejected. | Add product with invalid and valid input. |  |  |
| DIST-10 | `Stocks` → **Products** → **View / Edit** | Price/photo changes save; applicable product quantity can be reduced through the implementation’s product edit flow. Upload/service errors are displayed. | Edit a listed product and test invalid price/failed image upload. |  |  |
| DIST-11 | `Distributor Hub` → **Inventory** → `Weekly Report` / history | Inventory report displays implemented columns, supports period/history selection, **Export PDF**, and **Print**. Empty report state is displayed when no inventory exists. | Open report with populated and empty data; export and print. |  |  |
| DIST-12 | `Distributor Hub` → **Account Management** → filter **Pending**, **Active**, **Declined**, **Disabled**, **Unverified** | Selected filter loads matching accounts; refresh reloads the selected status. Backend errors are shown inline. | Change each filter and tap the refresh icon. |  |  |
| DIST-13 | `Account Management` → Pending account → **Approve** / **Decline** | Approve transition works after confirmation. Decline requires an entered reason before confirmation/submission. | Approve one account; attempt decline blank then with reason. |  |  |
| DIST-14 | `Account Management` → Active account → **Disable**; Disabled account → **Turn on** | Disable requires a reason and confirmation. Turn on reactivates an account and UI notes it must sign in again. Unfinished assignments warning remains visible when supplied by API. | Exercise disable blank/valid reason and reactivation. |  |  |

## Delivery Personnel Module

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| DEL-01 | Approved delivery-personnel login → `Delivery Dashboard` | Dashboard contains **Home**, **Tasks**, **History**, **Profile**, delivery/pickup modes, and filters **All**, **Active**, **Completed**, **Cancelled**. | Sign in as approved delivery personnel and switch modes/filters. |  |  |
| DEL-02 | `Delivery Dashboard` → task → **View Details** → `Delivery Details` | The selected assigned order’s delivery detail screen opens; missing delivery record displays its implemented “Missing delivery record” retry message. | Open a valid task and a stale/missing delivery reference. |  |  |
| DEL-03 | `Delivery Dashboard` → task → **Navigate** → `Rider Navigation` | Rider-oriented navigation/map screen opens for the order; runtime map rendering/provider is **TO VERIFY**. | Tap **Navigate** on a task with delivery address data. |  |  |
| DEL-04 | `Delivery Details` → status transition actions | Status update calls are serialized; successful update refreshes order details and backend errors are shown. | Use every status-action button offered for the current delivery state. |  |  |
| DEL-05 | `Delivery Details` → **Mark Delivered** | Delivery proof/location prechecks run before submission. Success reports order delivered; rejected/failed proof, location, or server response displays an error. | Complete with a valid proof and location, then deny/disable required inputs. |  |  |
| DEL-06 | `Delivery Details` → **Reject Delivery** | Reason modal offers **Vehicle breakdown**, **Not available today**, **Personal emergency**, and **Other**. **Other** requires text; successful rejection returns the order for distributor reassignment. | Submit each preset, blank Other, valid Other, and cancel. |  |  |
| DEL-07 | `Delivery Dashboard` → **Farmer Pickups** → **Start Pickup** | Assigned pickup status changes to `otw`; UI refreshes. Errors are displayed. | Start a valid assigned pickup and repeat during backend failure. |  |  |
| DEL-08 | `Delivery Dashboard` → farmer pickup → **Mark as Picked Up** | Camera permission is requested when needed. If denied, alert says camera access is required; valid proof submission marks vegetables picked up and confirms it. | Deny camera permission, then grant it and capture/submit proof. |  |  |
| DEL-09 | `Delivery Dashboard` → **History** | Completed/cancelled delivery and pickup history appears; an appropriate no-history state appears if none. Tapping a historical order opens details; pickup history opens its pickup view. | Test with records and no records. |  |  |
| DEL-10 | Delivery tracking/proof action with location denied/unavailable | Location policy blocks/alerts as implemented rather than silently completing a proof. Exact radius and platform-map behavior are **TO VERIFY** using deployed location policy. | Disable location permission/services and attempt delivery proof. |  |  |

## Retailer Module

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| RET-01 | Approved retailer login → `Retailer Dashboard` → **Home** | Store screen shows product search/listing, stock and price information, and bottom tabs **Home**, **Cart**, **Orders**, **Profile**. | Sign in as retailer. |  |  |
| RET-02 | `Retailer Dashboard` → Home search | Product results filter by the entered search text; clearing restores applicable list. | Search a matching and nonmatching vegetable. |  |  |
| RET-03 | Product card → add (`+`) | In-stock product is added/incremented in cart; out-of-stock item’s add control is disabled. | Add in-stock and try an out-of-stock product. |  |  |
| RET-04 | `Retailer Dashboard` → **Cart** → quantity controls | Minus reduces quantity and removes item at zero; plus cannot exceed available stock and shows the stock-limit alert. Remove icon removes the product. | Exercise all quantity controls and stock ceiling. |  |  |
| RET-05 | Cart below 5 kg → **Place Order** | Minimum-order message “Minimum order is 5 kg in total.” is shown and checkout action is disabled. | Set total cart quantity below 5 kg. |  |  |
| RET-06 | Cart at least 5 kg → **Place Order** → `Checkout` | `OrderConfirmation` shows the order summary, saved addresses (if loaded), delivery date/time fields, **Manage addresses**, and confirmation control. | Add at least 5 kg and tap **Place Order**. |  |  |
| RET-07 | `Checkout` → confirm order | Empty delivery address is rejected; a past date/time is rejected. A valid future schedule and address creates the order, clears persisted cart (or alerts if cart clearing fails), and shows completion before **Go back home**. | Test absent address, past schedule, valid schedule, and API failure. |  |  |
| RET-08 | `Retailer Dashboard` → **Orders** | Current orders show status/total and **View Details**. Pending orders additionally show **Cancel Order**; nonpending orders do not. | Open pending and nonpending order lists. |  |  |
| RET-09 | Pending order → **Cancel Order** → confirmation | Confirmed cancellation calls backend, marks order cancelled locally, refreshes orders/products, and reports success; backend failure shows a friendly error. | Cancel a pending order; repeat with server failure. |  |  |
| RET-10 | Order → **View Details** → `Order Details` | Details show item, address, schedule, status/proof information. Pull-to-refresh reloads; load errors show an alert. | Open an order with and without delivery/proof data and refresh. |  |  |
| RET-11 | `Order Details` → tracking control → `Order Tracking`; Home active order → tracking → `Shopee Tracking` | Selected order’s customer tracking view opens. Map availability/geocoding fallback must be validated per platform (**TO VERIFY**). | Tap each available tracking entry point. |  |  |
| RET-12 | `Retailer Dashboard` → **Orders** → **View History** → `Order History` | Delivered orders older than five days are presented as history; empty state appears when there are none. | Open history with eligible and no eligible orders. |  |  |

## Profile & Settings

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| PROF-01 | Any role dashboard → **Profile** | Profile displays avatar, name, uppercase role, email, **Edit profile**, preferences, role-specific user guide, **Contact Us**, and **Log out**. Retailers additionally see **Manage Addresses**. | Open profile as each role. |  |  |
| PROF-02 | `Profile` → **Edit profile** → `Edit Profile` → **Save Changes** | Blank full name shows required-name error. Valid editable details save via API, update authenticated user state, show saved alert, and return to Profile. | Save blank then valid changes. |  |  |
| PROF-03 | `Edit Profile` → **Pin Map** | Location map modal opens; confirmed address/coordinates are saved with profile changes. Delivery personnel location behavior is role-specific. | Edit farmer/retailer location and save. |  |  |
| PROF-04 | `Edit Profile` → profile picture control | Image selection/upload state prevents saving until ready. Failed upload reports a retryable picture-upload error. | Select a valid image, then simulate/reject upload. |  |  |
| PROF-05 | `Edit Profile` → **Change password** → `Forgot Password` | Known profile email is prefilled; reset-link validation/success/error follow AUTH-07. | Open from profile and submit invalid/valid email. |  |  |
| PROF-06 | Retailer `Profile` → **Manage Addresses** → `My Addresses` | Existing addresses load; real connection/load errors show “check your connection.” | Open with data, no data, and disconnected backend. |  |  |
| PROF-07 | `My Addresses` → **Add New** → `Add Address` → **Save** | Missing label/address are rejected. Valid address, optional pinned location, and default setting save; success alert is shown. | Submit blank label, blank address, then valid entries. |  |  |
| PROF-08 | `My Addresses` → address → **Edit** / **Set Default** / **Delete** | Edit persists changes; Set Default marks only selected address default; Delete requires confirmation then removes it. Server errors are surfaced. | Exercise each action including cancellation and backend failure. |  |  |
| PROF-09 | `Profile` → **Language** | Modal provides **English** and **Tagalog**; selected language is immediately marked and UI changes to selected translations. | Change English → Tagalog → English. |  |  |
| PROF-10 | `Profile` → role user guide / **Contact Us** | Corresponding modal opens and can be closed. Content/recipient delivery, if any, is **TO VERIFY** from its implementation/configuration. | Open and close each modal. |  |  |
| PROF-11 | `Profile` → **Log out** → confirmation | Cancel leaves session unchanged; confirm signs out and returns to authentication entry. | Test both confirmation choices. |  |  |

## Device Compatibility Testing

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| DEV-01 | App launch on Android phone | Portrait UI launches with configured Android app identity, adaptive icon, and screens are usable at narrow/standard phone widths. Android minimum OS/version is **TO VERIFY** from built artifact, not `app.json`. | Install/run Android build on at least one narrow and one standard phone. |  |  |
| DEV-02 | App launch on iPhone | Portrait UI, authentication, tabs, keyboard avoidance, date/time controls, permissions, and maps render/use correctly. iOS deployment target is **TO VERIFY**. | Test on physical/simulator iPhone. |  |  |
| DEV-03 | App launch on iPad | App supports tablets per `app.json`; portrait screens do not clip/overlap and forms remain usable. Landscape is not a required target because orientation is configured portrait. | Test on iPad in portrait. |  |  |
| DEV-04 | `Register` / `Edit Profile` on narrow phone (<380 px) | Password placeholder and location input/Pin Map button remain legible; location controls stack vertically in compact layout. | Test at a width below 380 px. |  |  |
| DEV-05 | Web launch → browser | Web bundle starts; web-specific order-tracking, map, date/time, and address flows render. Browser support matrix is **TO VERIFY**. | Run `expo start --web` and test a current Chromium browser. |  |  |
| DEV-06 | Camera/location flows on Android and iOS | User-facing configured prompts are shown: delivery location verification and delivery proof camera capture. Denial follows DEL-08/DEL-10 behavior without crash. | Test grant, deny, and re-enable permissions. |  |  |

## Performance Testing

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| PERF-01 | Authenticated app foreground/reconnect | Sync coordinator coalesces refresh work, refreshes registered readers, and does not visibly duplicate/overlap destructive actions. Numerical launch/refresh target is **TO VERIFY** (none is encoded). | Foreground/reconnect repeatedly while viewing populated dashboards. |  |  |
| PERF-02 | Signed-in app active for 30+ seconds | Automatic revalidation executes every 30 seconds while active and connected; UI remains responsive. | Observe network/UI over several intervals. |  |  |
| PERF-03 | Farmer harvest add/edit rapidly | Request lock/serialized local queue avoids duplicate queued writes when Save is tapped repeatedly. | Rapidly tap **Save harvest** / **Save** with a valid harvest. |  |  |
| PERF-04 | Retailer checkout / distributor approval / delivery status | Action locks prevent duplicate concurrent submissions; controls show busy/disabled state where implemented. | Rapidly tap confirm/approve/status actions. |  |  |
| PERF-05 | Reports with a representative large dataset | Scrollable reports remain navigable; PDF export/print completes or emits a handled error. Capacity/response-time threshold is **TO VERIFY**. | Load large test datasets and export farmer/distributor reports. |  |  |

## Offline Functionality Testing

| Test Sequence | Navigation / Expected Path | Expected Result | Action | Actual Result | Status |
|---|---|---|---|---|---|
| OFF-01 | Signed-in app → connection disabled | Sync state changes offline. Farmer views show the offline/saved-data banner when using cached harvest data; app does not clear cached list. | Load farmer harvests online, disable network, return/refresh Harvests. |  |  |
| OFF-02 | Farmer add harvest offline → **Save harvest** | Valid add is saved locally as pending, list updates optimistically, and **Saved offline** says it will sync when online. | Disable network and save a valid harvest. |  |  |
| OFF-03 | Farmer edit harvest offline → **Save** | Valid edit is applied to local cache/pending queue and reports offline-save message. | Disable network and edit an available harvest. |  |  |
| OFF-04 | Offline pending harvest queue → connectivity restored | Queue replays oldest first, using add request idempotency key; pending item is replaced with server record and duplicate harvest should not appear. | Queue adds/edits offline, reconnect, wait for sync, then refresh. |  |  |
| OFF-05 | Queue replay with server failure | Replay stops at first failure and retains failed/later mutations for later retry; UI remains usable. | Restore network but force first queued mutation to fail. |  |  |
| OFF-06 | Retailer/distributor/delivery online-only write actions while offline | API error is presented via existing friendly error handling; do not expect a durable local queue because no equivalent queue is implemented for orders, assignments, payments, addresses, or proofs. | Attempt checkout, assign/approve, payment, address save, and proof submission offline. |  |  |
| OFF-07 | App background → foreground while online/offline | On foreground, connectivity is rechecked; online state replays farmer queue/refreshes readers, while offline leaves cache fallback intact. | Background/foreground in both states. |  |  |
