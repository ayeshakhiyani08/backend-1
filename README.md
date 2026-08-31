# SupportFlow Backend

SupportFlow backend is the API layer for the SupportFlow complaint management platform. It handles authentication, customer and agent ticket workflows, AI-style triage suggestions, role-based access control, messaging, and real-time updates.

## Overview

This backend powers the operational side of the product:

- customer ticket creation and viewing
- agent queue management and triage decisions
- status changes and resolution notes
- admin visibility across tickets
- real-time notifications with Socket.IO
- persistent MongoDB storage

## Features

- JWT authentication with secure password hashing
- Role-based access for customer, agent, and admin
- Ticket creation, filtering, assignment, and lifecycle updates
- AI triage suggestions for category, priority, and summary
- Human review before finalizing ticket metadata
- Message threads for customer-agent communication
- Socket.IO live event broadcasts for ticket updates
- MongoDB storage with Mongoose models
- Seeded demo users and sample complaint data

## Tech Stack

- Node.js
- Express.js
- MongoDB + Mongoose
- JWT
- bcryptjs
- Socket.IO
- Nodemailer
- dotenv

## Project Structure

```bash
src/
  config/
    db.js
  middleware/
    auth.js
  models/
    Complaint.js
    Message.js
    User.js
  routes/
    auth.js
    complaints.js
  server.js
```

## Prerequisites

- Node.js 18+
- MongoDB Atlas URI or local MongoDB instance
- Optional: SMTP credentials for notifications

## Environment Setup

Create a `.env` file in this folder:

```env
PORT=5001
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/supportflow
JWT_SECRET=supportflow-dev-secret-change-me
CLIENT_URL=http://localhost:5174
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=supportflow@noreply.local
```

Notes:
- If `MONGODB_URI` is not provided, the app automatically falls back to an in-memory MongoDB instance for local development.
- Keep secrets outside the repo and never expose them in frontend code.

## Installation

```bash
npm install
```

## Run Locally

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The API will run at:

- http://localhost:5001

## Demo Accounts

These accounts are seeded automatically when the server starts:

- Customer: `customer@supportflow.com` / `Customer123!`
- Agent: `agent@supportflow.com` / `Agent123!`
- Admin: `admin@supportflow.com` / `Admin123!`

## API Overview

### Authentication

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`

### Customer

- `GET /api/customer/tickets`
- `POST /api/customer/complaints`

### Agent

- `GET /api/agent/tickets`
- `PATCH /api/complaints/:id/decision`
- `PATCH /api/complaints/:id/status`

### Messaging and Ticket Details

- `GET /api/complaints/:id/messages`
- `POST /api/complaints/:id/messages`
- `PATCH /api/complaints/:id/review`
- `PATCH /api/complaints/:id/cancel`

### Admin

- `GET /api/admin/dashboard`
- `GET /api/admin/complaints`

## Real-Time Events

Socket.IO is used for live updates including:

- new-ticket
- ticket-accepted
- ticket-rejected
- status-updated
- new-message
- ticket-completed
- ticket-reviewed

## Business Rules Enforced

- only authenticated users can access protected routes
- customers can only view their own complaints
- agents can update only assigned tickets
- resolved tickets cannot be changed via the normal workflow unless reopened
- priority values are validated before storing
- AI suggestions are reviewed by a human before being finalized

## Security Notes

- Never commit `.env` files
- Keep JWT secrets private
- Never place API keys or secrets in frontend code
- Authorization checks are enforced on the server side

## Notes

This backend is designed to work with the SupportFlow frontend located in the sibling `apps/web` folder.
