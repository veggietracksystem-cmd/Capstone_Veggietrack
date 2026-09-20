# VeggieTrack — Wireframe Descriptions

Screen-by-screen explanation of the low-fidelity wireframes in [`wireframes.html`](wireframes.html).
Numbering matches the screen numbers printed above each phone frame (01–45).

---

## Auth & Onboarding

Unauthenticated flow — everything a user sees before logging in, or while their account is still awaiting approval.

**01 — Landing.**
The Landing screen is the first thing a user sees when the app opens and no session is active. It presents only the VeggieTrack logo, a one-line description of the system, and two calls to action, so the entry point stays uncluttered for first-time users. A primary "Get Started" button leads to Login, while a secondary "Create an account" link goes directly to Register. The screen carries no navigation header because there is nothing to go back to. Its purpose is purely to route the user into the correct branch of the authentication flow.

**02 — Login.**
The Login screen authenticates an existing user through their registered email address and password. It contains two text inputs, a primary "Log In" button, and a "Forgot Password?" link for users who cannot recall their credentials. A secondary link at the bottom sends new users to Register, keeping both paths reachable from one place. On successful login the app checks the account's role and approval status, then redirects the user to the matching role dashboard. Accounts that are not yet approved are sent to the Application Status screen instead.

**03 — Register.**
The Register screen collects everything required to create a new VeggieTrack account in a single form. It asks for full name, email, password, and password confirmation, then requires the user to choose one role from Farmer, Distributor, Retailer, or Delivery. Because the system is location-based, the form also captures a farm, shop, or home address together with a map pin so that pickups and deliveries can be routed later. Submitting the form creates the account in a pending state and sends a verification email rather than logging the user straight in. A link at the bottom returns users who already have an account to Login.

**04 — Verify Email.**
The Verify Email screen appears immediately after registration, while the account exists but the email address is still unconfirmed. It displays an envelope illustration and a short message telling the user that a verification link has been sent to the address they supplied. An "I've verified, Continue" button re-checks the verification state, and a "Resend email" link covers the case where the message never arrived or expired. The screen deliberately has no back button, because the user cannot proceed into the app until verification succeeds. It exists to guarantee that every account is tied to a reachable email address.

**05 — Forgot Password.**
The Forgot Password screen begins account recovery for users who can no longer log in. It shows a brief instruction, a single email input, and a "Send Reset Link" button that dispatches a reset email to the address on file. A "Back to Login" link lets the user abandon recovery without relying on the device back gesture. No information is revealed about whether the email exists, so the screen cannot be used to discover registered accounts. It is reachable only from Login, since the user is by definition unauthenticated at this point.

**06 — Reset Password.**
The Reset Password screen is the second half of account recovery and is opened from the link inside the reset email. It presents two inputs — a new password and a confirmation — so typing mistakes are caught before the change is committed. A single primary "Reset Password" button applies the change and returns the user to Login to sign in with the new credentials. The screen validates that both fields match and that the password meets the same minimum length used at registration. Because it depends on a one-time token, it is not reachable through normal in-app navigation.

**07 — Application Status.**
The Application Status screen is a holding screen for verified users whose role account has not yet been approved by a distributor or administrator. It shows a pending icon, the label "Pending Approval," and a short explanation that the account is under review. The only available action is "Log Out," which prevents an unapproved user from reaching any role dashboard. Once approval is granted, the user is routed to their role's home screen on the next login. This screen enforces the vetting step that keeps unverified farmers, retailers, and riders out of the supply chain.

---

## Shared Screens

Reachable from any logged-in role through the header or profile menu, regardless of which dashboard the user came from.

**08 — Profile.**
The Profile screen is the common account hub available to every logged-in role. It displays the user's avatar, name, and role at the top, followed by a stacked list of navigation cards. From here the user can reach Edit Profile, Manage Addresses, Change Password, and — for distributors only — Account Management. A red "Log Out" action sits at the bottom so it is always reachable but visually separated from the safe options. The screen itself contains no editable fields; it exists purely as a menu for account-related tasks.

