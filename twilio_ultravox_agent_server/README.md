# Bella Vista Restaurant AI Voice Agent

A sophisticated AI voice agent for restaurant reservations built with Ultravox, Twilio, and Express. Sofia, our AI host, handles reservations, answers menu questions, and seamlessly transfers complex requests to human staff.

## 🎯 Key Features

- **Intelligent Reservation Management**: Check availability and create bookings with smart scheduling
- **Menu Intelligence**: RAG-powered answers using queryCorpus for accurate menu information
- **Smart Human Transfer**: Seamless handoff to human agents with automatic call ID injection
- **Operating Hours Awareness**: Context-aware responses based on restaurant hours
- **Professional Service Standards**: Hospitality-focused conversation flow with named personality
- **Advanced Call Management**: Direct call creation pattern following Ultravox best practices

## 🏗️ Architecture

### Direct Call Creation Pattern
Following the advanced Ultravox example, the system uses direct call creation without pre-configured agents:
- **Simplified Flow**: Each call created with full inline configuration
- **Enhanced Reliability**: Fewer API dependencies, more robust operation
- **Easy Debugging**: All configuration visible in webhook handler
- **Advanced Tool Structure**: Uses `modelToolName` with automatic parameters

### Call State Management
```typescript
// Active calls mapping (like in advanced example)
const activeCalls = new Map();

// Store call relationships for transfers
activeCalls.set(response.callId, {
  twilioCallSid: twilioCallSid,
  timestamp: new Date().toISOString()
});
```

### Enhanced Tool Configuration
```typescript
const tools = [
  {
    modelToolName: "transferCall",
    description: "Transfer the call to a human booking agent",
    automaticParameters: [
      {
        name: "callId", 
        location: "PARAMETER_LOCATION_BODY",
        knownValue: "KNOWN_PARAM_CALL_ID"  // Automatic call ID injection
      }
    ],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/transfer-call`,
      httpMethod: "POST"
    }
  }
];
```

## 🛠️ Setup & Configuration

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Ultravox Configuration
ULTRAVOX_API_KEY=your_ultravox_api_key_here
ULTRAVOX_CORPUS_ID=your_corpus_id_for_menu_data

# Twilio Configuration  
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# System Configuration
PORT=3000
BASE_URL=https://ultravox.sliplane.app
HUMAN_AGENT_PHONE=+1234567890

# Admin API Configuration
ADMIN_API_KEY=bella-vista-your_generated_key_here

# Call Management
MAX_CONCURRENT_CALLS=5                   # Maximum simultaneous calls
CALL_CLEANUP_INTERVAL=300000             # Call cleanup interval (5 minutes)

# Agent Configuration
AGENT_NAME=Sofia                         # AI agent's name
ULTRAVOX_VOICE=Steve-English-Australian  # Voice for Ultravox calls
TWILIO_VOICE=Polly.Aria-Neural           # Voice for Twilio announcements

# Environment
NODE_ENV=production                      # development | production

```

### Admin API Key Generation

Generate a secure admin API key:

```bash
echo "bella-vista-$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")"
```

Example output: `bella-vista-xK8mP9vN2wQ7rS4tU5yV6zA3bC1dE2fG`

### Installation

```bash
npm install
npm run dev
```

### Development & Testing Options

#### Option 1: Local Development with npm
```bash
npm run dev
```

#### Option 2: Docker Development
```bash
# Build the container
docker build -t restaurant-voice-agent .

# Run with environment file
docker run -p 3000:3000 --env-file .env restaurant-voice-agent
```

#### Option 3: Local Development with ngrok
```bash
# Start your server
npm run dev

# In another terminal, expose your server  
ngrok http 3000

# Copy the HTTPS URL to BASE_URL in your .env file
```

### System Startup Confirmation

When the server starts successfully, you'll see:

```
🍝 Restaurant booking server running on port 3000
📞 Webhook endpoint: http://localhost:3000/webhook/twilio
📡 Stream status: http://localhost:3000/webhook/stream-status
🚨 Error webhook: http://localhost:3000/webhook/twilio-errors
🏥 Health check: http://localhost:3000/health
📊 Active calls: http://localhost:3000/active-calls (requires API key)
📈 Metrics: http://localhost:3000/metrics (requires API key)
⚙️  Configuration: http://localhost:3000/config (requires API key)
👤 Agent: Sofia
🗣️  Ultravox Voice: Steve-English-Australian
📞 Twilio Voice: Polly.Aria-Neural
🔢 Max Concurrent Calls: 5
🔐 Admin endpoints require X-API-Key header
```

## 🤖 AI System Prompt & Behavior

### Enhanced System Prompt Features

