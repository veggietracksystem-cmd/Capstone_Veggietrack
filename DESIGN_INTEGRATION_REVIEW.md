# Redesign integration review

Reviewed: 2026-09-18

## Applied safely

The production Expo app (`mobile/`) now shares the approved redesign's core
visual tokens: cream screen surfaces, leaf-green primary actions, neutral text
and borders, consistent semantic feedback colors, rounded cards and controls,
and a softly elevated bottom navigation surface. This is implemented centrally
in `mobile/src/theme/appTheme.js` and `mobile/src/components/BottomNavBar.js`,
so all four roles inherit it without duplicating colors or altering business
logic.

## Prototype coverage

`design-prototype/` remains a useful click-through review artifact. Its core
role flows already have functional counterparts in the production app:

| Role | Production coverage |
| --- | --- |
| Farmer | Harvests, pickup requests/tracking, offline queue, reports, messages, profile |
| Distributor | Pickups, batch inventory, stock listing, retailer orders, rider assignment, reports |
| Rider | Pickup/delivery tasks, navigation, live ETA, proof capture and verified completion |
| Retailer | Product browsing/cart, scheduled checkout, addresses/pins, order history and tracking |

## Not promoted as functionality

The prototype includes sample-data interactions and explicitly marked proposed
states such as expanded task stages and batch-photo confirmations. They were
not copied into the live app as fake controls. Any new state must first be
specified in the API contract, authorization rules, and database migration,
then implemented with regression coverage.

## Verification

- Expo web export completed successfully on 2026-09-18.
- Backend regression tests were run as part of this review; the visible run
  completed all reported checks without failures before the command time limit.
- Hosted Supabase migration/deployment and physical-device acceptance remain
  required before production release; see `STATUS_REPORT.md`.
