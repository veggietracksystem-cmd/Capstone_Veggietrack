# VeggieTrack Redesign — Visual Prototype

**This is a standalone, click-through visual mockup. It is completely separate from the real VeggieTrack app.**

- No React Native code, navigation, screens, API, or database was touched.
- Plain HTML/CSS/JS, self-contained in this folder only.
- All data (`data.js`) is fictional sample data for demonstration.
- Nothing here is wired to Supabase, the backend, or any real service.

## How to view it

Just open [`index.html`](index.html) in any browser — double-click it, or drag it into a browser tab. No build step, no server, no install required.

(If you're viewing this inside the Claude Code preview panel, it's already running.)

## How to use it

- **Left panel** — pick a role (Farmer / Distributor / Rider / Retailer) and jump directly to any of the ~79 proposed screens for quick review. This panel is a review aid only; it is not part of the proposed app design itself.
- **Phone mockup** — tap anything inside it (cards, rows, buttons, bottom nav) to navigate, exactly like a real phone. Use the `‹` back arrow or bottom nav to move around.
- **Connectivity buttons** — simulate Offline / Syncing / Synced states on the dashboards.

## Proposed vs. existing

Look for the `✦ Proposed` tag and the dashed "note" boxes throughout the prototype (most visible in Farmer Pickup Tracking). These call out workflow states — like **OTW**, **Rider Assigned**, or **Batch Photo confirmation** — that are proposed UX improvements, not confirmed backend functionality. Nothing in this prototype should be read as a claim about what the current production backend already supports.

## Structure

- `index.html` — page shell, phone frame, control panel
- `styles.css` — full design system (VeggieTrack green `#1E4E09`, cream background)
- `data.js` — sample vegetables, harvests, pickups, orders, tasks, messages, notifications
- `components.js` — reusable UI building blocks (rows, badges, timeline, map, forms, POD flow, profile, messaging, notifications)
- `screens.farmer.js`, `screens.distributor.js`, `screens.rider.js`, `screens.retailer.js` — per-role screen definitions
- `app.js` — router, state, event handling (no framework/build tool)

## Next step

This is for review only. If you approve the direction, implementation into the real VeggieTrack React Native app would be a separate, explicitly-requested piece of work.
