import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import fetch from 'node-fetch';
import twilio from 'twilio';
import rateLimit from 'express-rate-limit';
import { EventEmitter } from 'events';
import os from 'os';
import process from 'process';
import { body, validationResult } from 'express-validator';

config();

const app = express();
const port = process.env.PORT || 3000;

// Configuration from environment variables
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || '5');
const AGENT_NAME = process.env.AGENT_NAME || 'Sofia';
const ULTRAVOX_VOICE = process.env.ULTRAVOX_VOICE || 'Steve-English-Australian';
const TWILIO_VOICE = process.env.TWILIO_VOICE || 'Polly.Aria-Neural';
const CALL_CLEANUP_INTERVAL = parseInt(process.env.CALL_CLEANUP_INTERVAL || '300000');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'your-secure-admin-key';

// Constants
const CALL_RETENTION_TIME = 30000; // 30 seconds
const MAX_EVENT_LISTENERS = 100;

// Enhanced debugging flags
const DEBUG_BOOKINGS = true;
const DEBUG_TOOLS = true;
const DEBUG_REQUESTS = true;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Debug middleware to log all requests
if (DEBUG_REQUESTS) {
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`🌐 [${timestamp}] ${req.method} ${req.url}`);
    
    // Log headers for tool endpoints
    if (req.url.startsWith('/tools/')) {
      console.log(`🔧 Headers:`, req.headers);
      console.log(`🔧 Body:`, req.body);
    }
    
    next();
  });
}

// Input validation middleware
const validateWebhookInput = [
  body('CallSid').isString().notEmpty().withMessage('CallSid is required'),
  body('From').optional().isString(),
  body('To').optional().isString()
];

const validateReservationInput = [
  body('customerName').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Valid customer name required'),
  body('date').isString().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be in YYYY-MM-DD format'),
  body('time').isString().notEmpty().withMessage('Time is required'),
  body('partySize').isInt({ min: 1, max: 12 }).withMessage('Party size must be between 1 and 12'),
  body('specialRequirements').optional().isString().isLength({ max: 500 })
];

// Authentication middleware for admin endpoints
const authenticateAdmin = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

// Enhanced rate limiting with multiple strategies
const createRateLimit = (windowMs: number, max: number, message: string) => 
  rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use combination of IP and User-Agent for better tracking
      return `${req.ip}-${req.get('User-Agent')?.slice(0, 50) || 'unknown'}`;
    }
  });

const webhookRateLimit = createRateLimit(
  60 * 1000, 
  MAX_CONCURRENT_CALLS * 3, 
  'Too many call attempts, please try again later'
);

const toolRateLimit = createRateLimit(
  60 * 1000, 
  200, 
  'Too many tool requests, please slow down'
);

const adminRateLimit = createRateLimit(
  60 * 1000, 
  30, 
  'Too many admin requests'
);

// Apply rate limiting
app.use('/webhook/twilio', webhookRateLimit);
app.use('/tools/', toolRateLimit);
app.use(['/metrics', '/config', '/active-calls'], adminRateLimit);

// Twilio client
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

interface ActiveCall {
  twilioCallSid: string;
  timestamp: string;
  status: 'connecting' | 'active' | 'ending' | 'ended';
  lastActivity: Date;
}

interface ServerMetrics {
  totalCalls: number;
  activeCalls: number;
  rejectedCalls: number;
  errors: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  uptime: number;
  toolCalls: {
    checkAvailability: number;
    makeReservation: number;
    dailySpecials: number;
    openingHours: number;
    transferCall: number;
    checkBooking: number; // ADDED: New tool counter
  };
}

// Enhanced call management with semaphore pattern
class CallManager {
  private activeCalls = new Map<string, ActiveCall>();
  private activeCallCount = 0;
  private semaphore = 0; // Track pending call creation
  private events = new EventEmitter();

  constructor() {
    this.events.setMaxListeners(MAX_EVENT_LISTENERS);
    this.setupCleanup();
  }

  // Atomic operation to reserve a call slot
  reserveCallSlot(): boolean {
    if (this.activeCallCount + this.semaphore >= MAX_CONCURRENT_CALLS) {
      return false;
    }
    this.semaphore++;
    return true;
  }

  // Release reserved slot (if call creation failed)
  releaseCallSlot(): void {
    if (this.semaphore > 0) {
      this.semaphore--;
    }
  }

  // Register successful call (converts reservation to active call)
  registerCall(callId: string, twilioCallSid: string): void {
    this.activeCalls.set(callId, {
      twilioCallSid,
      timestamp: new Date().toISOString(),
      status: 'connecting',
      lastActivity: new Date()
    });
    
    this.activeCallCount++;
    if (this.semaphore > 0) {
      this.semaphore--;
    }
    
    this.events.emit('callStarted', callId, twilioCallSid);
    console.log(`📞 Call registered: ${callId} (${this.activeCallCount}/${MAX_CONCURRENT_CALLS})`);
  }

  updateCallStatus(callId: string, status: ActiveCall['status']): void {
    const call = this.activeCalls.get(callId);
    if (call) {
      call.status = status;
      call.lastActivity = new Date();
    }
  }

  endCall(callId: string, reason: string): void {
    const call = this.activeCalls.get(callId);
    if (call && call.status !== 'ended') {
      call.status = 'ended';
      call.lastActivity = new Date();
      this.activeCallCount--;
      
      // Schedule removal after retention period
      setTimeout(() => {
        this.activeCalls.delete(callId);
      }, CALL_RETENTION_TIME);
      
      this.events.emit('callEnded', callId, reason);
      console.log(`📞 Call ended: ${callId}, reason: ${reason} (${this.activeCallCount}/${MAX_CONCURRENT_CALLS})`);
    }
  }

