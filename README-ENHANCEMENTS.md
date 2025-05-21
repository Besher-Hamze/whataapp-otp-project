# WhatsApp Bot with Scheduling, Delays, and Auto-Responses

This project is a NestJS-based WhatsApp automation system that allows for message scheduling, controlled delays between messages, and auto-responses to incoming messages.

## Key Features Added

### 1. Message Delays
- Configurable delays between messages (default: 5 seconds)
- Prevents rate limiting issues with WhatsApp
- Smoother message delivery for bulk messages

### 2. Message Scheduling
- Schedule messages to be sent at a specific time
- Associate scheduled messages with specific WhatsApp accounts
- Cron-based job processing
- Support for multiple recipients with configurable delays

### 3. Auto-Responder System
- Create keyword-based rules for auto-responding
- Incoming message matching against rules
- Automatic responses with customizable content
- User-specific rules

## How to Use

### Scheduling Messages
Use the `/schedules` API endpoints to create, view, update, and delete scheduled messages.

Example:
```json
POST /schedules
{
  "message": "Hello, this is a scheduled message!",
  "recipients": ["1234567890", "0987654321"],
  "scheduledTime": "2025-06-01T12:00:00Z",
  "whatsappAccountId": "65f1a2b3c4d5e6f7g8h9i0j",
  "messageDelayMs": 5000
}
```

### Sending Messages with Delay
Use the `/whatsapp/send-message` endpoint with an optional `delay` parameter.

Example:
```json
POST /whatsapp/send-message?delay=5000
{
  "to": ["1234567890", "0987654321"],
  "message": "Hello, this message was sent with a 5-second delay between recipients!"
}
```

### Creating Auto-Response Rules
Use the `/rules` API endpoints to create, view, update, and delete auto-response rules.

Example:
```json
POST /rules
{
  "keyword": "hello",
  "response": "Hello there! Thanks for your message. I'll get back to you soon."
}
```

## Technical Improvements

1. **Enhanced Error Handling**: Better error tracking and reporting
2. **Logging System**: Comprehensive logging for troubleshooting
3. **Client State Management**: Track client readiness and prevent overlapping operations
4. **User-Specific Data**: Rules, schedules, and accounts are associated with specific users
5. **Modular Architecture**: Clear separation of concerns between components

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with appropriate MongoDB settings
4. Start the application: `npm run start:dev`
5. Access the API at `http://localhost:3000`

## Authentication

All endpoints require JWT authentication. Obtain a token via the `/auth/login` endpoint.
