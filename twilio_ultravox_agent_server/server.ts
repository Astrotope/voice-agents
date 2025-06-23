import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import fetch from 'node-fetch';
import twilio from 'twilio';

config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Add URL encoded parsing for Twilio

// Twilio client for call management
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Types
interface BookingSlot {
  date: string;
  time: string;
  available: boolean;
  maxPartySize: number;
}

interface Booking {
  id: string;
  customerName: string;
  date: string;
  time: string;
  partySize: number;
  specialRequirements?: string;
  phone?: string;
  createdAt: Date;
}

// Mock data storage
const bookings: Booking[] = [];
const dailySpecials = {
  soup: "Tuscan White Bean Soup with rosemary and pancetta",
  meal: "Pan-Seared Salmon with lemon herb risotto and seasonal vegetables"
};

// Restaurant opening hours
const openingHours = {
  monday: { open: "17:00", close: "22:00", closed: false },
  tuesday: { open: "17:00", close: "22:00", closed: false },
  wednesday: { open: "17:00", close: "22:00", closed: false },
  thursday: { open: "17:00", close: "22:00", closed: false },
  friday: { open: "17:00", close: "23:00", closed: false },
  saturday: { open: "17:00", close: "23:00", closed: false },
  sunday: { open: "17:00", close: "22:00", closed: false }
};

// Human agent contact info
const humanAgentNumber = process.env.HUMAN_AGENT_PHONE || "+1234567890";

// Active calls tracking (like in the advanced example)
const activeCalls = new Map();

// Generate available time slots (mock booking system)
function generateAvailableSlots(date: string): BookingSlot[] {
  const slots: BookingSlot[] = [];
  const times = [
    "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM", "7:00 PM", 
    "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM", "9:30 PM"
  ];
  
  // Mock availability - some slots randomly unavailable
  times.forEach(time => {
    const isAvailable = Math.random() > 0.3; // 70% chance available
    slots.push({
      date,
      time,
      available: isAvailable,
      maxPartySize: isAvailable ? (Math.random() > 0.5 ? 8 : 6) : 0
    });
  });
  
  return slots;
}

// Check if restaurant is currently open
function isRestaurantOpen(): { isOpen: boolean; nextOpenTime?: string; message: string } {
  const now = new Date();
  const currentDay = now.toLocaleDateString('en-US', { weekday: 'lowercase' }) as keyof typeof openingHours;
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
  
  const todayHours = openingHours[currentDay];
  
  if (todayHours.closed) {
    return {
      isOpen: false,
      message: `We're closed today (${currentDay}). Our regular hours are Tuesday through Sunday, five PM to ten PM (eleven PM on weekends).`
    };
  }
  
  const isOpen = currentTime >= todayHours.open && currentTime <= todayHours.close;
  
  if (isOpen) {
    return {
      isOpen: true,
      message: `We're currently open until ${formatTime(todayHours.close)} today.`
    };
  } else if (currentTime < todayHours.open) {
    return {
      isOpen: false,
      nextOpenTime: todayHours.open,
      message: `We're currently closed but will open at ${formatTime(todayHours.open)} today.`
    };
  } else {
    return {
      isOpen: false,
      message: `We're closed for today. We'll reopen tomorrow at ${formatTime(todayHours.open)}.`
    };
  }
}

// Format time for natural speech
function formatTime(time: string): string {
  const [hour, minute] = time.split(':');
  const hourNum = parseInt(hour);
  const ampm = hourNum >= 12 ? 'PM' : 'AM';
  const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
  return minute === '00' ? `${displayHour} ${ampm}` : `${displayHour}:${minute} ${ampm}`;
}

// Tool implementations with improved structure following advanced example
const toolsBaseUrl = process.env.BASE_URL || 'http://localhost:3000';