**Core Personality**: Sofia - Friendly, professional AI host for Bella Vista Italian Restaurant

**Key Behavioral Guidelines**:
- Warm greeting with AI agent introduction and explanation
- Call recording notification for service improvement  
- Early name collection for personalized service
- Natural speech patterns (e.g., "seven thirty PM" not "7:30 PM")
- Immediate response after tool usage (critical for user experience)

**Advanced Tool Response Requirements**:
- **checkAvailability**: Immediately announce available times or alternatives
- **makeReservation**: Instantly confirm booking with confirmation number
- **getDailySpecials**: Promptly share soup and meal specials
- **checkOpeningHours**: Quickly communicate current status and hours
- **queryCorpus**: Immediately share discovered menu/policy information
- **transferCall**: Seamless handoff with automatic call ID injection

## 🔧 API Endpoints

### Public Tool Endpoints

#### Check Availability
```bash
POST /tools/check-availability
Content-Type: application/json

{
  "date": "2024-03-15",
  "partySize": 4
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "Great! I found 3 available times for 4 people on 2024-03-15.",
  "date": "2024-03-15",
  "partySize": 4,
  "availableSlots": [
    {
      "time": "7:00 PM",
      "maxPartySize": 8
    },
    {
      "time": "8:30 PM", 
      "maxPartySize": 6
    }
  ]
}
```

#### Make Reservation
```bash
POST /tools/make-reservation
Content-Type: application/json

{
  "customerName": "John Smith",
  "date": "2024-03-15",
  "time": "7:00 PM",
  "partySize": 4,
  "specialRequirements": "Window table preferred"
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "Perfect! I've confirmed your reservation for John Smith, party of 4, on 2024-03-15 at 7:00 PM. Your confirmation number is BV1710504000000.",
  "booking": {
    "confirmationNumber": "BV1710504000000",
    "customerName": "John Smith",
    "date": "2024-03-15",
    "time": "7:00 PM",
    "partySize": 4,
    "specialRequirements": "Window table preferred"
  }
}
```

#### Get Daily Specials
```bash
GET /tools/daily-specials
```

**Response Example:**
```json
{
  "success": true,
  "message": "Today's specials are: For soup, we have Tuscan White Bean Soup with rosemary and pancetta. And our chef's special meal is Pan-Seared Salmon with lemon herb risotto and seasonal vegetables.",
  "specials": {
    "soup": "Tuscan White Bean Soup with rosemary and pancetta",
    "meal": "Pan-Seared Salmon with lemon herb risotto and seasonal vegetables"
  }
}
```

#### Check Opening Hours
```bash
GET /tools/opening-hours
```

**Response Example:**
```json
{
  "success": true,
  "isOpen": true,
  "message": "We're currently open until 10 PM today.",
  "hours": {
    "Monday through Thursday": "5:00 PM to 10:00 PM",
    "Friday and Saturday": "5:00 PM to 11:00 PM", 
    "Sunday": "5:00 PM to 10:00 PM"
  }
}
```

#### Transfer Call (Advanced Feature)
```bash
POST /tools/transfer-call
Content-Type: application/json

{
  "callId": "ultravox_call_id_auto_injected",
  "reason": "Customer requests manager for special event planning",
  "customerName": "Jane Doe",
  "summary": "Customer wants to book private dining for 20 people"
}
```

**Response Example:**
```json
{
  "status": "success",
  "message": "Call transfer initiated",
  "callDetails": {
    "transferredTo": "+1234567890",
    "transferMessage": "Transferring you to our booking specialist...",
    "timestamp": "2024-03-15T19:30:00.000Z"
  }
}
```

### Admin Endpoints (Require API Key)

All admin endpoints require the `X-API-Key` header:

```bash
X-API-Key: bella-vista-xK8mP9vN2wQ7rS4tU5yV6zA3bC1dE2fG
```

#### View All Bookings
```bash
GET /bookings
X-API-Key: your_admin_api_key
```

**Response Example:**
```json
{
  "bookings": [
    {
      "id": "BV1710504000000",
      "customerName": "John Smith",
      "date": "2024-03-15",
      "time": "7:00 PM",
      "partySize": 4,
      "specialRequirements": "Window table preferred",
      "createdAt": "2024-03-15T19:00:00.000Z"
    }
  ]
}
```

#### Monitor Active Calls
```bash
GET /active-calls
X-API-Key: your_admin_api_key
```

**Response Example:**
```json
[
  {
    "ultravoxCallId": "call_abc123",
    "twilioCallSid": "CA1234567890abcdef",
    "timestamp": "2024-03-15T19:30:00.000Z"
  }
]
```

#### System Metrics
```bash
GET /metrics
X-API-Key: your_admin_api_key
```

