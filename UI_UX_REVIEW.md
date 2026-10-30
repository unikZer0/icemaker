# AACC IceMaker UI/UX Review

**Date:** 2026-10-27  
**Scope:** Home, device list and setup dialog, device dashboard, alarms, LINE notification settings, and login.  
**Status:** Reviewed and updated.

## Updates made

- Replaced the horizontally clipped mobile navigation with a compact grid so all five destinations are visible without horizontal swiping.
- Changed the mobile device table into readable device cards. Each card shows labeled details and keeps dashboard, setup, and delete actions together.
- Removed the device-list panel's fixed viewport minimum. On desktop the panel expands to use the available workspace height, with pagination anchored below the rows; on mobile it follows the content height and keeps the footer at the bottom on short lists.
- Extended the device-list header border/background to the workspace edges while keeping its controls aligned with the page gutter.
- Enabled vertical scrolling for long workspace pages on desktop. The LINE settings form and its save/test actions are reachable below the fold; Home keeps its own bounded content area.
- Prevented long workspace content from shrinking the header, page heading, or footer; the notification center now keeps the same desktop header height as Home.
- Kept the top header visible while scrolling long pages so breadcrumb and account controls remain within reach.
- Added a restrained glass treatment to the sidebar, navigation tabs, and sticky top bar while preserving contrast; reduced-transparency system preferences retain solid surfaces.
- Replaced sidebar character glyphs with a consistent set of inline outline icons and a yellow active-state accent; reduced-transparency preferences remove nav blur and translucent fills.
- Added first-load skeletons for device lists, workspace tables and summaries, and dashboard metrics/charts; added restrained control/dialog transitions with a reduced-motion fallback.
- The cross-page View Transition experiment was removed after live Chromium navigation reproduced `InvalidStateError`; control, dialog, and mobile-menu transitions remain, with reduced-motion support.
- Bundled IBM Plex Sans Thai locally in WOFF2 subsets and applied regular, medium, semibold, and bold weights across Thai and Latin text; included the SIL Open Font License.
- Converted Home, dashboard, and alarm tables into labeled mobile cards, styled the recent-event detail link consistently, and stacked the mobile dashboard breadcrumb and machine selector.
- Made the LINE save/test action row sticky on mobile while the user scrolls through the long settings form.
- Reduced the height of empty history charts and hid the cycle/capacity card group until at least one of those readings exists.
- Made the cycle/capacity cards use a balanced two-column layout on mobile.
- Updated the shared stylesheet cache version on all HTML pages so browsers request the current UI rules.

## Browser checks

Checked in Chrome at **2048×768**, **1366×768**, and **390×844**.

- Home content fits the 2048×768 viewport; the activity panel ends at the Home container boundary and the footer begins directly below it.
- All five mobile navigation links fit within the viewport; the navigation itself has no horizontal overflow.
- At 390px, the device card exposes all three actions and the page has no horizontal overflow. Search, empty search results, and the add-device dialog were exercised.
- On desktop, the LINE settings page scrolls inside the main content area and its save action can be brought into view.
- On mobile, the LINE settings save/test actions remain accessible while scrolling.
- Dashboard cycle/capacity cards stay hidden when those readings are absent and appear when a reading is present. Empty history charts are shorter.
- Navigated between Home and alarms, used the Home refresh action, and observed no browser JavaScript errors.
- `npm run check` and `git diff --check` pass.

## Notes

The local Docker daemon was unavailable during this pass, so browser review used a temporary local file-storage server with a separate temporary data directory. That server was stopped after the checks; the Docker Compose services remain down. No production or persistent device data was used.

## 2026-10-28 follow-up: mobile navigation