  getActiveCallCount(): number {
    return this.activeCallCount;
  }

  getActiveCalls(): Map<string, ActiveCall> {
    return this.activeCalls;
  }

  canAcceptCall(): boolean {
    return this.activeCallCount + this.semaphore < MAX_CONCURRENT_CALLS;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  private setupCleanup(): void {
    setInterval(() => {
      const now = new Date();
      const staleCallIds: string[] = [];
      
      this.activeCalls.forEach((call, callId) => {
        const timeSinceLastActivity = now.getTime() - call.lastActivity.getTime();
        
        // Clean up very old calls (beyond cleanup interval)
        if (timeSinceLastActivity > CALL_CLEANUP_INTERVAL) {
          staleCallIds.push(callId);
        }
      });
      
      staleCallIds.forEach(callId => {
        const call = this.activeCalls.get(callId);
        if (call && call.status !== 'ended') {
          console.log(`🧹 Force ending stale call: ${callId}`);
          this.endCall(callId, 'stale-cleanup');
        } else {
          this.activeCalls.delete(callId);
          console.log(`🧹 Cleaned up old call record: ${callId}`);
        }
      });
      
    }, CALL_CLEANUP_INTERVAL);
  }
}

// Initialize call manager
const callManager = new CallManager();

// Server metrics with better tracking
let serverMetrics: ServerMetrics = {
  totalCalls: 0,
  activeCalls: 0,
  rejectedCalls: 0,
  errors: 0,
  memoryUsage: process.memoryUsage(),
  cpuUsage: 0,
  uptime: 0,
  toolCalls: {
    checkAvailability: 0,
    makeReservation: 0,
    dailySpecials: 0,
    openingHours: 0,
    transferCall: 0,
    checkBooking: 0 // ADDED: Initialize new counter
  }
};

// Event handlers
callManager.on('callStarted', (callId: string, twilioCallSid: string) => {
  serverMetrics.totalCalls++;
  serverMetrics.activeCalls = callManager.getActiveCallCount();
});

callManager.on('callEnded', (callId: string, reason: string) => {
  serverMetrics.activeCalls = callManager.getActiveCallCount();
});

callManager.on('callError', (callId: string, error: string) => {
  serverMetrics.errors++;
  console.error(`❌ Call error: ${callId}, error: ${error}`);
});

// Mock data storage with enhanced debugging
const bookings: Booking[] = [];

// BOOKING SYSTEM IMPROVEMENTS START HERE 🎯

// Phonetic alphabet mapping for voice-friendly booking IDs
const phoneticAlphabet: { [key: string]: string } = {
  'A': 'Alpha', 'B': 'Bravo', 'C': 'Charlie', 'D': 'Delta', 'E': 'Echo',
  'F': 'Foxtrot', 'G': 'Golf', 'H': 'Hotel', 'I': 'India', 'J': 'Juliet',
  'K': 'Kilo', 'L': 'Lima', 'M': 'Mike', 'N': 'November', 'O': 'Oscar',
  'P': 'Papa', 'Q': 'Quebec', 'R': 'Romeo', 'S': 'Sierra', 'T': 'Tango',
  'U': 'Uniform', 'V': 'Victor', 'W': 'Whiskey', 'X': 'X-ray', 'Y': 'Yankee', 'Z': 'Zulu'
};

// Generate three-letter phonetic booking ID
function generatePhoneticBookingId(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter1 = letters[Math.floor(Math.random() * letters.length)];
  const letter2 = letters[Math.floor(Math.random() * letters.length)];
  const letter3 = letters[Math.floor(Math.random() * letters.length)];
  
  const code = `${letter1}${letter2}${letter3}`;
  
  if (DEBUG_BOOKINGS) {
    const phonetic = `${phoneticAlphabet[letter1]} ${phoneticAlphabet[letter2]} ${phoneticAlphabet[letter3]}`;
    console.log(`🎯 Generated booking ID: ${code} (${phonetic})`);
  }
  
  return code;
}

// Convert booking ID to phonetic alphabet for voice
function convertToPhonetic(bookingId: string): string {
  return bookingId.split('').map(letter => phoneticAlphabet[letter] || letter).join(' ');
}

// Convert phonetic alphabet back to letters
function convertPhoneticToLetters(phoneticInput: string): string {
  const reversePhoneticMap: { [key: string]: string } = {};
  
  // Create reverse mapping from phonetic words to letters
  Object.entries(phoneticAlphabet).forEach(([letter, phonetic]) => {
    reversePhoneticMap[phonetic.toLowerCase()] = letter;
  });
  
  // Handle different input formats
  const normalizedInput = phoneticInput.trim().toLowerCase();
  
  // If it's already a 3-letter code, return uppercase
  if (/^[a-z]{3}$/.test(normalizedInput)) {
    return normalizedInput.toUpperCase();
  }
  
  // Parse phonetic words (space-separated or dash-separated)
  const words = normalizedInput.split(/[\s\-]+/).filter(word => word.length > 0);
  
  if (words.length === 3) {
    const letters = words.map(word => reversePhoneticMap[word]).filter(Boolean);
    if (letters.length === 3) {
      return letters.join('');
    }
  }
  
  // If we can't parse it, return the original input (uppercase, no spaces)
  return phoneticInput.toUpperCase().replace(/\s+/g, '');
}

// Date validation and conversion utilities
function parseNaturalDate(dateInput: string): string {
  const today = new Date();
  const normalizedInput = dateInput.toLowerCase().trim();
  
  if (normalizedInput === 'today') {
    return today.toISOString().split('T')[0];
  }
  
  if (normalizedInput === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  
  // Handle day names (monday, tuesday, etc.)
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = dayNames.indexOf(normalizedInput);
  
  if (dayIndex !== -1) {
    const targetDate = new Date(today);
    const currentDay = today.getDay();
    let daysToAdd = dayIndex - currentDay;
    
    // If the target day is today or in the past this week, move to next week
    if (daysToAdd <= 0) {
      daysToAdd += 7;
    }
    
    targetDate.setDate(today.getDate() + daysToAdd);
    return targetDate.toISOString().split('T')[0];
  }
  
  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }
  
  // Default to today if can't parse
  return today.toISOString().split('T')[0];
}

function isValidFutureDate(dateString: string): boolean {
  const inputDate = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Reset time to start of day
  
  return inputDate >= today;
}

// BOOKING SYSTEM IMPROVEMENTS END HERE 🎯

// Add a debug test booking to verify the array works
if (DEBUG_BOOKINGS) {
  const testBooking: Booking = {
    id: 'ABC', // CHANGED: Use phonetic format
    customerName: 'Test Customer',
    date: '2025-06-25',
    time: '7:00 PM',
    partySize: 2,
    specialRequirements: 'Test booking for debugging',
    createdAt: new Date()
  };
  bookings.push(testBooking);
  console.log(`🧪 Added test booking to verify array: ${testBooking.id} (${convertToPhonetic(testBooking.id)})`); // CHANGED: Show phonetic
  console.log(`🧪 Current bookings array length: ${bookings.length}`);
}

const dailySpecials = {
  soup: "Tuscan White Bean Soup with rosemary and pancetta",
  meal: "Pan-Seared Salmon with lemon herb risotto and seasonal vegetables"
};

const openingHours = {
  monday: { open: "17:00", close: "22:00", closed: false },
  tuesday: { open: "17:00", close: "22:00", closed: false },
  wednesday: { open: "17:00", close: "22:00", closed: false },
  thursday: { open: "17:00", close: "22:00", closed: false },
  friday: { open: "17:00", close: "23:00", closed: false },
  saturday: { open: "17:00", close: "23:00", closed: false },
  sunday: { open: "17:00", close: "22:00", closed: false }
};

const humanAgentNumber = process.env.HUMAN_AGENT_PHONE || "+1234567890";

// Enhanced resource monitoring (async)
const updateMetrics = async () => {
  try {
    const memUsage = process.memoryUsage();
    const totalSystemMem = os.totalmem();
    
    serverMetrics.memoryUsage = memUsage;
    serverMetrics.uptime = process.uptime();
    
    // Process memory vs system memory
    const processMemMB = Math.round(memUsage.rss / 1024 / 1024);
    const systemMemPercent = Math.round((memUsage.rss / totalSystemMem) * 100);
    
    console.log(`📊 Resources - Memory: ${processMemMB}MB (${systemMemPercent}% of system), Active Calls: ${serverMetrics.activeCalls}, Bookings: ${bookings.length}`);
  } catch (error) {
    console.error('Error updating metrics:', error);
  }
};

setInterval(updateMetrics, 300000); // 5 minutes

// Utility functions
function generateAvailableSlots(date: string): BookingSlot[] {
  const slots: BookingSlot[] = [];
  const times = [
    "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM", "7:00 PM",
    "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM", "9:30 PM"
  ];

  times.forEach(time => {
    const isAvailable = Math.random() > 0.3;
    slots.push({
      date,
      time,
      available: isAvailable,
      maxPartySize: isAvailable ? (Math.random() > 0.5 ? 8 : 6) : 0
    });
  });

  return slots;
}

function isRestaurantOpen(): { isOpen: boolean; nextOpenTime?: string; message: string } {
  try {
    const now = new Date();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() as keyof typeof openingHours;
    const currentTime = now.toTimeString().slice(0, 5);

    const todayHours = openingHours[currentDay];

    if (todayHours.closed) {
      return {
        isOpen: false,
        message: `We're closed today (${currentDay}). Our regular hours are Monday through Sunday, five PM to ten PM (eleven PM on weekends).`
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
  } catch (error) {
    console.error('Error in isRestaurantOpen:', error);
    return {
      isOpen: false,
      message: "We're open Monday through Sunday from 5:00 PM to 10:00 PM (11:00 PM on weekends)."
    };
  }
}

function formatTime(time: string): string {
  const [hour, minute] = time.split(':');
  const hourNum = parseInt(hour);
  const ampm = hourNum >= 12 ? 'PM' : 'AM';
  const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
  return minute === '00' ? `${displayHour} ${ampm}` : `${displayHour}:${minute} ${ampm}`;
}

// Error handling helper
const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log(`❌ Validation errors:`, errors.array());
    res.status(400).json({ 
      error: 'Validation failed', 
      details: errors.array() 
    });
    return;
  }
  next();
};

// Ultravox utility functions
async function createUltravoxCall(callConfig: any) {
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
      throw new Error(`Ultravox API error: ${response.status} - ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating Ultravox call:', error);
    throw error;
  }
}

async function transferActiveCall(ultravoxCallId: string) {
  try {
    const activeCalls = callManager.getActiveCalls();
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

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: TWILIO_VOICE as any }, message);
    const dial = twiml.dial({ timeout: 30 });
    dial.number(humanAgentNumber);
    twiml.say({ voice: TWILIO_VOICE as any },
      "I'm sorry, but I wasn't able to connect you with our booking team right now. Please try calling back during our regular business hours. Thank you for calling Bella Vista!");

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw {
      status: 'error',
      message: 'Failed to transfer call',
      error: errorMessage
    };
  }
}

// Tool definitions - ADDED checkBooking tool
const toolsBaseUrl = process.env.BASE_URL || 'http://localhost:3000';

const tools = [
  {
    modelToolName: "checkAvailability",
    description: "Check available reservation times for a specific date and party size",
    defaultReaction: "AGENT_REACTION_SPEAKS",
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
    defaultReaction: "AGENT_REACTION_SPEAKS",
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
  // ADDED: New checkBooking tool
  {
    modelToolName: "checkBooking",
    description: "Look up an existing reservation by confirmation code",
    defaultReaction: "AGENT_REACTION_SPEAKS",
    dynamicParameters: [
      {
        name: "confirmationCode",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "Three-letter confirmation code (e.g., ABC, XYZ)"
        },
        required: true
      }
    ],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/check-booking`,
      httpMethod: "POST"
    }
  },
  {
    modelToolName: "getDailySpecials",
    description: "Get today's soup and meal specials",
    defaultReaction: "AGENT_REACTION_SPEAKS",
    dynamicParameters: [],
    http: {
      baseUrlPattern: `${toolsBaseUrl}/tools/daily-specials`,
      httpMethod: "GET"
    }
  },
  {
    modelToolName: "checkOpeningHours",
    description: "Check if the restaurant is currently open and get opening hours information",
    defaultReaction: "AGENT_REACTION_SPEAKS",
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

// Enhanced webhook handler with atomic concurrency control
app.post('/webhook/twilio', validateWebhookInput, handleValidationErrors, async (req, res) => {
  let reservedSlot = false;
  
  try {
    console.log('Incoming call received');
    const twilioCallSid = req.body.CallSid;
    console.log('Twilio CallSid:', twilioCallSid);

    // Atomic reservation of call slot
    reservedSlot = callManager.reserveCallSlot();
    
    if (!reservedSlot) {
      console.log(`🚫 Call rejected - at capacity (${callManager.getActiveCallCount()}/${MAX_CONCURRENT_CALLS})`);
      serverMetrics.rejectedCalls++;
      
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({ 
        voice: TWILIO_VOICE as any 
      }, `Thank you for calling Bella Vista Italian Restaurant. We're currently experiencing high call volume and all our lines are busy. Please try calling back in a few minutes, or visit our website to make a reservation online. We apologize for the inconvenience and look forward to serving you soon.`);
      
      const twimlString = twiml.toString();
      res.type('text/xml');
      return res.send(twimlString);
    }

    const callConfig = {
      systemPrompt: `You are ${AGENT_NAME}, a friendly and professional AI host for Bella Vista Italian Restaurant. You help customers make reservations and answer questions about our menu.

IMPORTANT GUIDELINES:
- Always greet customers warmly and introduce yourself as ${AGENT_NAME}, the AI Voice Agent for Bella Vista
- Explain that we use AI agents because our lines get very busy during serving hours while our staff focuses on providing excellent service to dining guests
- Mention that calls are recorded to help improve our service quality
- Get the customer's name early and use it throughout the conversation
- Use natural speech forms (say "seven thirty PM" not "7:30 PM", "March fifteenth" not "3/15")
- Stay focused on booking reservations and answering menu questions
- Be warm, professional, and helpful like a great restaurant host

CRITICAL: ALWAYS RESPOND AFTER USING TOOLS
- After checking availability, IMMEDIATELY tell the customer what you found
- After making a reservation, IMMEDIATELY confirm the details
- After looking up specials or hours, IMMEDIATELY share the information
- After using queryCorpus for menu questions, IMMEDIATELY share what you discovered
- After checking a booking, IMMEDIATELY tell them what you found
- Never wait for the customer to ask what happened - always speak first after tool use

CONVERSATION FLOW:
1. Warm greeting and AI agent introduction with explanation
2. Mention call recording for service improvement
3. Get customer's name and greet them personally
4. Ask how you can help them today
5. For bookings: gather date, time preference, party size
6. Check availability and IMMEDIATELY respond with results
7. Confirm all details before making reservation
8. Ask about special requirements (dietary, accessibility, celebrations)
9. IMMEDIATELY provide confirmation number and restaurant details after booking
10. Offer human transfer if needed or if customer seems frustrated

TOOL USAGE RESPONSES:
- checkAvailability: Always immediately tell them what times are available or suggest alternatives
- makeReservation: Always immediately confirm the booking with confirmation number
- checkBooking: Always immediately tell them the booking details or if not found
- getDailySpecials: Always immediately tell them the specials
- checkOpeningHours: Always immediately tell them if you're open and what the hours are
- queryCorpus: Always immediately share the menu/policy information you found

BOOKING CONFIRMATION CODES:
- All confirmation codes are three letters (e.g., ABC, XYZ)
- When giving confirmation codes, spell them out phonetically: "Alpha Bravo Charlie" for ABC
- When customers provide codes, accept either format: "ABC" or "Alpha Bravo Charlie"

HUMAN TRANSFER:
If customers request to speak with a human or if you encounter complex requests:
- Use the transferCall tool with the automatic callId parameter
- Explain that during serving hours, staff may be busy with dining guests
- Set appropriate expectations about response times
- Always offer transfer if the customer seems frustrated or has special needs

TOOLS AVAILABLE:
- checkOpeningHours: Check if we're currently open and get hours
- checkAvailability: Check reservation times for specific dates
- makeReservation: Create confirmed reservations
- checkBooking: Look up existing reservations by confirmation code
- getDailySpecials: Get soup and meal of the day
- queryCorpus: Answer menu questions and dietary information
- transferCall: Connect to human booking agent (uses automatic callId)
- hangUp: End call when customer is finished

Always speak naturally and conversationally, use the customer's name, confirm all booking details clearly, and provide excellent hospitality that reflects our restaurant's values.`,
      model: 'fixie-ai/ultravox',
      voice: ULTRAVOX_VOICE,
      temperature: 0.3,
      firstSpeaker: 'FIRST_SPEAKER_AGENT',
      selectedTools: [
        {
          toolName: "queryCorpus",
          authTokens: {},
          parameterOverrides: {
            corpus_id: process.env.ULTRAVOX_CORPUS_ID || "your_corpus_id_here",
            max_results: 8
          }
        },
        { toolName: "hangUp" },
        ...tools.map(tool => ({ temporaryTool: tool }))
      ],
      medium: { "twilio": {} },
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
    };

    const response = await createUltravoxCall(callConfig);

    // Register the successful call (converts reservation to active call)
    callManager.registerCall(response.callId, twilioCallSid);

    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    connect.stream({
      url: response.joinUrl,
      name: 'bella-vista-agent',
      statusCallback: `${toolsBaseUrl}/webhook/stream-status`,
      statusCallbackMethod: 'POST'
    });

    const twimlString = twiml.toString();
    res.type('text/xml');
    return res.send(twimlString);

  } catch (error) {
    console.error('Error handling incoming call:', error);
    
    // Release reserved slot if call creation failed
    if (reservedSlot) {
      callManager.releaseCallSlot();
    }
    
    serverMetrics.errors++;
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: TWILIO_VOICE as any }, 'Sorry, there was an error connecting your call. Please try again or call us directly.');
    const twimlString = twiml.toString();
    res.type('text/xml');
    return res.send(twimlString);
  }
});