**Response Example:**
```json
{
  "activeCalls": 2,
  "maxConcurrentCalls": 5,
  "totalBookings": 47,
  "systemStatus": "healthy",
  "uptime": "2 days, 14 hours, 23 minutes"
}
```

#### System Configuration
```bash
GET /config
X-API-Key: your_admin_api_key
```

**Response Example:**
```json
{
  "agent": "Sofia",
  "ultravoxVoice": "Steve-English-Australian",
  "twilioVoice": "Polly.Aria-Neural",
  "maxConcurrentCalls": 5,
  "humanAgentPhone": "+1234567890",
  "systemStatus": "operational"
}
```

### Public Endpoints

#### Health Check
```bash
GET /health
```

**Response Example:**
```json
{
  "status": "healthy",
  "timestamp": "2024-03-15T19:30:00.000Z",
  "version": "1.0.0"
}
```

### Webhook Endpoints

#### Twilio Webhook
```bash
POST /webhook/twilio
Content-Type: application/x-www-form-urlencoded

CallSid=CA1234567890abcdef
From=+1234567890
To=+0987654321
```

**Response**: TwiML with stream connect to Ultravox

#### Stream Status Webhook
```bash
POST /webhook/stream-status
Content-Type: application/json
```

#### Twilio Error Webhook
```bash
POST /webhook/twilio-errors
Content-Type: application/x-www-form-urlencoded
```

## 🧪 Testing with curl

### Test Tool Endpoints

#### Test Availability Check
```bash
# Local testing
curl -X POST http://localhost:3000/tools/check-availability \
  -H "Content-Type: application/json" \
  -d '{
    "date": "tomorrow",
    "partySize": 2
  }'

# Production testing
curl -X POST https://ultravox.sliplane.app/tools/check-availability \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2024-03-20",
    "partySize": 4
  }'
```

#### Test Reservation Creation
```bash
curl -X POST http://localhost:3000/tools/make-reservation \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Test Customer",
    "date": "2024-03-20",
    "time": "7:30 PM", 
    "partySize": 2,
    "specialRequirements": "Anniversary dinner"
  }'
```

#### Test Daily Specials
```bash
curl -X GET http://localhost:3000/tools/daily-specials
```

#### Test Opening Hours
```bash
curl -X GET http://localhost:3000/tools/opening-hours
```

### Test Admin Endpoints (with API Key)

#### Test Bookings View
```bash
curl -X GET http://localhost:3000/bookings \
  -H "X-API-Key: bella-vista-xK8mP9vN2wQ7rS4tU5yV6zA3bC1dE2fG"
```

#### Test Active Calls Monitoring
```bash
curl -X GET http://localhost:3000/active-calls \
  -H "X-API-Key: bella-vista-xK8mP9vN2wQ7rS4tU5yV6zA3bC1dE2fG"
```

#### Test System Metrics
```bash
curl -X GET http://localhost:3000/metrics \
  -H "X-API-Key: bella-vista-xK8mP9vN2wQ7rS4tU5yV6zA3bC1dE2fG"
```

#### Test System Configuration
```bash
curl -X GET http://localhost:3000/config \
  -H "X-API-Key: bella-vista-xK8mP9vN2wQ7rS4tU5yV6zA3bC1dE2fG"
```

### Test Public Endpoints

#### Test Health Check
```bash
curl -X GET http://localhost:3000/health
```

### Test Error Conditions

#### Missing Required Fields
```bash
curl -X POST http://localhost:3000/tools/make-reservation \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Test",
    "date": "2024-03-20"
  }'
```

#### Invalid Party Size
```bash
curl -X POST http://localhost:3000/tools/check-availability \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2024-03-20",
    "partySize": 15
  }'
```

#### Unauthorized Admin Access
```bash
curl -X GET http://localhost:3000/bookings
# Should return 401 Unauthorized
```

## 🔍 Advanced Features

### Enhanced queryCorpus Integration
```javascript
{
  toolName: "queryCorpus",
  parameterOverrides: {
    corpus_id: process.env.ULTRAVOX_CORPUS_ID,
    max_results: 8  // Comprehensive menu responses
  }
}
```

### Professional TwiML Transfer Logic
```typescript
async function transferActiveCall(ultravoxCallId: string) {
  const callData = activeCalls.get(ultravoxCallId);
  
  // Create context-aware transfer message
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, message);
  const dial = twiml.dial({ timeout: 30 });
  dial.number(humanAgentNumber);
  
  // Update active Twilio call with transfer TwiML
  const updatedCall = await twilioClient.calls(callData.twilioCallSid)
    .update({ twiml: twiml.toString() });
}
```

