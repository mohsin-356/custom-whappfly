# WhatsBridge

> Production-ready WhatsApp ↔ n8n Bridge — self-hosted, session-persistent, multi-device.

---

## What It Does

WhatsBridge is a middleware that sits between WhatsApp and n8n (or any webhook consumer).

```
WhatsApp ──► WhatsBridge ──► Webhook (n8n)
                  │
                  └──► Response from n8n ──► WhatsApp
```

Every incoming WhatsApp event (messages, media, groups, calls, reactions, etc.) is captured, normalized into a consistent JSON payload, and forwarded to your configured webhook URL. If your webhook responds with a send instruction, WhatsBridge sends the message back to WhatsApp automatically.

---

## Quick Start

### 1. Prerequisites

- Node.js ≥ 18
- MongoDB (local or Atlas)
- Redis *(optional — for BullMQ queues; set `REDIS_ENABLED=true`)*

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your values
```

Minimum required changes in `.env`:

| Variable | What to set |
|---|---|
| `MONGODB_URI` | Your MongoDB connection string |
| `JWT_SECRET` | Any long random string |
| `API_KEY` | Any random API key |
| `DASHBOARD_PASSWORD` | Your chosen password |
| `SESSION_ENCRYPTION_KEY` | Exactly 32 characters |

### 4. Run

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Open **http://localhost:3000** to access the dashboard.

---

## Dashboard

| Section | Description |
|---|---|
| **Overview** | QR code display, live connection status, real-time event counters, live log stream |
| **Sessions** | List all sessions, reconnect, delete |
| **Webhooks** | Configure test/production URLs, switch modes, view delivery logs |
| **Logs** | Browse all incoming/outgoing event logs |
| **Settings** | API key display, system health |

### Default Credentials

- Password: `admin123` *(change `DASHBOARD_PASSWORD` in `.env`)*

---

## API Reference

Full interactive documentation available at:  
**http://localhost:3000/api/docs**

### Key Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Get JWT token |
| `GET` | `/api/status` | Health check (public) |
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/sessions/:id/status` | Get session status + QR |
| `POST` | `/api/sessions/:id/connect` | Start / reconnect |
| `POST` | `/api/sessions/:id/disconnect` | Disconnect (keep session) |
| `POST` | `/api/sessions/:id/logout` | Logout + delete auth |
| `POST` | `/api/sessions/:id/restart` | Restart socket |
| `DELETE` | `/api/sessions/:id` | Delete session completely |
| `GET` | `/api/sessions/:id/webhook` | Get webhook config |
| `PUT` | `/api/sessions/:id/webhook` | Update webhook config |
| `POST` | `/api/sessions/:id/webhook/test` | Test webhook URL |
| `POST` | `/api/sessions/:id/webhook/switch` | Switch test/production mode |
| `GET` | `/api/sessions/:id/webhook/logs` | Webhook delivery logs |
| `GET` | `/api/sessions/:id/groups` | List groups |
| `GET` | `/api/sessions/:id/contacts` | List contacts |
| `GET` | `/api/sessions/:id/logs` | Event logs |
| `GET` | `/api/sessions/:id/metrics` | Session metrics |
| `POST` | `/api/send` | Send a message |
| `POST` | `/api/send-media` | Send media (multipart or base64) |
| `GET` | `/api/metrics` | Global metrics |

### Authentication

All API endpoints (except `/api/status` and `/api/auth/login`) require one of:

- **JWT**: `Authorization: Bearer <token>` — obtained from `/api/auth/login`
- **API Key**: `X-API-Key: <your-api-key>` — set in `.env`

---

## Webhook Payload

Every event is forwarded as JSON POST to your webhook URL:

```json
{
  "event": "message.text",
  "session_id": "wb_abc123",
  "timestamp": "2025-01-01T12:00:00.000Z",
  "message_id": "3EB0...",
  "chat_id": "15551234567@s.whatsapp.net",
  "phone": "15551234567",
  "group_id": null,
  "group_name": null,
  "sender_name": "John Doe",
  "sender_number": "15551234567",
  "is_group": false,
  "is_broadcast": false,
  "is_status": false,
  "is_from_me": false,
  "message_type": "conversation",
  "quoted_message": null,
  "mentions": [],
  "text": "Hello!",
  "caption": null,
  "media": null,
  "forwarded": false,
  "forward_score": 0
}
```

### Media Payload

For image/video/audio/document messages, the `media` field is populated:

