# Drive Clone Server

This folder contains a simple Node/Express server for the Drive Clone app. It stores metadata in PostgreSQL and file uploads on the server's disk.

## Environment
Copy `.env.example` to `.env` and fill the DATABASE_URL and JWT_SECRET.

## Migrations
Run this to create the tables:

```bash
npm run init-db
```

## Start
```bash
npm run dev
```

API endpoints are under `/api/*` and require a `Authorization: Bearer <token>` header for protected routes.