// Enhanced tool endpoints with extensive debugging
app.post('/tools/check-availability', [
  body('date').isString().notEmpty(),
  body('partySize').isInt({ min: 1, max: 12 })
], handleValidationErrors, (req, res) => {
  // Set header FIRST - before any logic
  res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  
  // Track tool usage
  serverMetrics.toolCalls.checkAvailability++;
  
  if (DEBUG_TOOLS) {
    console.log(`🔧 [${new Date().toISOString()}] checkAvailability called`);
    console.log(`🔧 Request data:`, JSON.stringify(req.body, null, 2));
    console.log(`🔧 Headers:`, JSON.stringify(req.headers, null, 2));
  }
  
  try {
    const { date, partySize = 1 } = req.body;

    // CHANGED: Use enhanced date parsing
    const searchDate = parseNaturalDate(date);
    
    if (DEBUG_TOOLS) {
      console.log(`🔧 Date parsing: "${date}" -> "${searchDate}"`);
    }

    // ADDED: Validate that the date is in the future
    if (!isValidFutureDate(searchDate)) {
      console.log(`❌ Invalid date: ${searchDate} is in the past`);
      const response = {
        success: false,
        message: `I'm sorry, but I can't check availability for dates in the past. Please choose a future date for your reservation.`,
        availableSlots: []
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    }

    const availableSlots = generateAvailableSlots(searchDate)
      .filter(slot => slot.available && slot.maxPartySize >= partySize);

    if (availableSlots.length === 0) {
      console.log(`❌ No availability found for ${partySize} people on ${searchDate}`);
      const response = {
        success: false,
        message: `Unfortunately, we don't have any availability for ${partySize} ${partySize === 1 ? 'person' : 'people'} on ${searchDate}. Would you like to try a different date?`,
        availableSlots: []
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    } else {
      console.log(`✅ Found ${availableSlots.length} available slots for ${partySize} people on ${searchDate}`);
      const response = {
        success: true,
        message: `Great! I found ${availableSlots.length} available ${availableSlots.length === 1 ? 'time' : 'times'} for ${partySize} ${partySize === 1 ? 'person' : 'people'} on ${searchDate}.`,
        date: searchDate,
        partySize,
        availableSlots: availableSlots.map(slot => ({
          time: slot.time,
          maxPartySize: slot.maxPartySize
        }))
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    }
  } catch (error) {
    console.error('❌ Error checking availability:', error);
    return res.status(500).json({ error: "Sorry, I'm having trouble checking availability right now. Please try again." });
  }
});

app.post('/tools/make-reservation', validateReservationInput, handleValidationErrors, (req, res) => {
  // Set header FIRST
  res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  
  // Track tool usage
  serverMetrics.toolCalls.makeReservation++;
  
  if (DEBUG_TOOLS) {
    console.log(`🔧 [${new Date().toISOString()}] makeReservation called`);
    console.log(`🔧 Request data:`, JSON.stringify(req.body, null, 2));
    console.log(`🔧 Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`🔧 Current bookings array length BEFORE: ${bookings.length}`);
  }
  
  try {
    const { customerName, date, time, partySize, specialRequirements } = req.body;

    // ADDED: Validate future date
    if (!isValidFutureDate(date)) {
      const response = {
        success: false,
        message: `I'm sorry, but I can't make reservations for dates in the past. Please choose a future date for your reservation.`
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Past date rejected, sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    }

    if (partySize > 12) {
      const response = {
        success: false,
        message: "I'm sorry, but we can only accommodate parties of up to twelve people through our booking system. For larger parties, I'd recommend calling us directly at (555) 123-4567 to speak with our manager about special arrangements."
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Party size too large, sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    }

    if (partySize < 1) {
      const response = {
        success: false,
        message: "The party size must be at least one person."
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Party size too small, sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    }

    const availableSlots = generateAvailableSlots(date);
    const requestedSlot = availableSlots.find(slot => slot.time === time);

    if (!requestedSlot || !requestedSlot.available || requestedSlot.maxPartySize < partySize) {
      const response = {
        success: false,
        message: `I'm sorry, but that time slot is no longer available. Let me check what other times we have available for ${date}.`
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Time slot not available, sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    }

    // CHANGED: Use phonetic booking ID instead of sequential
    const booking: Booking = {
      id: generatePhoneticBookingId(),
      customerName: customerName.trim(),
      date,
      time,
      partySize,
      specialRequirements: specialRequirements?.trim(),
      createdAt: new Date()
    };

    // ADD TO ARRAY - THIS IS THE CRITICAL PART
    bookings.push(booking);

    if (DEBUG_BOOKINGS) {
      console.log(`📝 BOOKING CREATED: ${booking.id}`);
      console.log(`📝 Booking details:`, JSON.stringify(booking, null, 2));
      console.log(`📝 Bookings array length AFTER push: ${bookings.length}`);
      console.log(`📝 All bookings:`, bookings.map(b => ({ id: b.id, name: b.customerName, date: b.date, time: b.time })));
    }

    // CHANGED: Include phonetic confirmation
    const phoneticCode = convertToPhonetic(booking.id);
    const confirmationMessage = `Perfect! I've confirmed your reservation for ${customerName}, party of ${partySize}, on ${date} at ${time}. Your confirmation code is ${phoneticCode}.${specialRequirements ? ` We've noted your special requirements: ${specialRequirements}.` : ''} We look forward to seeing you at Bella Vista Italian Restaurant!`;

    console.log(`✅ Reservation created successfully: ${booking.id} (${phoneticCode})`);
    
    const response = {
      success: true,
      message: confirmationMessage,
      booking: {
        confirmationNumber: booking.id,
        phoneticCode: phoneticCode, // ADDED: Include phonetic version
        customerName: booking.customerName,
        date: booking.date,
        time: booking.time,
        partySize: booking.partySize,
        specialRequirements: booking.specialRequirements
      }
    };
    
    if (DEBUG_TOOLS) {
      console.log(`🔧 Sending success response:`, JSON.stringify(response, null, 2));
    }
    
    return res.json(response);
  } catch (error) {
    console.error('❌ Error making reservation:', error);
    return res.status(500).json({
      error: "I apologize, but I'm having trouble processing your reservation right now. Please try again in a moment."
    });
  }
});

// ADDED: New check booking endpoint
app.post('/tools/check-booking', [
  body('confirmationCode').isString().trim().isLength({ min: 1, max: 50 }) // FIXED: Allow longer phonetic codes
], handleValidationErrors, (req, res) => {
  // Set header FIRST
  res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  
  // Track tool usage
  serverMetrics.toolCalls.checkBooking++;
  
  if (DEBUG_TOOLS) {
    console.log(`🔧 [${new Date().toISOString()}] checkBooking called`);
    console.log(`🔧 Request data:`, JSON.stringify(req.body, null, 2));
  }
  
  try {
    const { confirmationCode } = req.body;
    
    // FIXED: Convert phonetic input to letters first
    const normalizedCode = convertPhoneticToLetters(confirmationCode);
    
    if (DEBUG_TOOLS) {
      console.log(`🔧 Looking for booking with code: ${confirmationCode} -> ${normalizedCode}`);
      console.log(`🔧 Available bookings:`, bookings.map(b => b.id));
    }
    
    // Find the booking
    const booking = bookings.find(b => b.id === normalizedCode);
    
    if (!booking) {
      console.log(`❌ Booking not found for code: ${normalizedCode}`);
      const response = {
        success: false,
        message: `I'm sorry, but I couldn't find a reservation with confirmation code ${convertToPhonetic(normalizedCode)}. Please double-check the code or contact us if you need assistance.`
      };
      
      if (DEBUG_TOOLS) {
        console.log(`🔧 Sending response:`, JSON.stringify(response, null, 2));
      }
      
      return res.json(response);
    }
    
    console.log(`✅ Found booking: ${booking.id} for ${booking.customerName}`);
    
    const phoneticCode = convertToPhonetic(booking.id);
    const response = {
      success: true,
      message: `I found your reservation! Confirmation code ${phoneticCode} for ${booking.customerName}, party of ${booking.partySize}, on ${booking.date} at ${booking.time}.${booking.specialRequirements ? ` Special requirements: ${booking.specialRequirements}.` : ''} Is there anything you'd like to change about this reservation?`,
      booking: {
        confirmationNumber: booking.id,
        phoneticCode: phoneticCode,
        customerName: booking.customerName,
        date: booking.date,
        time: booking.time,
        partySize: booking.partySize,
        specialRequirements: booking.specialRequirements,
        createdAt: booking.createdAt
      }
    };
    
    if (DEBUG_TOOLS) {
      console.log(`🔧 Sending response:`, JSON.stringify(response, null, 2));
    }
    
    return res.json(response);
  } catch (error) {
    console.error('❌ Error checking booking:', error);
    return res.status(500).json({
      error: "I'm sorry, I'm having trouble looking up that reservation right now. Please try again."
    });
  }
});

app.get('/tools/daily-specials', (req, res) => {
  // Set header FIRST
  res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  
  // Track tool usage
  serverMetrics.toolCalls.dailySpecials++;
  
  if (DEBUG_TOOLS) {
    console.log(`🔧 [${new Date().toISOString()}] dailySpecials called`);
  }
  
  try {
    const response = {
      success: true,
      message: `Today's specials are: For soup, we have ${dailySpecials.soup}. And our chef's special meal is ${dailySpecials.meal}.`,
      specials: dailySpecials
    };
    
    if (DEBUG_TOOLS) {
      console.log(`🔧 Sending response:`, JSON.stringify(response, null, 2));
    }
    
    return res.json(response);
  } catch (error) {
    console.error('❌ Error getting daily specials:', error);
    return res.status(500).json({
      error: "I'm sorry, I can't access today's specials right now. Please ask your server when you arrive."
    });
  }
});

app.get('/tools/opening-hours', (req, res) => {
  // Set header FIRST
  res.setHeader('X-Ultravox-Agent-Reaction', 'speaks');
  
  // Track tool usage
  serverMetrics.toolCalls.openingHours++;
  
  if (DEBUG_TOOLS) {
    console.log(`🔧 [${new Date().toISOString()}] openingHours called`);
  }
  
  try {
    const openStatus = isRestaurantOpen();

    const response = {
      success: true,
      isOpen: openStatus.isOpen,
      message: openStatus.message,
      hours: {
        "Monday through Thursday": "5:00 PM to 10:00 PM",
        "Friday and Saturday": "5:00 PM to 11:00 PM",
        "Sunday": "5:00 PM to 10:00 PM"
      }
    };
    
    if (DEBUG_TOOLS) {
      console.log(`🔧 Sending response:`, JSON.stringify(response, null, 2));
    }
    
    return res.json(response);
  } catch (error) {
    console.error('❌ Error checking opening hours:', error);
    return res.status(500).json({
      error: "I'm having trouble checking our hours right now."
    });
  }
});

app.post('/tools/transfer-call', [
  body('callId').isString().notEmpty(),
  body('reason').isString().notEmpty(),
  body('customerName').optional().isString().trim(),
  body('summary').optional().isString().isLength({ max: 1000 })
], handleValidationErrors, async (req, res) => {
  
  // Track tool usage
  serverMetrics.toolCalls.transferCall++;
  
  if (DEBUG_TOOLS) {
    console.log(`🔧 [${new Date().toISOString()}] transferCall called`);
    console.log(`🔧 Request data:`, JSON.stringify(req.body, null, 2));
  }
  
  try {
    const { callId, reason, customerName, summary } = req.body;
    console.log(`📞 Request to transfer call with callId: ${callId}`);
    console.log(`📞 Transfer reason: ${reason}`);

    const result = await transferActiveCall(callId);
    return res.json(result);

  } catch (error) {
    console.error('❌ Error transferring call:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      status: 'error',
      message: 'Failed to transfer call',
      error: errorMessage
    });
  }
});

// Debug endpoint to manually test booking creation
app.post('/debug/create-booking', authenticateAdmin, (req, res) => {
  if (DEBUG_BOOKINGS) {
    console.log(`🧪 Debug endpoint called to create test booking`);
    
    const testBooking: Booking = {
      id: generatePhoneticBookingId(), // CHANGED: Use phonetic ID
      customerName: 'Debug Test Customer',
      date: '2025-06-26',
      time: '8:00 PM',
      partySize: 4,
      specialRequirements: 'Debug test booking',
      createdAt: new Date()
    };
    
    bookings.push(testBooking);
    
    const phoneticCode = convertToPhonetic(testBooking.id); // ADDED: Show phonetic
    console.log(`🧪 Debug booking created: ${testBooking.id} (${phoneticCode})`);
    console.log(`🧪 Bookings array length: ${bookings.length}`);
    
    return res.json({
      success: true,
      booking: testBooking,
      phoneticCode: phoneticCode, // ADDED: Include phonetic
      totalBookings: bookings.length,
      allBookings: bookings
    });
  } else {
    return res.json({ error: 'Debug mode not enabled' });
  }
});

// Enhanced webhook handlers

// Stream status callback webhook
app.post('/webhook/stream-status', (req, res) => {
  try {
    const { CallSid, StreamSid, StreamEvent, StreamError, Timestamp } = req.body;
    
    console.log(`📡 Stream event: ${StreamEvent} for call ${CallSid}`);
    
    // Find the call by Twilio CallSid
    const activeCalls = callManager.getActiveCalls();
    const callEntry = Array.from(activeCalls.entries())
      .find(([_, call]) => call.twilioCallSid === CallSid);
    
    if (callEntry) {
      const [callId, call] = callEntry;
      
      switch (StreamEvent) {
        case 'stream-started':
          callManager.updateCallStatus(callId, 'active');
          console.log(`✅ Stream started for call ${callId}`);
          break;
          
        case 'stream-stopped':
          callManager.endCall(callId, 'stream-stopped');
          break;
          
        case 'stream-error':
          console.error(`❌ Stream error for call ${callId}: ${StreamError}`);
          callManager.endCall(callId, `stream-error: ${StreamError}`);
          break;
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling stream status:', error);
    res.status(200).send('OK'); // Always return 200 to Twilio
  }
});

// Twilio debugger webhook for error monitoring
app.post('/webhook/twilio-errors', (req, res) => {
  try {
    const { AccountSid, Sid, Level, Payload, Timestamp } = req.body;
    
    console.log(`🚨 Twilio ${Level}: ${Sid} at ${Timestamp}`);
    
    if (Payload) {
      const payload = typeof Payload === 'string' ? JSON.parse(Payload) : Payload;
      console.log('Error details:', payload);
      
      // Handle specific error types
      if (payload.error_code === '10004') {
        console.log('⚠️  Concurrency limit exceeded - this should be handled by our local limiting');
        serverMetrics.rejectedCalls++;
      }
    }
    
    serverMetrics.errors++;
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling Twilio error webhook:', error);
    res.status(200).send('OK');
  }
});

// Enhanced admin and monitoring endpoints with authentication

app.get('/bookings', authenticateAdmin, (req, res) => {
  if (DEBUG_BOOKINGS) {
    console.log(`📊 Bookings endpoint called - returning ${bookings.length} bookings`);
    console.log(`📊 All bookings:`, bookings.map(b => ({ 
      id: b.id, 
      phonetic: convertToPhonetic(b.id), // ADDED: Show phonetic in logs
      name: b.customerName, 
      date: b.date, 
      time: b.time 
    })));
  }
  
  return res.json({ 
    bookings: bookings.map(b => ({
      ...b,
      phoneticCode: convertToPhonetic(b.id) // ADDED: Include phonetic in response
    })),
    total: bookings.length,
    recent: bookings.slice(-10).map(b => ({
      ...b,
      phoneticCode: convertToPhonetic(b.id) // ADDED: Include phonetic for recent too
    })), // Last 10 bookings
    debug: {
      arrayLength: bookings.length,
      debugMode: DEBUG_BOOKINGS
    }
  });
});

app.get('/active-calls', authenticateAdmin, (req, res) => {
  const activeCalls = callManager.getActiveCalls();
  const calls = Array.from(activeCalls.entries()).map(([ultravoxCallId, data]) => ({
    ultravoxCallId,
    ...data,
    durationMinutes: Math.round((new Date().getTime() - new Date(data.timestamp).getTime()) / 60000)
  }));
  
  return res.json({
    activeCalls: calls,
    activeCount: callManager.getActiveCallCount(),
    maxConcurrent: MAX_CONCURRENT_CALLS,
    canAcceptCalls: callManager.canAcceptCall(),
    utilizationPercent: Math.round((callManager.getActiveCallCount() / MAX_CONCURRENT_CALLS) * 100)
  });
});

app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeCalls: callManager.getActiveCallCount(),
    maxConcurrentCalls: MAX_CONCURRENT_CALLS,
    canAcceptCalls: callManager.canAcceptCall(),
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
    },
    utilizationPercent: Math.round((callManager.getActiveCallCount() / MAX_CONCURRENT_CALLS) * 100),
    bookings: {
      total: bookings.length,
      recent: bookings.slice(-3).map(b => ({ 
        id: b.id, 
        phonetic: convertToPhonetic(b.id), // ADDED: Show phonetic in health
        name: b.customerName 
      }))
    }
  };
  
  return res.json(healthStatus);
});

