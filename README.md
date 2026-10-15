# Orbit — Advanced CRUD

A live customer management dashboard with a Node.js backend, server-side JSON storage, and push updates over Server-Sent Events. No external packages or build step are required.

## Run

Install Node.js 20 or newer, then run:

```sh
npm start
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The API persists records in `data/customers.json`.

## Features

- Create, read, update, and delete customer records through a REST API
- Live updates across open browser tabs using Server-Sent Events (no refresh required)
- Dashboard metrics, search, status and plan filters, sorting, and pagination
- Bulk status updates and bulk delete
- JSON/CSV import and CSV export; importing an existing email updates that record
- Server-side validation, duplicate-email protection, and atomic JSON file writes
- Responsive UI and keyboard search shortcut (`Ctrl/⌘ K`)

## API

- `GET /api/health`
- `GET /api/customers`
- `POST /api/customers`
- `PUT /api/customers/:id`
- `DELETE /api/customers/:id`
- `POST /api/customers/import`
- `PATCH /api/customers/bulk/status`
- `DELETE /api/customers/bulk`
- `GET /api/events` (event stream)

This is a local development project. For production, replace the JSON file store with a database and add authentication, authorization, and deployment configuration.