const tools = [
  {
    modelToolName: "checkAvailability",
    description: "Check available reservation times for a specific date and party size",
    dynamicParameters: [
      {
        name: "date",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Date in YYYY-MM-DD format or natural language like 'tomorrow', 'next Friday'"
        },
        required: true
      },
      {
        name: "partySize",
        location: "PARAMETER_LOCATION_BODY", 
        schema: {
          type: "number",
          description: "Number of people in the party",
          minimum: 1,
          maximum: 12
        },
        required: true
      }
    ],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/check-availability`,
      httpMethod: "POST"
    }
  },
  {
    modelToolName: "makeReservation",
    description: "Create a restaurant reservation with all required details",
    dynamicParameters: [
      {
        name: "customerName",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Full name of the customer making the reservation"
        },
        required: true
      },
      {
        name: "date",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string", 
          description: "Date for the reservation in YYYY-MM-DD format"
        },
        required: true
      },
      {
        name: "time",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Time for the reservation (e.g., '7:30 PM')"
        },
        required: true
      },
      {
        name: "partySize",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "number",
          description: "Number of people in the party",
          minimum: 1,
          maximum: 12
        },
        required: true
      },
      {
        name: "specialRequirements",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Any special requirements or requests"
        },
        required: false
      }
    ],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/make-reservation`,
      httpMethod: "POST"
    }
  },
  {
    modelToolName: "getDailySpecials",
    description: "Get today's soup and meal specials",
    dynamicParameters: [],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/daily-specials`,
      httpMethod: "GET"
    }
  },
  {
    modelToolName: "checkOpeningHours",
    description: "Check if the restaurant is currently open and get opening hours information",
    dynamicParameters: [],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/opening-hours`,
      httpMethod: "GET"
    }
  },
  {
    modelToolName: "transferCall",
    description: "Transfer the call to a human booking agent when requested by the customer",
    automaticParameters: [
      {
        name: "callId", 
        location: "PARAMETER_LOCATION_BODY",
        knownValue: "KNOWN_PARAM_CALL_ID"
      }
    ],
    dynamicParameters: [
      {
        name: "reason",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Reason for the transfer"
        },
        required: true
      },
      {
        name: "customerName",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Customer's name for the transfer"
        },
        required: false
      },
      {
        name: "summary",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Brief summary of the conversation so far"
        },
        required: false
      }
    ],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/transfer-call`,
      httpMethod: "POST"
    }
  }
];

// Tool endpoints
app.post('/tools/check-availability', (req, res) => {
  try {
    const { date, partySize = 1 } = req.body;
    
    if (!date) {
      return res.status(400).json({ error: "Date is required" });
    }

    // Parse natural language dates
    let searchDate = date;
    const today = new Date();
    
    if (date.toLowerCase() === 'today') {
      searchDate = today.toISOString().split('T')[0];
    } else if (date.toLowerCase() === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      searchDate = tomorrow.toISOString().split('T')[0];
    }

    const availableSlots = generateAvailableSlots(searchDate)
      .filter(slot => slot.available && slot.maxPartySize >= partySize);

    if (availableSlots.length === 0) {
      res.json({
        success: false,
        message: `Unfortunately, we don't have any availability for ${partySize} ${partySize === 1 ? 'person' : 'people'} on ${searchDate}. Would you like to try a different date?`,
        availableSlots: []
      });
    } else {
      res.json({
        success: true,
        message: `Great! I found ${availableSlots.length} available ${availableSlots.length === 1 ? 'time' : 'times'} for ${partySize} ${partySize === 1 ? 'person' : 'people'} on ${searchDate}.`,
        date: searchDate,
        partySize,
        availableSlots: availableSlots.map(slot => ({
          time: slot.time,
          maxPartySize: slot.maxPartySize
        }))
      });
    }

    res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({ error: "Sorry, I'm having trouble checking availability right now. Please try again." });
  }
});

