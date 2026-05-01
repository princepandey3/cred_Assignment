# AI Content Publishing API

A multi-platform AI content publishing API built with Node.js 18+, Express, PostgreSQL, and Redis.

---

## Project Architecture

```
ai-content-api/
├── docker/
│   └── postgres/
│       └── init.sql          # DB bootstrap (extensions, schema)
├── src/
│   ├── config/
│   │   ├── index.js          # Central config — reads all env vars
│   │   ├── database.js       # Sequelize + PostgreSQL connection
│   │   └── redis.js          # Redis client singleton
│   ├── controllers/          # (Phase 2+) Request handlers
│   ├── middlewares/
│   │   ├── errorHandler.js   # Global error handler + AppError class
│   │   ├── rateLimiter.js    # Default + auth rate limiters
│   │   └── requestLogger.js  # Morgan → Winston HTTP logs
│   ├── models/               # (Phase 2+) Sequelize models
│   ├── routes/
│   │   ├── index.js          # Root router (aggregates all routes)
│   │   └── health.js         # /health  and  /health/ready probes
│   ├── services/             # (Phase 2+) Business logic layer
│   ├── utils/
│   │   ├── apiResponse.js    # Consistent JSON response envelope
│   │   └── logger.js         # Winston logger (file + console)
│   ├── app.js                # Express app factory
│   └── server.js             # Entry point — boot + graceful shutdown
├── logs/                     # Runtime logs (git-ignored)
├── .env.example              # Environment variable template
├── .eslintrc.js              # ESLint (airbnb-base + prettier)
├── .gitignore
├── .nodemonrc                # Nodemon watch config
├── .prettierrc               # Prettier formatting rules
├── docker-compose.yml        # PostgreSQL + Redis services
└── package.json
```

---

## Quick Start

### 1 — Prerequisites

- Node.js ≥ 18
- Docker & Docker Compose

### 2 — Environment setup

```bash
cp .env.example .env
# Edit .env — fill in real secrets before running in production
```

### 3 — Start infrastructure

```bash
npm run docker:up
# Launches PostgreSQL (port 5432) and Redis (port 6379)

# Optional: pgAdmin UI at http://localhost:5050
docker-compose --profile tools up -d
```

### 4 — Install dependencies & run

```bash
npm install
npm run dev           # Hot-reload with nodemon
# or
npm start             # Plain node
```

### 5 — Verify

```
GET http://localhost:3000/api/v1/health
GET http://localhost:3000/api/v1/health/ready
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with nodemon hot-reload |
| `npm start` | Start without hot-reload |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format with Prettier |
| `npm run docker:up` | Start Docker services |
| `npm run docker:down` | Stop Docker services |
| `npm run docker:logs` | Tail Docker logs |

---

## API Response Envelope

All responses share a consistent shape:

```json
// Success
{ "success": true, "message": "...", "data": { ... }, "meta": { ... } }

// Error
{ "success": false, "message": "...", "errors": [ ... ] }
```

---

## Environment Variables

See `.env.example` for all available configuration options.
**Never commit `.env` to version control.**

---

## Layers

| Layer | Responsibility |
|---|---|
| **Routes** | URL matching, middleware chaining, input validation |
| **Controllers** | Parse request → call service → format response |
| **Services** | Pure business logic, orchestration, no HTTP knowledge |
| **Models** | Sequelize ORM models, DB schema definition |
| **Config** | Environment variables, DB + Redis connections |
| **Middlewares** | Cross-cutting concerns: auth, rate-limit, errors, logging |
| **Utils** | Shared helpers: logger, apiResponse, AppError |
