# ROAD SOS — Smart Roadside Assistance

A full-stack roadside assistance app built for local development and college project demos. It has a responsive React/Vite client, an Express REST API, and a persistent SQLite database using Node's built-in SQLite module.

## Requirements

- Node.js 22.9 or newer (the backend uses `node:sqlite`)
- npm
- A browser with location permission for GPS and OpenStreetMap tiles

## Run locally

```powershell
npm install
Copy-Item .env.example .env
```

The Supabase project URL is provided in `.env.example`; copy the project's publishable key from the Supabase API Keys page into the placeholder in that file. Keep it in `VITE_SUPABASE_PUBLISHABLE_KEY` (it is designed for browser use); never put a Supabase secret or service-role key in the client. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to provision the administrator profile in the local SQLite database. Keep `.env` private.

In the Supabase Dashboard, open **Authentication → URL Configuration** and add `http://localhost:5173` as a Site URL and redirect URL. Auth email confirmation is enabled by default: users confirm the signup email, then sign in. Add the production HTTPS URL there when deploying.

## Deploying the full app

Vercel currently serves the Vite frontend only. The Express API must also be deployed to a Node 22.9+ host with a persistent disk for SQLite. Set these variables in Vercel for the frontend and redeploy:

| Vercel variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://cxbdajqagwmmwzcwqwfx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key from Supabase **Settings → API Keys** |
| `VITE_API_URL` | The deployed API base URL ending in `/api` |

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_PATH` (on the persistent disk), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` on the API host. In Supabase **Authentication → URL Configuration**, set the Vercel URL as the Site URL and add it to Redirect URLs. The API cannot use `localhost` from a deployed browser.

```powershell
npm run dev
```

The frontend runs at `http://localhost:5173`, and the API runs at `http://localhost:4000`. Run the checks and make a production bundle with:

```powershell
npm test
npm run build
npm start
```

`npm start` serves the production frontend bundle and API together at port 4000. SQLite tables and indexes are created on first server start in `DATABASE_PATH`; there is no separate migration command. To use a different location, set `DATABASE_PATH` in `.env` before startup.

## Roles and workflows

- **Driver:** register, maintain vehicle details and emergency contacts, share current GPS coordinates, find verified and available mechanics within their stated service radius, send and follow a roadside request, submit a rating, and create SOS alerts.
- **Mechanic:** register a garage profile, wait for admin verification, share a current location and go online, review incoming jobs, and update accepted jobs through on-the-way, arrived, in-progress, and completed.
- **Admin:** provision an administrator profile through environment variables, then create its Supabase Auth login using the same email (select Admin on the registration screen). Only an email matching the pre-provisioned admin profile receives the admin role; role selection and Supabase user metadata cannot grant admin permissions. Review and verify mechanics, inspect user/request/SOS counts, and view recent SOS activity and assistance requests.

The SOS action asks for confirmation. Online alerts are stored by the server. If the browser is offline or the request loses network connectivity, the alert is queued in IndexedDB and retried when connectivity returns. The application does not claim to send an SMS or contact emergency services. Call local emergency services for immediate danger.

## API overview

All endpoints are under `/api`. Protected routes require `Authorization: Bearer <token>`.

| Area | Endpoints |
| --- | --- |
| Status | `GET /health` |
| Authentication | Supabase Auth signup/signin/signout, `GET /me`, `PUT /me` |
| Contacts | `GET /contacts`, `PUT /contacts` |
| Mechanics | `GET /mechanics?lat=…&lng=…`, `POST /mechanic/availability` |
| Requests | `POST /requests`, `GET /requests`, `PATCH /requests/:id/status`, `POST /requests/:id/rating` |
| SOS | `POST /sos`, admin-only `GET /sos` |
| Administration | `GET /admin/overview`, `GET /admin/mechanics`, `PATCH /admin/mechanics/:id/verify` |

## Design and implementation notes

- The landing page and dashboards use a warm paper palette, deep slate typography, a restrained road-orange SOS accent, and custom responsive layouts.
- The browser Geolocation API supplies actual coordinates; the UI reports permission, availability, and timeout errors rather than inventing a location.
- Leaflet renders an OpenStreetMap view. Mechanic distance is calculated from coordinates, and only verified, online mechanics inside their declared service radius appear in driver search.
- Supabase Auth manages passwords and browser sessions. Express verifies every bearer token with Supabase Auth and reads authorization roles from the trusted SQLite profile. Supabase `user_metadata` is used only for initial driver/mechanic profile details; it cannot grant admin access. Existing SQLite accounts are preserved and linked by authenticated email at first sign-in.
- `npm test` starts a temporary API/database and checks account flows, contacts, mechanic verification/availability, assistance states, rating, SOS storage, and role authorization. Test data is removed after the run.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API and production web port (default `4000`) |
| `DATABASE_PATH` | SQLite database path (default `./data/roadsos.db`) |
| `VITE_API_URL` | API URL for the Vite client (default `http://localhost:4000/api`) |
| `VITE_SUPABASE_URL` | Supabase project URL used by the browser |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by the browser |
| `SUPABASE_URL` | Supabase project URL used by the API |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by the API token verifier |
| `ADMIN_EMAIL` | Optional first-run admin email |
| `ADMIN_PASSWORD` | Optional first-run admin password (minimum 8 characters) |
| `ADMIN_NAME` | Optional admin display name |
| `ADMIN_PHONE` | Optional admin phone field |

## Current limits

- Mechanic verification is manual. Admin profile credentials must be provisioned in the local environment before first startup, and a matching Supabase Auth user must be created before the administrator can sign in.
- Status updates appear when the client refreshes its request data; there are no push notifications or live mechanic tracking.
- SOS records are visible in the admin dashboard, but the app does not dispatch SMS, phone calls, or third-party emergency notifications.
- Location access requires browser permission and, outside localhost, a secure HTTPS origin. OpenStreetMap map tiles require network access.
- Offline sync requires the user to open the app again while online; the browser may suspend background tabs.
- The app has not been deployed to a public host. Choose a Node 22.9+ host with persistent disk storage (or replace SQLite with a managed database) and configure a stable secret and HTTPS before deployment.
