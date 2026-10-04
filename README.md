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

Edit `.env` and set a unique `JWT_SECRET` (at least 32 random characters). Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 8 characters) to provision the administrator if the email is not already present. The app never overwrites an existing account. Keep `.env` private.

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
- **Admin:** provision credentials through environment variables, review and verify mechanics, inspect user/request/SOS counts, and view recent SOS activity and assistance requests.

The SOS action asks for confirmation. Online alerts are stored by the server. If the browser is offline or the request loses network connectivity, the alert is queued in IndexedDB and retried when connectivity returns. The application does not claim to send an SMS or contact emergency services. Call local emergency services for immediate danger.

## API overview

All endpoints are under `/api`. Protected routes require `Authorization: Bearer <token>`.

| Area | Endpoints |
| --- | --- |
| Status | `GET /health` |
| Authentication | `POST /auth/register`, `POST /auth/login`, `GET /me`, `PUT /me` |
| Contacts | `GET /contacts`, `PUT /contacts` |
| Mechanics | `GET /mechanics?lat=…&lng=…`, `POST /mechanic/availability` |
| Requests | `POST /requests`, `GET /requests`, `PATCH /requests/:id/status`, `POST /requests/:id/rating` |
| SOS | `POST /sos`, admin-only `GET /sos` |
| Administration | `GET /admin/overview`, `GET /admin/mechanics`, `PATCH /admin/mechanics/:id/verify` |

## Design and implementation notes

- The landing page and dashboards use a warm paper palette, deep slate typography, a restrained road-orange SOS accent, and custom responsive layouts.
- The browser Geolocation API supplies actual coordinates; the UI reports permission, availability, and timeout errors rather than inventing a location.
- Leaflet renders an OpenStreetMap view. Mechanic distance is calculated from coordinates, and only verified, online mechanics inside their declared service radius appear in driver search.
- Passwords are hashed with bcrypt. API roles are checked server-side, request state changes follow an allowed transition table, and database operations use parameterized SQL.
- `npm test` starts a temporary API/database and checks account flows, contacts, mechanic verification/availability, assistance states, rating, SOS storage, and role authorization. Test data is removed after the run.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API and production web port (default `4000`) |
| `JWT_SECRET` | Signing key for session tokens; set a unique secret |
| `DATABASE_PATH` | SQLite database path (default `./data/roadsos.db`) |
| `VITE_API_URL` | API URL for the Vite client (default `http://localhost:4000/api`) |
| `ADMIN_EMAIL` | Optional first-run admin email |
| `ADMIN_PASSWORD` | Optional first-run admin password (minimum 8 characters) |
| `ADMIN_NAME` | Optional admin display name |
| `ADMIN_PHONE` | Optional admin phone field |

## Current limits

- Mechanic verification is manual. Admin credentials must be provisioned through environment variables before first startup.
- Status updates appear when the client refreshes its request data; there are no push notifications or live mechanic tracking.
- SOS records are visible in the admin dashboard, but the app does not dispatch SMS, phone calls, or third-party emergency notifications.
- Location access requires browser permission and, outside localhost, a secure HTTPS origin. OpenStreetMap map tiles require network access.
- Offline sync requires the user to open the app again while online; the browser may suspend background tabs.
- The app has not been deployed to a public host. Choose a Node 22.9+ host with persistent disk storage (or replace SQLite with a managed database) and configure a stable secret and HTTPS before deployment.