- Replaced the always-visible mobile navigation grid with a compact sticky top bar containing the AACC IceMaker brand and a **เมนู** toggle.
- The toggle expands a single-column list of all five destinations below the brand row. This keeps the initial mobile header short and avoids leaving one destination alone on a second grid row.
- The toggle updates `aria-expanded` and its accessible label, controls the navigation with `aria-controls`, and hides/inerts the collapsed links from keyboard navigation and assistive technology.
- Users can open/close the list with the toggle, close it with Escape, and it closes after choosing a destination. Desktop navigation remains visible as a sidebar.
- Added reduced-motion handling for the menu transition and bumped the shared UI stylesheet cache key to `mobile-drawer-20261028`.
- `npm run check`, `node --check public/navigation.js`, and `git diff --check` pass. Docker Compose rebuilt the `icemaker` service; `GET /api/health` returned `200` with PostgreSQL storage.
- A fresh Chrome visual check could not run in this environment: Playwright failed to launch Chrome with `spawn EPERM`. The previous Chrome screenshots/checks above predate this navigation change and do not verify the new drawer visually.
- Reinstalled the local Playwright package without changing `package.json` or the lockfile and installed Playwright-managed Chromium successfully. Launching that bundled Chromium also fails with `spawn EPERM`, so reinstalling the browser does not resolve the process-launch restriction in this environment; visual verification remains outstanding.

## 2026-10-28 follow-up: Docker log review

- Reviewed the complete available `docker compose logs --no-color --timestamps` output for both project services (`icemaker` and `database`): 25 lines total, with no error, warning, exception, fatal, panic, or failed entries.
- Both containers report `running` and `healthy`, with restart count `0`. The PostgreSQL readiness check and app `/api/health` both returned success; the API reported PostgreSQL storage.
- Reviewed relevant Docker events from the last 24 hours. The app and database health-check executions exited with code `0`; no crash/restart event was found in the available service events.
- The Edge `InvalidStateError` is a browser-side View Transition console error. It does not appear in these Docker service logs, so container health does not verify or disprove the browser transition behavior.

## 2026-10-28 follow-up: button and action audit