### Operating Hours Intelligence
- **Real-time Status**: Automatically determines if restaurant is open
- **Context-aware Messaging**: Different responses during service vs. closed hours
- **Professional Communication**: Explains staff availability during busy service

### Call State Management Features
- **Active Call Tracking**: Map between Ultravox calls and Twilio calls
- **Transfer Capability**: Seamless handoff to human agents
- **Error Recovery**: Graceful handling of failed transfers
- **Concurrent Call Limits**: Configurable maximum concurrent calls

## 🐛 Debugging & Monitoring

### Enhanced Logging Features
- **Call Flow Tracking**: Every stage logged with timestamps
- **Transfer Requests**: Detailed logging of transfer attempts
- **Error Context**: Rich error information for debugging
- **Admin Access Logs**: Security monitoring for admin endpoints

### Common Issues & Solutions

**Agent not responding after tool use**:
- Check `X-Ultravox-Agent-Reaction` headers are being set
- Verify tool endpoints return proper JSON responses
- Confirm no early returns before header setting

**Transfer failures**:
- Verify `HUMAN_AGENT_PHONE` environment variable
- Check Twilio credentials and permissions
- Monitor active calls mapping
- Ensure automatic call ID injection is working

**Menu queries not working**:
- Confirm `ULTRAVOX_CORPUS_ID` is set correctly
- Check corpus has been populated with menu data
- Verify corpus parameter name uses underscore: `corpus_id`

**Admin endpoints returning 401**:
- Verify `X-API-Key` header is included
- Check API key format (should start with 'bella-vista-')
- Ensure `ADMIN_API_KEY` environment variable is set

### Log Analysis
```bash
# Watch server logs during development
npm run dev

# Check for specific patterns
grep "endpoint called" logs.txt
grep "Error" logs.txt
grep "Transfer request" logs.txt
grep "Admin access" logs.txt
```

## 📞 Twilio Configuration

### Webhook URL Configuration
Set your Twilio phone number's webhook URL to:

**Production:**
```
https://ultravox.sliplane.app/webhook/twilio
```

**Local Development with ngrok:**
```
https://your-ngrok-url.ngrok-free.app/webhook/twilio
```

**Additional Webhooks:**
- Stream Status: `/webhook/stream-status`
- Error Handling: `/webhook/twilio-errors`

### Required Twilio Permissions
- Voice calls
- TwiML modification  
- Call status updates
- Call recording (if enabled)

## 🚀 Production Deployment

### Production Environment
Your system is deployed on Sliplane.io at:
```
https://ultravox.sliplane.app
```

### Environment Setup
- Production endpoint: `https://ultravox.sliplane.app`
- Configure SSL/TLS certificates (handled by Sliplane)
- Set up proper logging and monitoring
- Configure backup human agent numbers
- Generate and secure admin API keys

### Security Considerations
- Validate Twilio webhook signatures
- Rate limiting for tool endpoints
- Input sanitization for reservation data
- Secure storage of sensitive configuration
- Admin API key protection
- CORS configuration for production

### Performance Optimization
- Connection pooling for database operations
- Efficient active call tracking with Map structure
- Minimal tool response payloads for faster processing
- Concurrent call management
- Memory management for long-running processes

### Production Monitoring
- Health check endpoint for uptime monitoring
- Metrics endpoint for performance tracking
- Active calls monitoring for capacity management
- Error logging and alerting
- Admin access logging for security

---

## 📋 Quick Reference

### Environment Variables Checklist
- [ ] `ULTRAVOX_API_KEY` - Your Ultravox API key
- [ ] `ULTRAVOX_CORPUS_ID` - Menu data corpus ID
- [ ] `TWILIO_ACCOUNT_SID` - Twilio account identifier
- [ ] `TWILIO_AUTH_TOKEN` - Twilio authentication token
- [ ] `BASE_URL` - Your deployment URL
- [ ] `HUMAN_AGENT_PHONE` - Phone number for transfers
- [ ] `ADMIN_API_KEY` - Generated admin API key
- [ ] `MAX_CONCURRENT_CALLS` - Call capacity limit

### API Endpoints Quick Reference
| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `/tools/check-availability` | POST | No | Check reservation times |
| `/tools/make-reservation` | POST | No | Create bookings |
| `/tools/daily-specials` | GET | No | Get menu specials |
| `/tools/opening-hours` | GET | No | Check restaurant hours |
| `/tools/transfer-call` | POST | No | Transfer to human |
| `/bookings` | GET | Yes | View all reservations |
| `/active-calls` | GET | Yes | Monitor active calls |
| `/metrics` | GET | Yes | System performance |
| `/config` | GET | Yes | System configuration |
| `/health` | GET | No | Health check |

For additional support or feature requests, please refer to the Ultravox documentation or contact the development team.
