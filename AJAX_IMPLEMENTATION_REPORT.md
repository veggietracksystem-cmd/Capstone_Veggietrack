# Asynchronous UI implementation report

Reviewed and implemented September 16, 2026.

## Scope and findings

The four business modules are **Farmer**, **Distributor**, **Retailer**, and **Rider** (`delivery_personnel`), all in `mobile/`. `mobile/App.js` registers their screens. `VeggieTrack-Clean/` is a separate Expo starter, not a fifth business module.

The application already uses React state, asynchronous `fetch` through `src/api/client.js`, and Supabase Auth. CRUD forms do not perform browser form submissions. The only explicit browser reload found is the crash recovery button in `ErrorBoundary.js`. Therefore, this change strengthens the existing asynchronous architecture instead of adding another AJAX library or duplicating endpoints.

## Screen inventory and changes

| Module | Screens / sections | Result |
| --- | --- | --- |
| Farmer | `FarmerDashboard`: Home, Harvest, Add/Edit sheets, Pickup cart, Weekly Report, History | Synchronous submission locks; outdated reads ignored; partial pickup successes removed from the cart; report history refreshed each time it opens; failed weekly refresh retains data; refresh feedback clears in `finally`. |
| Farmer | `HarvestListScreen` | Refresh on return without losing search; delete and pickup locks; confirmed pickup updates the harvest status through the existing offline/status workflow. |
| Farmer | Embedded Messages, Notifications, `FarmerProfileTab` | Shared message/notification fixes below; profile tab already reads shared auth state and navigates normally. |
| Distributor | `DistributorDashboard`: Home/product editor, Orders, Pickups, Payments | Locks for approval, rejection, rider assignment, payment, pickup assignment, price/quantity/unlist actions; latest-read protection; rejection reason retained on failure; home refresh includes products and counts; return-to-screen refresh; product editor refreshes without remounting. |
| Distributor | `ProductListScreen` | Existing asynchronous price, quantity and unlist actions now mutually locked; category remains selected; refresh on return; outdated responses ignored. |
| Distributor | `StocksScreen` | Stock listing locked and updates its row; failed listing retains price dialog/input; latest-read protection; refresh on return. |
| Distributor | `DistributorInventoryReportScreen` | Refresh on return and outdated-read protection; current Inventory/History selection preserved. PDF export remains unchanged. |
| Distributor | `AccountManagementScreen` | Existing asynchronous approval/decline/disable/reactivate and status-version checks retained; loading feedback for filtering/refresh and disabled audit-loading button added. |
| Retailer | `RetailerDashboard`: Marketplace, Cart, Orders | Refresh on return while preserving cart/search/category/tab; latest-read protection; cancellation lock and disabled cancellation buttons; confirmed cancellation updates the order and refreshes stock. |
| Retailer | `OrderConfirmationScreen` | Synchronous checkout lock supplements existing validation and disabled button; success state prevents another submission; cart still clears only after confirmed order creation. |
| Retailer | `OrderHistoryScreen` | Refresh on return; stale response protection; visible load errors retain the previous list. |
| Retailer / Distributor | `OrderDetailsScreen` | Uses existing authorized `GET /api/orders/:id` on open/return and pull-to-refresh instead of relying only on a navigation snapshot; retains details during refresh. |
| Rider | `DeliveryDashboard`: Home, Tasks, History, Deliveries/Pickups | Preserves selected tab/mode on return; refreshes both assignment lists; guards pickup completion; updates the confirmed pickup locally; restores the missing `renderPickupCard` used by all three sections. The missing function previously caused a runtime failure when pickups existed. |
| Rider | `DeliveryDetailsScreen`, `delivery/RiderNavigationScreen` | Reviewed and retained existing asynchronous status/rejection/POD operations, request locks, GPS, loading/error feedback, and tracking. No replacement of the established proof workflow. |
| Retailer / Distributor / Rider | `OrderTrackingScreen.native.js`, `OrderTrackingScreen.web.js`, `Retailer/ShopeeTrackingScreen.js`, `CustomerDeliveryTrackingScreen` | Reviewed: wrappers reuse the existing polling/tracking hooks and incremental map updates. Already asynchronous; unchanged. |
| Shared | `ManageAddressesScreen` | Save/delete/default operations locked; buttons disabled and progress shown; saved/deleted rows updated locally; latest-read guard retains the current list on request failure. |
| Shared | `EditProfileScreen` | Synchronous save lock; existing photo upload validation and shared profile update retained. |
| Shared | `MessagesScreen` | Send lock; a late response cannot append to a different conversation; old polls cannot overwrite a newly confirmed message; deduplicated message insertion; edits typed during send retained. |
| Shared | `NotificationBell` including Farmer Notifications | Mark-read/all serialized; changes applied after confirmation; outdated polls ignored; failed operations no longer restore a stale whole-list snapshot. |
| Shared | `LandingScreen`, `LoginScreen`, `RegisterScreen`, `PhoneOtpScreen`, `ForgotPasswordScreen`, `ChangePhoneScreen`, `ApplicationStatusScreen`, `ProfileScreen`, `FarmerProfileTab` | Existing navigation, Supabase requests, auth locks, profile state, and status checks retained. No traditional form reload to convert. |