app.post('/tools/make-reservation', (req, res) => {
  try {
    const { customerName, date, time, partySize, specialRequirements } = req.body;
    
    // Validate required fields
    if (!customerName || !date || !time || !partySize) {
      return res.status(400).json({ 
        error: "Customer name, date, time, and party size are all required to make a reservation." 
      });
    }

    // Business rule validations
    if (partySize > 12) {
      return res.json({
        success: false,
        message: "I'm sorry, but we can only accommodate parties of up to twelve people through our booking system. For larger parties, I'd recommend calling us directly at (555) 123-4567 to speak with our manager about special arrangements."
      });
    }

    if (partySize < 1) {
      return res.json({
        success: false,
        message: "The party size must be at least one person."
      });
    }

    // Check if slot is still available
    const availableSlots = generateAvailableSlots(date);
    const requestedSlot = availableSlots.find(slot => slot.time === time);
    
    if (!requestedSlot || !requestedSlot.available || requestedSlot.maxPartySize < partySize) {
      return res.json({
        success: false,
        message: `I'm sorry, but that time slot is no longer available. Let me check what other times we have available for ${date}.`
      });
    }

    // Create the booking
    const booking: Booking = {
      id: `BV${Date.now()}`,
      customerName,
      date,
      time,
      partySize,
      specialRequirements,
      createdAt: new Date()
    };

    bookings.push(booking);

    const confirmationMessage = `Perfect! I've confirmed your reservation for ${customerName}, party of ${partySize}, on ${date} at ${time}. Your confirmation number is ${booking.id}.${specialRequirements ? ` We've noted your special requirements: ${specialRequirements}.` : ''} We look forward to seeing you at Bella Vista Italian Restaurant!`;

    res.json({
      success: true,
      message: confirmationMessage,
      booking: {
        confirmationNumber: booking.id,
        customerName: booking.customerName,
        date: booking.date,
        time: booking.time,
        partySize: booking.partySize,
        specialRequirements: booking.specialRequirements
      }
    });

    res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  } catch (error) {
    console.error('Error making reservation:', error);
    res.status(500).json({ 
      error: "I apologize, but I'm having trouble processing your reservation right now. Please try again in a moment." 
    });
  }
});

app.get('/tools/daily-specials', (req, res) => {
  try {
    res.json({
      success: true,
      message: `Today's specials are: For soup, we have ${dailySpecials.soup}. And our chef's special meal is ${dailySpecials.meal}.`,
      specials: dailySpecials
    });

    res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  } catch (error) {
    console.error('Error getting daily specials:', error);
    res.status(500).json({ 
      error: "I'm sorry, I can't access today's specials right now. Please ask your server when you arrive." 
    });
  }
});

app.get('/tools/opening-hours', (req, res) => {
  try {
    const openStatus = isRestaurantOpen();
    
    res.json({
      success: true,
      isOpen: openStatus.isOpen,
      message: openStatus.message,
      hours: {
        "Monday through Thursday": "5:00 PM to 10:00 PM",
        "Friday and Saturday": "5:00 PM to 11:00 PM", 
        "Sunday": "5:00 PM to 10:00 PM"
      }
    });

    res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  } catch (error) {
    console.error('Error checking opening hours:', error);
    res.status(500).json({ 
      error: "I'm having trouble checking our hours right now." 
    });
  }
});

app.post('/tools/transfer-call', async (req, res) => {
  try {
    const { callId, reason, customerName, summary } = req.body;
    console.log(`Request to transfer call with callId: ${callId}`);
    console.log(`Transfer reason: ${reason}`);
    
    if (!callId) {
      return res.status(400).json({ error: "Call ID is required for transfer" });
    }

    const result = await transferActiveCall(callId);
    res.json(result);
    
  } catch (error) {
    console.error('Error transferring call:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to transfer call',
      error: error.message
    });
  }
});