app.get('/metrics', authenticateAdmin, (req, res) => {
  const currentMetrics = {
    ...serverMetrics,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    activeCalls: callManager.getActiveCallCount(),
    utilizationPercent: Math.round((callManager.getActiveCallCount() / MAX_CONCURRENT_CALLS) * 100),
    timestamp: new Date().toISOString(),
    bookingsTotal: bookings.length
  };
  
  return res.json(currentMetrics);
});

// Configuration endpoint
app.get('/config', authenticateAdmin, (req, res) => {
  return res.json({
    agentName: AGENT_NAME,
    ultravoxVoice: ULTRAVOX_VOICE,
    twilioVoice: TWILIO_VOICE,
    maxConcurrentCalls: MAX_CONCURRENT_CALLS,
    callCleanupInterval: CALL_CLEANUP_INTERVAL,
    toolsBaseUrl: toolsBaseUrl,
    environment: process.env.NODE_ENV || 'development',
    debug: {
      bookings: DEBUG_BOOKINGS,
      tools: DEBUG_TOOLS,
      requests: DEBUG_REQUESTS
    },
    currentBookingsCount: bookings.length
  });
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction): void => {
  console.error('Unhandled error:', error);
  serverMetrics.errors++;
  
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🍝 Restaurant booking server running on port ${port}`);
  console.log(`📞 Webhook endpoint: http://localhost:${port}/webhook/twilio`);
  console.log(`📡 Stream status: http://localhost:${port}/webhook/stream-status`);
  console.log(`🚨 Error webhook: http://localhost:${port}/webhook/twilio-errors`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log(`📊 Active calls: http://localhost:${port}/active-calls (requires API key)`);
  console.log(`📈 Metrics: http://localhost:${port}/metrics (requires API key)`);
  console.log(`⚙️  Configuration: http://localhost:${port}/config (requires API key)`);
  console.log(`📝 Bookings: http://localhost:${port}/bookings (requires API key)`);
  console.log(`🔍 Check booking: POST http://localhost:${port}/tools/check-booking`); // ADDED: New endpoint
  console.log(`🧪 Debug booking: POST http://localhost:${port}/debug/create-booking (requires API key)`);
  console.log(`👤 Agent: ${AGENT_NAME}`);
  console.log(`🗣️ Ultravox Voice: ${ULTRAVOX_VOICE}`);
  console.log(`📞 Twilio Voice: ${TWILIO_VOICE}`);
  console.log(`🔢 Max Concurrent Calls: ${MAX_CONCURRENT_CALLS}`);
  console.log(`🔐 Admin endpoints require X-API-Key header`);
  console.log(`🧪 Debug mode - Bookings: ${DEBUG_BOOKINGS}, Tools: ${DEBUG_TOOLS}, Requests: ${DEBUG_REQUESTS}`);
  console.log(`📊 Initial bookings array length: ${bookings.length}`);
  console.log(`🎯 Phonetic booking codes enabled - example: ABC = Alpha Bravo Charlie`); // ADDED: Show new feature

  if (!process.env.ULTRAVOX_API_KEY) {
    console.warn('⚠️  ULTRAVOX_API_KEY environment variable not set!');
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('⚠️  Twilio credentials not set!');
  }
  
  if (!process.env.ULTRAVOX_CORPUS_ID) {
    console.warn('⚠️  ULTRAVOX_CORPUS_ID environment variable not set!');
  }

  if (ADMIN_API_KEY === 'your-secure-admin-key') {
    console.warn('⚠️  Please set ADMIN_API_KEY environment variable for production!');
  }
});

export default app;
