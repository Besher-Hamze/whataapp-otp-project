# WhatsApp Automation Platform

A comprehensive WhatsApp automation platform built with NestJS, allowing for WhatsApp session management, message scheduling, contact management, templated messages, auto-responses, and more.

## Features

### Core Features
- **WhatsApp Web Integration**: Connect multiple WhatsApp accounts using QR code authentication
- **Message Scheduling**: Schedule messages to be sent at specific times
- **Contact Management**: Organize contacts with groups and tags
- **Message Templates**: Create and use reusable message templates with variables
- **Auto-Responder**: Set up keyword-based automatic responses
- **Group Management**: Create and manage contact groups

### Enhanced Features
- **Message Delays**: Configurable delays between messages to prevent rate limiting
- **Bulk Operations**: Import contacts, send bulk messages with customization
- **Security Features**: Rate limiting, input validation, error handling
- **Template Variables**: Use variables in templates for personalized messages
- **Real-time Updates**: WebSocket support for QR code scanning and status updates
- **User Authentication**: JWT-based secure authentication

## Getting Started

### Prerequisites
- Node.js 16+ and npm
- MongoDB 4.4+
- An internet connection for WhatsApp Web

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/whatsapp-automation-platform.git
cd whatsapp-automation-platform
```

2. Install dependencies

Since there are some peer dependency issues with the latest NestJS version, use the legacy peer deps flag:

```bash
npm install --legacy-peer-deps
```

3. Create a `.env` file in the project root with the following content (or copy from .env.example):
```
# Application
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:4200

# MongoDB
MONGODB_URI=mongodb://localhost:27017/whatsapp-automation

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRATION=1d
JWT_REFRESH_EXPIRATION=7d

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100
```

4. Start the development server
```bash
npm run start:dev
```

### Troubleshooting

#### Common Issues

1. **Dependency Conflicts**:
   - If you encounter dependency conflicts, use `--legacy-peer-deps` flag with npm to resolve them
   - Example: `npm install --legacy-peer-deps`

2. **TypeScript Errors**:
   - If you encounter TypeScript errors about undefined properties or incorrect types, check that you're always handling null/undefined values properly
   - Pay special attention to MongoDB ObjectId handling and document type conversions

3. **MongoDB Connection Issues**:
   - Check that MongoDB is running and accessible
   - Verify your connection string in the .env file
   - For local development, you can use: `MONGODB_URI=mongodb://localhost:27017/whatsapp-automation`

4. **WebSocket Connection Problems**:
   - Check that CORS settings are correctly configured for your frontend application
   - Ensure WebSocket events are properly handled on both server and client

## API Documentation

### Authentication

#### Register
```http
POST /auth/register
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "Password123!",
  "name": "John Doe"
}
```

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "Password123!"
}
```
Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "60d5ec9f82c3a2343c912345",
    "name": "John Doe",
    "username": "user@example.com"
  }
}
```

### WhatsApp Sessions

#### Start Session (WebSocket)
Connect to `/whatsapp` WebSocket endpoint and emit `init` event:
```javascript
socket.emit('init', { token: 'Bearer YOUR_ACCESS_TOKEN' });
```

Socket events:
- `qr`: Provides QR code data for scanning
- `authenticated`: Session authenticated
- `ready`: WhatsApp client is ready
- `disconnected`: Session disconnected
- `error`: Error occurred

#### Send Message
```http
POST /whatsapp/send-message?delay=5000
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "to": ["1234567890", "0987654321"],
  "message": "Hello, this is a test message!"
}
```

### Contacts

#### Create Contact
```http
POST /contacts
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "name": "John Smith",
  "phone_number": "+1234567890",
  "tags": ["client", "vip"]
}
```

#### Get All Contacts
```http
GET /contacts?search=john&page=1&limit=50
Authorization: Bearer YOUR_ACCESS_TOKEN
```

#### Add Contacts to Group
```http
POST /contacts/group/GROUP_ID/add
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "contactIds": ["60d5ec9f82c3a2343c912345", "60d5ec9f82c3a2343c912346"]
}
```

### Message Templates

#### Create Template
```http
POST /templates
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "name": "Welcome Message",
  "content": "Hello {{name}}, welcome to our service! Your account is now {{status}}.",
  "type": "welcome",
  "tags": ["onboarding"]
}
```

#### Render Template
```http
POST /templates/render
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "templateId": "60d5ec9f82c3a2343c912345",
  "variables": {
    "name": "John",
    "status": "active"
  }
}
```

### Scheduling

#### Schedule Message
```http
POST /schedules
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "message": "Your appointment is tomorrow!",
  "recipients": ["1234567890", "0987654321"],
  "scheduledTime": "2025-06-01T12:00:00Z",
  "whatsappAccountId": "60d5ec9f82c3a2343c912345",
  "messageDelayMs": 5000
}
```

#### Get All Schedules
```http
GET /schedules
Authorization: Bearer YOUR_ACCESS_TOKEN
```

### Auto-Responder Rules

#### Create Rule
```http
POST /rules
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "keyword": "pricing",
  "response": "Our pricing starts at $9.99/month. For more details, please visit our website at example.com/pricing"
}
```

#### Get All Rules
```http
GET /rules
Authorization: Bearer YOUR_ACCESS_TOKEN
```

## Architecture

### Core Modules
- **Auth**: Authentication and user management
- **WhatsApp**: WhatsApp Web API integration and session management
- **Contacts**: Contact storage and organization
- **Groups**: Contact grouping
- **Templates**: Message templates with variables
- **Scheduling**: Message scheduling with delays
- **Rules**: Auto-responder rules
- **Messages**: Message history and tracking

### Security Features
- JWT-based authentication
- Rate limiting
- Input validation
- Exception handling
- CORS protection
- Helmet security headers

## Development

### Code Structure
- `src/modules/` - Feature modules
- `src/common/` - Shared functionality
- `src/app.module.ts` - Main application module

### Running Tests
```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## Recent Fixes and Improvements

The following issues have been fixed:

1. Fixed TypeScript errors in the RateLimitInterceptor
2. Added missing methods to the AccountsService (findById, findOne)
3. Fixed array type issues in WhatsAppService for message results
4. Resolved undefined property access in WhatsAppGateway for userSockets
5. Fixed parameter mismatches in GroupsService and ContactsService
6. Corrected possible null issues in SchedulingService and RulesService
7. Improved error handling across all services

## Production Deployment

### Build for Production
```bash
npm run build
```

### Start Production Server
```bash
npm run start:prod
```

For production deployment, consider:
- Using PM2 for process management
- Setting up NGINX as a reverse proxy
- Configuring proper security headers
- Using a proper MongoDB deployment (Atlas or self-hosted with replica sets)

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
This project is licensed under the [MIT License](LICENSE).

## Acknowledgements
- [NestJS](https://nestjs.com/)
- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
- [Mongoose](https://mongoosejs.com/)
- [Socket.io](https://socket.io/)