**09 — Edit Profile.**
The Edit Profile screen lets a user update the personal details stored on their account. It shows the current avatar with a camera affordance for replacing the photo, followed by editable Name and Phone fields. The Email field is displayed but read-only, because the address is the account's identity and is changed only through re-verification. A primary "Save Changes" button commits the edits, while a "Disable Account" action at the bottom lets the user deactivate their own account. Keeping that destructive action separated at the bottom reduces the risk of an accidental tap.

**10 — Messages — List.**
The Messages list is the inbox shared by all roles and shows every conversation the user is part of. A search field at the top filters conversations by participant name, which matters once a distributor is coordinating with many farmers and riders. Each row is a card showing the other party's avatar, their name, a preview of the latest message, and an unread-count badge. Tapping a row opens the corresponding Messages Thread. This screen gives the supply chain a single communication channel instead of relying on outside apps.

**11 — Messages — Thread.**
The Messages Thread screen is the one-to-one chat view between the logged-in user and one other participant. Incoming messages are aligned to the left and the user's own messages to the right, following the convention users already know from mainstream chat apps. The header shows the other participant's name and a back control that returns to the Messages list. A composer pinned to the bottom pairs a text input with a send button so the keyboard never covers the message being typed. It is used for coordination such as confirming pickup times or reporting a delivery problem.

**12 — Manage Addresses.**
The Manage Addresses screen stores the pickup and delivery locations attached to a user's account. Existing addresses appear as cards with a label, the full address text, and chip actions for Set Default, Edit, and Delete. Below the list, an "Add New Address" section collects a label, the street/city/province text, and latitude and longitude values that can be filled automatically using a map pin control. A checkbox marks the new entry as the default address used at checkout. Because routing and delivery tracking both depend on coordinates, this screen is what makes map-based delivery possible.

**13 — Order Tracking (Map).**
The Order Tracking screen is the shared map view of a delivery that is currently in progress. A large map occupies the upper portion of the screen and draws the live route from the warehouse or distributor to the destination. Beneath it, a card identifies the assigned rider and shows a status badge such as "On the way." A summarised list of the order's items sits at the bottom so the viewer can confirm which shipment they are watching. The same screen serves farmers watching a pickup and retailers watching a delivery, with only the endpoints differing.

**14 — Account Management (Distributor).**
The Account Management screen is the approval console available only to distributor accounts. It lists the user accounts tied to that distributor — retailers and riders — each on a card with a status badge such as Pending or Active. For pending accounts the card exposes a reason input plus "Approve" and "Reject" buttons, and the reason text is shown to the affected user so a rejection is never unexplained. Approving an account moves that user off the Application Status screen and into their role dashboard. This screen is the control point that keeps the network limited to verified participants.

---

## Farmer Role

Bottom tabs: Home · Harvest · Messages · Pickup · Profile — plus sub-screens pushed on top of the tab navigator.

**15 — Farmer — Home.**
The Farmer Home screen is the landing tab after a farmer logs in and gives an at-a-glance summary of their activity. Two summary cards at the top count pending harvests and harvests that are ready for pickup, so the farmer immediately knows whether action is needed. A "Your pickup tracking" section links straight into the live tracking screen for any pickup already requested. Below that, a Recent Harvests list shows the latest submissions with Approved or Pending badges. A notification icon in the header opens the Notifications screen.

**16 — Farmer — Harvest Tab.**
The Harvest tab is where a farmer records produce that is ready to enter the supply chain. A short form at the top takes the vegetable name and a quantity with a unit selector, submitted with an "Add Harvest" button. Underneath, a "Submitted Harvests" list shows each previous entry with its approval badge, so the farmer can see what the distributor has accepted. Entries that are still pending expose Edit and Delete chips, while approved entries are locked to preserve the record. This is the farmer's primary data-entry screen and the origin point of every batch tracked by the system.

**17 — Farmer — Messages Tab.**
The Farmer Messages tab embeds the shared conversation inbox directly into the farmer's bottom navigation. It shows the same searchable list of conversation cards as the shared Messages screen, with avatar, name, and message preview on each row. Because it is a tab rather than a pushed screen, the header has no back control and the tab bar stays visible. Tapping a conversation opens the Messages Thread on top of the tab navigator. Giving messages a dedicated tab reflects how often farmers need to coordinate with distributors and riders.

