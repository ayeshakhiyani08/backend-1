# SupportFlow Backend

SupportFlow backend is the API layer for a customer complaint management system with AI triage, role-based access, ticket lifecycle handling, and real-time updates.

## Features

- JWT authentication with bcrypt password hashing
- Customer and agent role-based authorization
- Complaint creation, tracking, and status transitions
- AI triage suggestions based on complaint content
- Agent accept/reject/complete decision handling
- Ticket messaging and chat threads
- MongoDB persistence with Mongoose ORM
- Socket.IO live notifications for ticket activity
- Email-ready support utilities

## Tech Stack

- Node.js
- Express.js
- MongoDB + Mongoose
- JWT
- bcryptjs
- Socket.IO
- Nodemailer

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

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment file example:

```bash
cp .env.example .env
```

3. Update the variables in `.env`:

```env
PORT=5001
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/supportflow
JWT_SECRET=supportflow-dev-secret-change-me
CLIENT_URL=http://localhost:5175
OPENAI_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=supportflow@noreply.local
```

4. Start the backend in development mode:

```bash
npm run dev
```

The API will run at:

- http://localhost:5001

## Production Start

```bash
npm start
```

## Scripts

```bash
npm run dev   # start with nodemon
npm start     # start production server
```

## API Overview

### Auth APIs

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`

### Customer APIs

- `GET /api/customer/tickets`
- `POST /api/customer/complaints`

### Agent APIs

- `GET /api/agent/tickets`
- `PATCH /api/complaints/:id/decision`
- `PATCH /api/complaints/:id/status`

### Messaging APIs

- `GET /api/complaints/:id/messages`
- `POST /api/complaints/:id/messages`

## Demo Accounts

- Customer: `customer@supportflow.com` / `Customer123!`
- Agent: `agent@supportflow.com` / `Agent123!`

## Security Notes

- Never commit `.env` files.
- Keep JWT secrets private.
- MongoDB credentials and any AI keys must remain in server-side configuration only.
- Customer and agent permission checks are enforced in the backend routes.

## Notes

This backend is designed to work with the SupportFlow frontend that runs on the Vite app in the sibling `apps/web` folder.