- Audited the visible controls and their event handlers across login, dashboard, device list/setup, Home, alarms, and notification settings. Buttons/actions found include refresh/logout, machine picker and data selectors, machine search/sort/page-size/pagination, add/edit/save/close, token reveal/copy, gateway config download, delete confirmation, alarm filters/pagination/details, LINE settings save/test, and mobile navigation toggle.
- Ran every existing Node test file directly (rather than `npm test`, whose worker subprocess launch fails with this environment's `spawn EPERM`): **16 passed, 2 skipped, 0 failed**. The two skipped cases require the PostgreSQL test setup. `npm run check` and `git diff --check` also pass.
- Reconfirmed the running app health endpoint returns `200` and PostgreSQL storage is active.
- At the time of this audit, a real browser click-through could not be completed because Playwright's direct `chromium.launch()` failed with `spawn EPERM` and no existing remote-debug endpoint was exposed. This was a limitation of that launch path, not proof that all browser automation is unavailable; see the follow-up below.
- Did not submit LINE test messages or exercise live device creation, edits, or deletion because those actions can send external messages or modify persistent user data. Existing automated tests cover backend notification validation and device deletion behavior without changing the live application data.

## 2026-10-28 follow-up: Playwright `spawn EPERM` workaround

- Isolated the process issue: Node can spawn Node and PowerShell child processes. Playwright's own `chromium.launch()` still fails with `spawn EPERM`, including with `pipe: false`; therefore a blanket Windows inability to create child processes is not the cause.
- Worked around the launch path by starting the Playwright-managed Chromium executable directly with Node `child_process.spawn`, a temporary profile, and a loopback DevTools port, then attaching with `chromium.connectOverCDP()`.
- Verified the workaround in this environment: Chromium started, Playwright attached over CDP, and the browser loaded `/web/login` from the local app. This lets browser checks proceed without Playwright creating the browser process itself.
- Opened the provided `http://127.0.0.1:3100/home` URL through that method. The server returned `200` and redirected this fresh browser profile to `/login?next=%2Fhome`, as expected for an unauthenticated session; the login page rendered with no browser console/page errors.
- The exact Windows policy/API detail behind Playwright's own spawn failure remains undetermined. For future checks, use the verified manual Chromium + CDP method rather than `chromium.launch()`.

## 2026-10-28 follow-up: live button checks and fixes

- Logged into the local app in an isolated temporary browser profile using the configured admin credentials; the login secret was not printed or saved in the repository.
- Live checks reproduced the View Transition console error during page navigation, so the cross-document `@view-transition` opt-in and its page animations were removed. The normal page navigation remains intact; local control/dialog/menu transitions remain enabled.
- The mobile device list hid its table header, which also hid both sort buttons. Added a mobile-only sort selector for newest/oldest and Thai-name order; desktop keeps its sortable column buttons.
- Verified login, Home refresh, mobile menu open/Escape/navigation, device search/page size/pagination state, empty-name validation, add-dialog close, delete confirmation cancel, dashboard refresh/source/range selectors, alarm refresh/filters/page controls/details (where present), notification refresh and the unsaved-change guard, and logout.
- The final live browser pass after both fixes completed **12/12 check groups with zero failures and zero browser console/page errors**. It verified the mobile sort selector and desktop sort buttons, plus the navigation and safe actions listed above.
- Side-effecting actions were intentionally guarded: no LINE settings were saved, no real LINE test message was sent, no device was created/updated/deleted, no secret was copied to the OS clipboard, and no credential file was downloaded. Delete confirmation was opened and canceled; empty device submission was blocked by required-field validation.
- Ran the two PostgreSQL-dependent cases explicitly with `TEST_POSTGRES=1` in a temporary container using randomized `icemaker_test_*` schemas. Import/persistence/restart and malformed-import rollback/retry all passed; the test fixture dropped its schemas on completion. Total for `test/database.test.js`: **3 passed, 0 skipped, 0 failed**.
- A visual review at 390px found a stale later CSS rule still forcing the expanded mobile menu into two columns. Changed that rule to one full-width vertical list, rebuilt the service, and confirmed all five links render as full-width rows at 390px; bumped the UI cache key.
- Final readiness rerun: JavaScript/static checks and `git diff --check` pass; direct execution of all test files has no failures (two PostgreSQL cases skip unless enabled, and both pass in the explicit PostgreSQL run above). Mobile smoke check confirms 5 visible menu links, one-column layout, device sort availability, and zero browser errors.
- Both Compose services are healthy and `/api/health` returns `200`; the app container has no error/warning log matches. PostgreSQL logs include the deliberately-triggered missing-device FK rejection from the rollback test and a `role "root" does not exist` entry caused by an earlier manual `pg_isready` call without a DB username. Rechecking readiness with the configured database user succeeds.
- No changes are staged. The untracked `env` file contains secret configuration keys and is now ignored by `.gitignore`.


## 2026-10-30 UI review follow-up

- Removed the cross-document @view-transition opt-in, keeping local menu, dialog, and control transitions; this aligns the stylesheet with the earlier Chromium error review.
- Simplified /alarms to one combined event list, active items first. The empty state and page subtitle now call out devices with no data or offline status and link to Devices. Removed the unused status selector and tab CSS.
- Bumped stylesheet and script cache keys. Docker Compose rebuild completed and /api/health returned HTTP 200 with PostgreSQL storage.
- Browser visual review of these latest 2026-10-30 changes remains outstanding; the recorded Chrome pass predates them.

## 2026-10-30 mobile readability follow-up

- Increased mobile supporting-text size and contrast on Home, Alarms, Devices, and Notifications, including device summary rows and alarm details.
- Stacked the Alarms severity filter and search input vertically on narrow screens and increased their tap height.
- Rebuilt the `icemaker` service to serve the updated stylesheet.
- Rechecked the four pages in Chromium at 320px and 390px: no horizontal overflow and no browser errors; Alarms controls render one per row.