**18 — Farmer — Pickup Tab.**
The Pickup tab lets a farmer bundle approved harvests into a single pickup request. Each approved harvest appears as a card with a checkbox, and the farmer ticks every item they want collected in the same trip. A footer pinned to the bottom shows how many items are currently selected next to a "Request Pickup" button. Submitting the request notifies the distributor, who then assigns a rider to collect the produce. Batching several harvests into one request avoids sending a rider out for each individual item.

**19 — Farmer — Profile Tab.**
The Farmer Profile tab is the account view reachable from the farmer's bottom navigation. It shows the avatar and name at the top, followed by read-only cards displaying the registered email and phone number. An outlined "Edit Profile" button pushes the shared Edit Profile screen for making changes. A red "Log Out" button sits at the bottom of the screen, separated from the informational content above it. It is functionally a slimmed-down version of the shared Profile hub, scoped to what a farmer needs.

**20 — Farmer — Notifications.**
The Notifications screen collects system alerts addressed to the farmer in one chronological list. Each entry is a card with a bell icon and two lines of text describing the event, such as a harvest being approved or a rider being assigned to a pickup. It is a pushed screen opened from the bell icon in the Farmer Home header, so it has a back control and no tab bar. Entries are read-only; acting on an alert means navigating to the relevant harvest or pickup screen. The screen ensures state changes made by the distributor are not missed.

**21 — Harvest List (full).**
The full Harvest List is the expanded view of every harvest a farmer has ever submitted, pushed from the Home or Harvest tab. A search field at the top filters the list by vegetable name, which keeps it usable once many records have accumulated. Each harvest card shows the produce name and quantity, with Edit, Delete, and Request Pickup chips attached. This lets the farmer act on an older harvest without scrolling through the summarised list on the tab screens. It is the complete record view, where the tab screens show only recent activity.

**22 — Farmer Pickup Tracking.**
The Farmer Pickup Tracking screen shows the progress of a pickup request the farmer has already submitted. Before a rider is assigned it displays a warning box reading "Waiting for rider assignment," because there is no route to draw yet. Once a rider is assigned, a map fills the middle of the screen with the rider's route toward the farm. A status row of chips — Requested, Assigned, Picked Up — makes the current stage explicit even when the map is still loading. It is the farmer-side counterpart to the retailer's delivery tracking screen.

---

## Distributor Role

Bottom tabs: Home · Orders · Stocks · Inventory · Profile — plus sub-screens pushed on top of the tab navigator.

**23 — Distributor — Home.**
The Distributor Home screen is the dashboard shown after a distributor logs in. Two summary cards at the top report total stock on hand in kilograms and the number of orders currently awaiting a decision. A "Recent Products" list shows the most recently priced items with their per-kilogram price, giving a quick read on the catalogue. The header carries two icons for notifications and messages, since a distributor sits between farmers and retailers and receives traffic from both. It is a read-only overview; every figure links onward to the tab that can act on it.

**24 — Distributor — Orders Tab.**
The Orders tab is where a distributor reviews and decides on purchase orders placed by retailers. A row of filter chips at the top switches the list between Pending, Accepted, and Delivered orders. Each order card shows the retailer's name, a summary of the order, and its total value, with Accept and Reject buttons attached. A reason input below the list captures an explanation when an order is rejected, which is then shown to the retailer. This screen is the approval gate for outgoing stock.

**25 — Distributor — Stocks Tab.**
The Stocks tab gives a condensed view of the produce batches currently held by the distributor. Each batch appears as a card with a thumbnail, the batch name, and a short description of quantity and condition. A "View All Stocks" link pushes the full Stocks screen where batches can be added and edited. Keeping the tab summarised prevents the dashboard from becoming a long list once dozens of batches are in storage. Stock entries here originate from harvests collected from farmers.

**26 — Distributor — Inventory Tab.**
The Inventory tab summarises stock levels as a chart rather than a list, so trends are visible at a glance. A chart placeholder at the top plots the week's inventory levels across the distributor's produce. Below it, a card states the total monetary value of the inventory currently held. A "View Full Report" link opens the detailed Inventory Report screen with history and export options. This tab answers "how are we doing," where the Stocks tab answers "what do we have."