app.post('/tools/change-stage', (req, res) => {
  try {
    const { newStage, context } = req.body;
    
    let systemPrompt: string;
    let tools: string[] = [];
    
    switch (newStage) {
      case 'greeting':
        systemPrompt = `You are Sofia, a warm and professional AI host for Bella Vista Italian Restaurant. You're in the greeting stage of the call. Warmly welcome the customer, introduce yourself, explain that you're an AI agent helping because lines get busy during service, and mention call recording. Get their name and ask how you can help them today.`;
        tools = ['changeCallStage', 'checkOpeningHours'];
        break;
        
      case 'booking':
        systemPrompt = `You are Sofia, helping with restaurant reservations. You're in the booking stage. Focus on gathering: date, time preference, and party size. Use checkAvailability to find options, then makeReservation to confirm. Ask about special requirements. Be efficient but friendly.`;
        tools = ['checkAvailability', 'makeReservation', 'changeCallStage', 'transferToHuman'];
        break;
        
      case 'menu_consultation':
        systemPrompt = `You are Sofia, helping customers understand our menu. Use the RAG tool to answer questions about menu items, dietary restrictions, and ingredients. Offer daily specials. Guide them back to booking when ready.`;
        tools = ['queryCorpus', 'getDailySpecials', 'changeCallStage'];
        break;
        
      case 'confirmation':
        systemPrompt = `You are Sofia, finalizing the customer's reservation. Confirm all details clearly: name, date, time, party size, special requirements. Provide confirmation number. Ask if they need anything else or want to hear about specials.`;
        tools = ['changeCallStage', 'getDailySpecials', 'hangUp'];
        break;
        
      case 'human_transfer':
        systemPrompt = `You are Sofia, preparing to transfer the customer to a human agent. Explain the transfer, set expectations about availability during service hours, and gather any final information that would help the human agent.`;
        tools = ['transferToHuman', 'checkOpeningHours'];
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid stage specified' });
    }
    
    // Return new stage configuration
    res.json({
      systemPrompt,
      selectedTools: tools.map(toolName => ({ toolName })),
      voice: "Jessica",
      temperature: 0.3
    });
    
    res.setHeader('X-Ultravox-Response-Type', 'new-stage');
    res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
    
  } catch (error) {
    console.error('Error changing call stage:', error);
    res.status(500).json({ 
      error: "I'm having trouble with the conversation flow right now." 
    });
  }
});