Search, filtering and sorting that already operate on in-memory collections remain local and immediate. No server-pagination controls were found to convert. Navigation between major screens remains React Navigation. No API, role, database schema, validation rule, or security policy was changed.

## Shared implementation

- `useRequestLock` acquires a synchronous lock before React renders a disabled button.
- `useLatestRequest` gives each loader a generation ticket, ignores superseded responses, and invalidates tickets on unmount.
- `useRefreshOnFocus` refreshes mounted lists without resetting screen state.
- The existing farmer offline queue serializes enqueue/replay operations so overlapping focus/reconnect/manual sync cannot replay the same queued entry concurrently or overwrite a new queued mutation.
- Existing API cancellation, timeout, authenticated token provider, unauthorized and blocked-account handling are retained.

## Files changed for this task

All screen paths below are under `mobile/src/screens/`:

`AccountManagementScreen.js`, `DeliveryDashboard.js`, `DistributorDashboard.js`, `DistributorInventoryReportScreen.js`, `EditProfileScreen.js`, `FarmerDashboard.js`, `HarvestListScreen.js`, `ManageAddressesScreen.js`, `MessagesScreen.js`, `OrderConfirmationScreen.js`, `OrderDetailsScreen.js`, `OrderHistoryScreen.js`, `ProductListScreen.js`, `RetailerDashboard.js`, `StocksScreen.js`.

Other implementation files:

- `mobile/src/components/NotificationBell.js`
- `mobile/src/hooks/useLatestRequest.js` (new)
- `mobile/src/hooks/useRequestLock.js` (new)
- `mobile/src/hooks/useRefreshOnFocus.js` (new)
- `mobile/src/lib/requestLock.js` (new)
- `mobile/src/offline/harvestStore.js`

Verification/documentation:

- `backend/test/ajaxMobile.test.js` (new)
- `backend/test/userAvatarsMobile.test.js` (test loader now resolves the actual shared hook)
- `AJAX_IMPLEMENTATION_REPORT.md`

Pre-existing unrelated working-tree changes were preserved.

## Verification

- `npm test --prefix backend`: **116 passed, 0 failed**, including 10 new asynchronous UI regressions. Includes Auth/ownership/roles, minimum-order/FIFO checkout, cross-role farmer-to-distributor-to-retailer workflow, delivery status/POD/security, local PostgreSQL migration tests, and avatar tests.
- New tests execute actual screen handlers with controlled delayed requests: double taps, failure retention, local order updates, rider completion refresh, message-thread switching, pickup-card rendering, and serialized offline queue replay. Shared lock and stale-read/unmount behavior are also tested.
- Expo production export: Web, Android and iOS/Hermes bundles passed. Native compiler initially could not execute inside the sandbox; the authorized rerun succeeded.
- Separate starter: `npm run lint` and `npx --no-install tsc --noEmit` passed.
- Main mobile has no configured lint or typecheck script. Supplemental ESLint checks for undefined identifiers and duplicate object keys passed across 36 screen/helper files. Existing inline lint directives were disabled for this limited check.
- `node --check backend/index.js` and `git diff --check` passed. The backend suite also compiles all mobile modules with the installed Expo Babel preset.

## Intentionally unchanged and remaining verification

The crash-recovery reload, normal navigation, print/share/export flows, local cart interactions, and already-asynchronous authentication/tracking flows remain intact. They do not benefit from another network request.

Automated tests use controlled APIs and local PostgreSQL. No authenticated end-to-end browser/device session against the hosted service was performed, and no hosted database writes or deployment were made. Therefore, this report does not claim that all live screens were manually tested or that live console/server logs are error-free. Native bundling is not a signed native release or real GPS/camera test.

Before release, smoke-test the four roles against a configured test environment: harvest add/edit/delete and partial pickups; pickup assignment/completion and stock listing; price/quantity/unlist; checkout/cancel and address CRUD/default; order approval/rejection/assignment/payment; rider delivery/POD; account transitions; messages/notifications. Keep a search/filter selected while refreshing and navigating back. Repeat taps and force one network failure per form to confirm retained input and retry behavior. Existing hosted delivery migration prerequisites described in the repository README still apply.
