# Voice Agents

## Glossary

- **PSTN** - Public Switched Telephone Network
- **Webhook** - User-defined HTTP callbacks. Webhooks to let your application know when events happen. Webhooks make an HTTP request (usually a POST 	or GET) to the URL you configured for the webhook.

![](https://www.twilio.com/_next/image?url=https%3A%2F%2Fdocs-resources.prod.twilio.com%2Fe4a3b7408c6b3d528f785d2ef6da26f44efa83a88b6e66b70d270af9e84fb8d5.png&w=3840&q=75&dpl=dpl_C3sY6x2cwoCEVFxFhMknNSZWyAXt)

## Research

---

### >> [Twilio](https://www.twilio.com/)

[New Zealand Pricing](https://www.twilio.com/en-us/voice/pricing/nz)

- Clean Local Number - $3.15 / mo
- Receive Calls - Local - $0.0100 / min +$3.15 / mo

[Python SDK](https://www.twilio.com/docs/voice/quickstart/python)

[Respond to Incoming Calls](https://www.twilio.com/docs/voice/quickstart/python#respond-to-incoming-calls-with-twilio)

[Configure Webhook URL](https://www.twilio.com/docs/voice/quickstart/python#respond-to-incoming-calls-with-twilio)

[Secure Connections to Twilio](https://www.twilio.com/docs/usage/securityhttps://www.twilio.com/docs/usage/security)

[Python SDK](https://github.com/twilio/twilio-python)

Reduce NZ call handling latency by moving inbound processing region to AU1 from US1

[Set a phone number's inbound processing Region using the Console](https://www.twilio.com/docs/global-infrastructure/inbound-processing-console)

![Twilio processing regions and latency](https://www.twilio.com/_next/image?url=https%3A%2F%2Fdocs-resources.prod.twilio.com%2F94c35df834147cd6e55ae179b5b764ca81f9b06da0d59e585b0f6d542acbf1c7.jpg&w=3840&q=75&dpl=dpl_362d5kZk2yhgwx2hBP5XGMBDuVDW)

---

### >> [Ultravox.ai](https://www.ultravox.ai/)

#### Python

```python

```

#### Express Server - Typescript/Javascript App

[Ultravox Twilio Incoming Call Quickstart](https://github.com/fixie-ai/ultradox/tree/main/examples/twilio-incoming-quickstart-js)
[Ultravox Docs](https://docs.ultravox.ai/gettingstarted/quickstart-phone-incoming)
[Code Link](https://github.com/fixie-ai/ultradox/blob/main/examples/twilio-incoming-quickstart-js/index.js)

``` javascript
import express from 'express';
import https from 'https';
import twilio from 'twilio';
import 'dotenv/config'

const app = express();
const port = 3000;

// Configuration
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY
const ULTRAVOX_API_URL = 'https://api.ultravox.ai/api/calls';

// Ultravox configuration
const SYSTEM_PROMPT = 'Your name is Steve. You are receiving a phone call. Ask them their name and see how they are doing.';

const ULTRAVOX_CALL_CONFIG = {
    systemPrompt: SYSTEM_PROMPT,
    model: 'fixie-ai/ultravox',
    voice: 'Mark',
    temperature: 0.3,
    firstSpeaker: 'FIRST_SPEAKER_AGENT',
    medium: { "twilio": {} }
};

// Create Ultravox call and get join URL
async function createUltravoxCall() {
    const request = https.request(ULTRAVOX_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': ULTRAVOX_API_KEY
        }
    });

    return new Promise((resolve, reject) => {
        let data = '';

        request.on('response', (response) => {
            response.on('data', chunk => data += chunk);
            response.on('end', () => resolve(JSON.parse(data)));
        });

        request.on('error', reject);
        request.write(JSON.stringify(ULTRAVOX_CALL_CONFIG));
        request.end();
    });
}

// Handle incoming calls
app.post('/incoming', async (req, res) => {
    try {
        console.log('Incoming call received');
        const response = await createUltravoxCall();
        const twiml = new twilio.twiml.VoiceResponse();
        const connect = twiml.connect();
        connect.stream({
            url: response.joinUrl,
            name: 'ultravox'
        });

        const twimlString = twiml.toString();
        res.type('text/xml');
        res.send(twimlString);

    } catch (error) {
        console.error('Error handling incoming call:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, there was an error connecting your call.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
```

[Ultravox Twilio Incoming Call Advanced](https://github.com/fixie-ai/ultradox/tree/main/examples/twilio-incoming-advanced-js)
[Youtube Video](https://www.youtube.com/watch?v=sa9uF5Rr9Os)
[Code Link](https://github.com/fixie-ai/ultradox/tree/main/examples/twilio-incoming-advanced-js)

```javascript
import express from 'express';
import twilio from 'twilio';
import 'dotenv/config';
import { createUltravoxCall } from '../ultravox-utils.js';
import { ULTRAVOX_CALL_CONFIG } from '../ultravox-config.js';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const destinationNumber = process.env.DESTINATION_PHONE_NUMBER;
const router = express.Router();

// Hack: Dictionary to store Twilio CallSid and Ultravox Call ID mapping
// TODO replace this with something more durable
const activeCalls = new Map();

async function transferActiveCall(ultravoxCallId) {
    try {
        const callData = activeCalls.get(ultravoxCallId);
        if (!callData || !callData.twilioCallSid) {
            throw new Error('Call not found or invalid CallSid');
        }

        // First create a new TwiML to handle the transfer
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.dial().number(destinationNumber);

        // Update the active call with the new TwiML
        const updatedCall = await client.calls(callData.twilioCallSid)
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

// Handle incoming calls from Twilio
router.post('/incoming', async (req, res) => {
    try {
        console.log('Incoming call received');
        const twilioCallSid = req.body.CallSid;
        console.log('Twilio CallSid:', twilioCallSid);

        // Create the Ultravox call
        const response = await createUltravoxCall(ULTRAVOX_CALL_CONFIG);

        activeCalls.set(response.callId, {
            twilioCallSid: twilioCallSid
        });

        const twiml = new twilio.twiml.VoiceResponse();
        const connect = twiml.connect();
        connect.stream({
            url: response.joinUrl,
            name: 'ultravox'
        });

        const twimlString = twiml.toString();
        res.type('text/xml');
        res.send(twimlString);

    } catch (error) {
        console.error('Error handling incoming call:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, there was an error connecting your call.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Handle transfer of calls to another number
router.post('/transferCall', async (req, res) => {
    const { callId } = req.body;
    console.log(`Request to transfer call with callId: ${callId}`);

    try {
        const result = await transferActiveCall(callId);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

router.get('/active-calls', (req, res) => {
    const calls = Array.from(activeCalls.entries()).map(([ultravoxCallId, data]) => ({
        ultravoxCallId,
        ...data
    }));
    res.json(calls);
});

export { router };
```

---

### >> [n8n]()

#### [n8n Scaling - Queue Mode](https://docs.n8n.io/hosting/scaling/queue-mode/)

![Queue Mode Flow](https://docs.n8n.io/_images/hosting/scaling/queue-mode-flow.png)

[How to configure n8n queue mode on VPS?](https://www.hostinger.com/in/tutorials/n8n-queue-mode)

#### n8n Queue Mode Setup

![queue mode diagram](https://www.hostinger.com/in/tutorials/wp-content/uploads/sites/52/2025/03/queue-mode-diagram.png)

#### n8n Queue Mode Process

![n8n queue mode process](https://www.hostinger.com/in/tutorials/wp-content/uploads/sites/52/2025/03/n8n-queue-mode-process.png)

#### n8n Webhook Queue Mode Process

[Question on the full N8N stack (main, webhook and worker)](https://community.n8n.io/t/question-on-the-full-n8n-stack-main-webhook-and-worker/16605)

![n8n webhook process queue mode](https://community.n8n.io/uploads/default/original/3X/3/f/3f223f42c9ea26baa0393984f29dc26a0328a85f.png)