**27 — Distributor — Profile Tab.**
The Distributor Profile tab is the account view in the distributor's bottom navigation. It shows the avatar at the top, followed by navigation cards for Edit Profile and Account Management. The Account Management card is what distinguishes this profile from the other roles, since only distributors approve retailer and rider accounts. A red "Log Out" button is anchored at the bottom of the screen. Like the other profile tabs, it acts as a menu rather than an editing surface.

**28 — Stocks (full, FIFO batches).**
The full Stocks screen is the distributor's complete batch inventory, managed on a first-in-first-out basis. A search field filters existing batches, each shown as a card with a photo, the vegetable name and quantity, an editable price field, and an Edit action. An "Add Batch" section below collects a vegetable name, price, stock quantity, and a product photo before saving a new batch. Tracking produce as dated batches rather than a single running total is what allows older stock to be sold first. This is the distributor's main inventory-management screen.

**29 — Product List (aggregated, legacy).**
The Product List screen shows stock aggregated by vegetable type rather than by individual batch. Each row states a product name, the combined quantity across all its batches, and an editable price input. A single "Save Prices" button at the bottom commits price changes for every listed product at once. It is retained as a legacy screen from before FIFO batch tracking was introduced, and is useful for bulk repricing. Batch-level detail lives on the Stocks screen instead.

**30 — Distributor Inventory Report.**
The Inventory Report screen is the detailed reporting view pushed from the Inventory tab. A weekly inventory chart occupies the top of the screen, showing how stock levels moved over the reporting period. An "Export PDF" button generates a shareable copy of the report for record-keeping or presentation. Below that, a History section lists previous reporting weeks that can be opened individually. This screen supports the record-keeping and analytics requirements of the distributor role.

**31 — Shopee-style Tracking (Distributor/Retailer view).**
This tracking screen follows a delivery from the distributor's warehouse to a retailer using the progress-stage pattern familiar from e-commerce apps. A map at the top draws the route between the two endpoints. Beneath it, a row of chips marks the stages — Preparing, Picked up, On the way, Delivered — with the current stage highlighted. A card below identifies the assigned rider so either party can contact them if needed. The same screen is shown to both the distributor and the retailer, which keeps their view of an order's status consistent.

---

## Retailer Role

Bottom tabs: Home · Cart · Orders · Profile — plus sub-screens pushed on top of the tab navigator.

**32 — Retailer — Home (Shop).**
The Retailer Home screen is a storefront listing the produce a distributor currently has available. A search field at the top and a row of category chips — All, Leafy, Root, Fruit — narrow the catalogue down to what the retailer is looking for. Each product appears as a card with a photo, name, price per kilogram, and a quantity stepper for adding it to the cart without leaving the list. A cart icon in the header shows that items are waiting to be checked out. It is the entry point of the retailer's purchasing flow.

**33 — Retailer — Cart Tab.**
The Cart tab holds the items a retailer has selected but not yet ordered. Each line is a card with a product thumbnail, the name and unit price, a quantity stepper, and a remove control. A total pinned above the bottom of the screen updates as quantities change, so the running cost is always visible. A primary "Checkout" button carries the cart into the Order Confirmation screen. Keeping the cart as a tab means a retailer can build an order across several browsing sessions.

**34 — Retailer — Orders Tab.**
The Orders tab lists the retailer's purchase orders and their current fulfilment status. Filter chips at the top split the list into Active and Completed orders. Each card shows the order number, a summary line, and a status badge such as "On the way" or "Delivered." Active orders expose "Track" and "Details" buttons that open the tracking map and the itemised breakdown respectively. This is where a retailer monitors an order after it has left the cart.

**35 — Retailer — Profile Tab.**
The Retailer Profile tab is the account view in the retailer's bottom navigation. It shows the avatar at the top, followed by navigation cards for Manage Addresses and Order History. Addresses are given prominence here because delivery destination is the retailer's most frequently changed setting. A red "Log Out" button is anchored to the bottom of the screen. As with the other roles, the tab is a menu that pushes the shared screens rather than editing anything in place.