```json
{
  "media": {
    "type": "image",
    "url": "http://localhost:3000/uploads/images/uuid.jpg",
    "base64": "iVBORw0KGgo...",
    "mime": "image/jpeg",
    "size": 45312,
    "extension": "jpg",
    "sha256": "abc123..."
  }
}
```

### Webhook Signature

Every request includes `X-WhatsBridge-Signature: sha256=<hmac>`.  
Verify it in n8n using your `WEBHOOK_SECRET`.

---

## Webhook Response — Send Messages Back

If your webhook returns a JSON body, WhatsBridge will send a message to the original chat:

### Text
```json
{ "type": "text", "text": "Hello from n8n!" }
```

### Image
```json
{ "type": "image", "url": "https://example.com/image.jpg", "caption": "Caption" }
```

### Document
```json
{ "type": "document", "url": "https://example.com/file.pdf", "fileName": "report.pdf" }
```

### Audio / Voice Note
```json
{ "type": "voice", "url": "https://example.com/note.ogg" }
```

### Location
```json
{ "type": "location", "latitude": 40.7128, "longitude": -74.0060, "name": "New York" }
```

### Reaction
```json
{ "type": "reaction", "emoji": "👍", "key": { "id": "...", "remoteJid": "..." } }
```

---

## Session Management

- **Persistent login** — auth state stored in `sessions/<id>/` directory
- **Auto-reconnect** — exponential backoff up to 10 attempts (3s → 60s cap)
- **Auto-restore** — on server restart, all previously connected sessions reconnect automatically
- **Multi-session** — run unlimited concurrent WhatsApp numbers
- **Multi-device** — uses Baileys multi-device protocol (no legacy)

---

## Event Types

| Event | Description |
|---|---|
| `message.text` | Plain text or extended text with link preview |
| `message.image` | Image with optional caption |
| `message.video` | Video with optional caption |
| `message.audio` | Audio file |
| `message.audio` (ptt=true) | Voice note |
| `message.document` | Any document/file |
| `message.sticker` | Sticker (webp) |
| `message.contact` | Contact card |
| `message.location` | Static location |
| `message.live_location` | Live location share |
| `message.poll` | Poll creation |
| `message.poll_update` | Poll vote |
| `message.reaction` | Emoji reaction |
| `message.deleted` | Message deletion |
| `message.edited` | Message edit |
| `message.buttons` | Button message |
| `message.list` | List message |
| `group.update` | Group metadata change |
| `group.participants.add` | Member added |
| `group.participants.remove` | Member removed |
| `group.participants.promote` | Member promoted to admin |
| `group.participants.demote` | Admin demoted |
| `call` | Incoming call |
| `session.connected` | Session connected |
| `session.logged_out` | Session logged out |
| `webhook.test` | Webhook test ping |

---

## Project Structure

```
whatsbridge/
├── server.js                  # Entry point
├── .env                       # Environment config
├── src/
│   ├── config/index.js        # All config from env
│   ├── database/
│   │   ├── connection.js      # MongoDB connection
│   │   └── models/            # Mongoose models
│   ├── services/
│   │   ├── WhatsAppService.js # Baileys core (sessions, events, send)
│   │   ├── WebhookService.js  # Webhook delivery with retry
│   │   ├── MediaService.js    # Media download
│   │   ├── SessionService.js  # Session DB operations
│   │   └── QueueService.js    # BullMQ / in-memory queues
│   ├── events/
│   │   ├── connectionHandler.js
│   │   ├── messageHandler.js
│   │   └── groupHandler.js
│   ├── socket/
│   │   └── SocketManager.js   # Socket.io real-time bridge
│   ├── controllers/           # Express route handlers
│   ├── routes/                # Route definitions
│   ├── middlewares/           # Auth, rate limit, validation, errors
│   └── utils/                 # Logger, crypto, helpers, normalizer
├── public/                    # Dashboard SPA
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── sessions/                  # Baileys auth state (auto-created)
├── uploads/                   # Downloaded media (auto-created)
└── logs/                      # Application logs (auto-created)
```

---

## Security

- **JWT** for dashboard authentication
- **API Key** for external integrations (n8n, etc.)
- **Webhook signature** — `X-WhatsBridge-Signature: sha256=<hmac>`
- **Helmet** — HTTP security headers
- **Rate limiting** — per-IP request throttling
- **Input validation** — Joi schemas on all inputs
- **CORS** — configurable allowed origins

---

## License

MIT