// Ultravox webhook handler for Twilio
app.post('/webhook/twilio', async (req, res) => {
  try {
    console.log('Received Twilio webhook:', req.body);
    
    // Create agent call with Ultravox
    const agentCall = await createUltravoxCall();
    
    if (!agentCall.success) {
      console.error('Failed to create Ultravox call:', agentCall.error);
      return res.status(500).json({ error: 'Failed to create voice agent call' });
    }

    // Return TwiML response to connect to Ultravox
    const twimlResponse = `
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="${agentCall.streamUrl}" />
        </Connect>
      </Response>
    `;

    res.type('text/xml');
    res.send(twimlResponse);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Ultravox utility functions (following the advanced example pattern)
async function createUltravoxCall(callConfig) {
  try {
    const response = await fetch('https://api.ultravox.ai/api/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.ULTRAVOX_API_KEY!
      },
      body: JSON.stringify(callConfig)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ultravox API error: ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating Ultravox call:', error);
    throw error;
  }
}

// Enhanced transfer function following the advanced example
async function transferActiveCall(ultravoxCallId: string) {
  try {
    const callData = activeCalls.get(ultravoxCallId);
    if (!callData || !callData.twilioCallSid) {
      throw new Error('Call not found or invalid CallSid');
    }

    const openStatus = isRestaurantOpen();
    let message: string;
    
    if (openStatus.isOpen) {
      message = "I'm connecting you with our booking team. Please note that during busy serving hours, there may be a brief wait as our staff is focused on providing excellent service to our dining guests.";
    } else {
      message = "I'm attempting to connect you with our booking team. Since we're currently closed, there may be no immediate answer. Please try calling back during our regular hours if no one is available.";
    }

    // Create TwiML for transfer
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'Polly.Joanna' }, message);
    const dial = twiml.dial({ timeout: 30 });
    dial.number(humanAgentNumber);
    twiml.say({ voice: 'Polly.Joanna' }, 
      "I'm sorry, but I wasn't able to connect you with our booking team right now. Please try calling back during our regular business hours. Thank you for calling Bella Vista!");

    // Update the active call with transfer TwiML
    const updatedCall = await twilioClient.calls(callData.twilioCallSid)
      .update({
        twiml: twiml.toString()
      });

    return {
      status: 'success',
      message: 'Call transfer initiated',
      callDetails: updatedCall
    };

  } catch (error) {
    console.error('Error transferring call:', error);
    throw {
      status: 'error',
      message: 'Failed to transfer call',
      error: error.message
    };
  }
}

app.post('/tools/change-stage', (req, res) => {
  try {
    const { newStage, context } = req.body;
    
    let systemPrompt: string;
    let tools: string[] = [];
    
    switch (newStage) {
      case 'greeting':
        systemPrompt = `You are Sofia, a warm and professional AI host for Bella Vista Italian Restaurant. You're in the greeting stage of the call. Warmly welcome the customer, introduce yourself, explain that you're an AI agent helping because lines get busy during service, and mention call recording. Get their name and ask how you can help them today.`;
        tools = ['checkOpeningHours'];
        break;
        
      case 'booking':
        systemPrompt = `You are Sofia, helping with restaurant reservations. You're in the booking stage. Focus on gathering: date, time preference, and party size. Use checkAvailability to find options, then makeReservation to confirm. Ask about special requirements. Be efficient but friendly.`;
        tools = ['checkAvailability', 'makeReservation', 'transferCall'];
        break;
        
      case 'menu_consultation':
        systemPrompt = `You are Sofia, helping customers understand our menu. Use the RAG tool to answer questions about menu items, dietary restrictions, and ingredients. Offer daily specials. Guide them back to booking when ready.`;
        tools = ['queryCorpus', 'getDailySpecials'];
        break;
        
      case 'confirmation':
        systemPrompt = `You are Sofia, finalizing the customer's reservation. Confirm all details clearly: name, date, time, party size, special requirements. Provide confirmation number. Ask if they need anything else or want to hear about specials.`;
        tools = ['getDailySpecials', 'hangUp'];
        break;
        
      case 'human_transfer':
        systemPrompt = `You are Sofia, preparing to transfer the customer to a human agent. Explain the transfer, set expectations about availability during service hours, and gather any final information that would help the human agent.`;
        tools = ['transferCall', 'checkOpeningHours'];
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid stage specified' });
    }
    
    // Return new stage configuration
    res.json({
      systemPrompt,
      selectedTools: tools.map(toolName => ({ toolName })),
      voice: "Jessica",
      temperature: 0.3
    });
    
    res.setHeader('X-Ultravox-Response-Type', 'new-stage');
    res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
    
  } catch (error) {
    console.error('Error changing call stage:', error);
    res.status(500).json({ 
      error: "I'm having trouble with the conversation flow right now." 
    });
  }
});

// Get all bookings (for admin/testing)
app.get('/bookings', (req, res) => {
  res.json({ bookings });
});

// Get active calls (following advanced example pattern)
app.get('/active-calls', (req, res) => {
  const calls = Array.from(activeCalls.entries()).map(([ultravoxCallId, data]) => ({
    ultravoxCallId,
    ...data
  }));
  res.json(calls);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
  console.log(`🍝 Restaurant booking server running on port ${port}`);
  console.log(`📞 Webhook endpoint: http://localhost:${port}/webhook/twilio`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log(`📊 Active calls: http://localhost:${port}/active-calls`);
  
  if (!process.env.ULTRAVOX_API_KEY) {
    console.warn('⚠️  ULTRAVOX_API_KEY environment variable not set!');
  }
  
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('⚠️  Twilio credentials not set!');
  }
});

export default app;API-Key': process.env.ULTRAVOX_API_KEY!
      }
    });
    
    if (listResponse.ok) {
      const agents = await listResponse.json();
      const existingAgent = agents.results?.find((agent: any) => agent.name === agentName);
      if (existingAgent) {
        console.log('Using existing agent:', existingAgent.agentId);
        return existingAgent.agentId;
      }
    }
  } catch (error) {
    console.log('Could not check for existing agents, creating new one');
  }

  // Create new agent
  const systemPrompt = `You are Sofia, a friendly and professional AI host for Bella Vista Italian Restaurant. You help customers make reservations and answer questions about our menu.

IMPORTANT GUIDELINES:
- Always greet customers warmly and introduce yourself as Sofia, the AI Voice Agent for Bella Vista
- Explain that we use AI agents because our lines get very busy during serving hours while our staff focuses on providing excellent service to dining guests
- Mention that calls are recorded to help improve our service quality
- Get the customer's name early and use it throughout the conversation
- Use natural speech forms (say "seven thirty PM" not "7:30 PM", "March fifteenth" not "3/15")
- Stay focused on booking reservations and answering menu questions
- Be warm, professional, and helpful like a great restaurant host

CONVERSATION STAGES:
You can transition between different conversation stages when appropriate:
- GREETING: Welcome, introduction, name collection
- BOOKING: Reservation details and confirmation  
- MENU_CONSULTATION: Menu questions and daily specials
- CONFIRMATION: Final reservation confirmation
- HUMAN_TRANSFER: Connect to human agent when needed

HUMAN TRANSFER:
If customers request to speak with a human or if you encounter complex requests:
- Use the transferToHuman tool
- Explain that during serving hours, staff may be busy with dining guests
- Set appropriate expectations about response times
- Always offer transfer if the customer seems frustrated or has special needs

CONVERSATION FLOW:
1. Warm greeting and AI agent introduction with explanation
2. Mention call recording for service improvement  
3. Get customer's name and greet them personally
4. Ask how you can help them today
5. For bookings: gather date, time preference, party size
6. Check availability and offer alternatives if needed
7. Confirm all details before making reservation
8. Ask about special requirements (dietary, accessibility, celebrations)
9. Provide confirmation number and restaurant details
10. Offer human transfer if needed

TOOLS AVAILABLE:
- checkOpeningHours: Check if we're currently open and get hours
- checkAvailability: Check reservation times for specific dates
- makeReservation: Create confirmed reservations
- getDailySpecials: Get soup and meal of the day
- queryCorpus: Answer menu questions and dietary information
- transferToHuman: Connect to human booking agent
- changeCallStage: Move to different conversation phases
- hangUp: End call when customer is finished

SPECIAL SITUATIONS:
- Large parties (8+): Still process but mention they may need manager confirmation
- Complex dietary needs: Use queryCorpus for detailed information
- Busy times: Explain our hours and suggest optimal calling times
- Technical issues: Offer human transfer as alternative

Always speak naturally and conversationally, use the customer's name, confirm all booking details clearly, and provide excellent hospitality that reflects our restaurant's values.`;

  try {
    const response = await fetch('https://api.ultravox.ai/api/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.ULTRAVOX_API_KEY!
      },
      body: JSON.stringify({
        name: agentName,
        callTemplate: {
          systemPrompt,
          voice: "Jessica",
          languageHint: "en",
          temperature: 0.3,
          recordingEnabled: true,
          selectedTools: [
            { 
              toolName: "queryCorpus", 
              authTokens: {},
              parameterOverrides: {
                corpusId: process.env.ULTRAVOX_CORPUS_ID || "your_corpus_id_here"
              }
            },
            { toolName: "hangUp" },
            ...tools.map(tool => ({ temporaryTool: tool }))
          ],
          inactivityMessages: [
            {
              duration: "30s",
              message: "Are you still there? I'm here to help with your reservation."
            },
            {
              duration: "15s", 
              message: "If there's nothing else I can help you with, I'll end our call."
            },
            {
              duration: "10s",
              message: "Thank you for calling Bella Vista Italian Restaurant. Have a wonderful day! Goodbye.",
              endBehavior: "END_BEHAVIOR_HANG_UP_SOFT"
            }
          ]
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create agent: ${error}`);
    }

    const agent = await response.json();
    console.log('Created new agent:', agent.agentId);
    return agent.agentId;
  } catch (error) {
    console.error('Error creating agent:', error);
    throw error;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Get all bookings (for admin/testing)
app.get('/bookings', (req, res) => {
  res.json({ bookings });
});

// Start server
app.listen(port, () => {
  console.log(`🍝 Restaurant booking server running on port ${port}`);
  console.log(`📞 Webhook endpoint: http://localhost:${port}/webhook/twilio`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  
  if (!process.env.ULTRAVOX_API_KEY) {
    console.warn('⚠️  ULTRAVOX_API_KEY environment variable not set!');
  }
});

export default app;