**36 — Order Confirmation.**
The Order Confirmation screen is the checkout step between the cart and a placed order. A "Deliver To" section shows the currently selected address with a link to Manage Addresses for changing it. A Schedule section takes a preferred delivery date and time so the distributor can plan rider assignments. Below that, the order items and the final total are restated so the retailer can review everything before committing. A primary "Place Order" button submits the order to the distributor for approval.

**37 — Order History.**
The Order History screen is the retailer's archive of completed transactions, pushed from the Profile tab. Each past order is a card showing the order number, a summary line, and a Delivered badge. The list is read-only, since completed orders cannot be modified after the fact. Tapping an entry opens the Order Details screen with the full itemised breakdown. It exists so a retailer can review past purchases and reconcile their own records.

**38 — Order Details.**
The Order Details screen is the itemised breakdown of a single order. An Items section lists each product with its quantity and line total, so the retailer can verify what was actually ordered. A Breakdown section below computes the subtotal, the delivery fee, and the final total as separate rows. A status badge states where the order currently stands, and a "Track Order" button opens the live tracking map when the order is still in transit. It serves as the in-app receipt for a transaction.

**39 — Customer Delivery Tracking.**
The Customer Delivery Tracking screen is the retailer's live view of an order that is out for delivery. It restates the order items at the top so the viewer can confirm which shipment is being tracked. A map below shows the delivery's live status and the rider's position along the route. A status badge such as "Out for delivery" states the current stage in plain language for cases where the map has not loaded. It is opened from the Track action on the Orders tab or on Order Details.

---

## Delivery / Rider Role

Bottom tabs: Home · Tasks · History · Profile — plus sub-screens pushed on top of the tab navigator.

**40 — Delivery — Home.**
The Delivery Home screen is the rider's dashboard for the current working day. Two summary cards at the top count the deliveries assigned today and the number already completed, giving the rider a sense of remaining workload. A "Today's Deliveries" list below shows each assignment as a card with the destination name and a status badge such as Pending or In transit. A notification icon in the header surfaces new assignments as they arrive. It is an overview screen; acting on a delivery happens in the Tasks tab.

**41 — Delivery — Tasks Tab.**
The Tasks tab lists the deliveries currently assigned to the rider and is the screen they work from. Each task is a card showing the order number, a destination summary, and an Assigned badge. Two buttons on every card — "Navigate" and "Details" — open the fullscreen navigation view and the delivery details screen respectively. Tasks disappear from this list once they are marked delivered and move into History. This is the rider's active work queue.

**42 — Delivery — History Tab.**
The History tab is the rider's record of deliveries they have already completed. Each entry is a card showing a thumbnail of the proof-of-delivery photo alongside the order number and a summary line. Attaching the photo to the record is what lets a completed delivery be verified after the fact. The list is read-only and ordered from most to least recent. It gives both the rider and the distributor an auditable trail of fulfilled deliveries.

**43 — Delivery — Profile Tab.**
The Delivery Profile tab is the account view in the rider's bottom navigation. It shows the avatar at the top with a single navigation card for Edit Profile. The rider profile is the simplest of the four because riders manage no addresses, catalogue, or sub-accounts. A red "Log Out" button is anchored at the bottom of the screen. Its structure mirrors the other role profile tabs so navigation stays predictable across the app.

**44 — Delivery Details.**
The Delivery Details screen contains everything a rider needs about one specific assignment. A card at the top identifies the destination retailer with the full delivery address, followed by a list of the order items being carried. A map shows the rider's current location with a "Refresh Location" button for re-acquiring a GPS fix when the signal is poor. Accept and Reject buttons let the rider respond to the assignment, with a reason input for explaining a rejection. A primary "Mark Delivered" button closes the task and moves it into the History tab.

**45 — Rider Navigation (Grab-style).**
The Rider Navigation screen is a fullscreen turn-by-turn view modelled on ride-hailing apps. A map with the drawn route fills almost the entire screen, since navigation is the rider's only concern while driving. A compact card overlaid at the bottom shows the destination name along with the estimated time of arrival and remaining distance. Three actions sit beneath it — Call, Message, and Arrived — so the rider can contact the recipient or confirm arrival with one tap. Large controls and minimal text keep the screen usable while the rider is in motion.
