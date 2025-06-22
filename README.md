# Voice Agents

## General Notes

- The goal of this repository is to try out the component technologies of voice agents and see how they fit together
  - Twilio (required)
  - Ultravox or ElevenLabs 
  - n8n/JSON, versus Express.js/Javascript, versus FastAPI/Python
  - Ultravox.ai versus Ultravox self-hosted
 
- Conclusions
  - Use Twilio with either ElevenLabs or Ultravox.ai (non self-hosted Ultravox)
  - Probably prefer Express.js/Typescript over n8n/JSON or FastAPI/Python as the webhook server
  - Express.js/Typescript would be easier to integrate into a SASS application using the [Open SASS](https://docs.opensaas.sh/) template
 
### Advantages of Voice Agents over Standard IVR

![Advantages of Voice Agents over Standard IVR](https://www.astera.com/wp-content/uploads/2025/04/How-AI-voice-Compare-scaled.jpg)
 
### Standard Voice Agent Architecture

Standard: Audio-IN ->> ASR/STT ->> LLM ->> TTS ->> Audio OUT

![Standard Voice Agent Architecture](https://blog.ovhcloud.com/wp-content/uploads/2024/07/audio-virtual-assistant-app-blog-post-puzzles.png)
 
### Ultravox Architecture

Ultravox: Audio-IN ->> Ultravox ->> TTS ->> Audio OUT

Ultravox is a multimodal LLM that understands text and human speech without separate ASR. It converts audio to LLM’s high-dimensional space, responding faster than systems with separate ASR and LLM components.

[![architecture diagram](https://raw.githubusercontent.com/fixie-ai/ultravox/main/docs/assets/Ultravox%20Model%20Architecture.svg)](https://docs.google.com/presentation/d/1ey81xuuMzrJaBwztb_Rq24Cit37GQokD2aAes_KkGVI/edit)

[Ultravox Architecture](https://github.com/fixie-ai/ultravox/blob/main/README.md)


## Twilio/Ultravox.ai Setup

The Webhook Server could be one of...

- n8n Workflow webhook server [JSON](twilio_ultravox/n8n) (see notes at end on [scaling n8n](https://github.com/Astrotope/voice-agents/blob/main/README.md#-n8n))
- Express/Node server (node.js) [Javascript/Typescript](twilio_ultravox/javascript)
- FastAPI/Uvicorn server [Python](twilio_ultravox/python)

The Webhook Server is middleware that connects the Twilio Stream to the Ultravox Agent. Once connected the Ultravox Agent takes over.

[Note: I'm still waiting for regulatory bundle approval with Twilio, before I can test this code.]

- Twilio/Ultravox Process (n8n Webhook Server) [Sequence Diagram](https://github.com/Astrotope/voice-agents/blob/main/README.md#twilioultravox-process-n8n-webhook-server), [Code](twilio_ultravox/n8n)
- Twilio/Ultravox Process (Express.js Webhook Server) [Sequence Diagram](https://github.com/Astrotope/voice-agents/blob/main/README.md#twilioultravox-process-expressjs-or-fastapi-webhook-server), [Code](twilio_ultravox/javascript)
- Twilio/Ultravox Process (FastAPI Webhook Server) [Sequence Diagram](https://github.com/Astrotope/voice-agents/blob/main/README.md#twilioultravox-process-expressjs-or-fastapi-webhook-server), [Code](twilio_ultravox/python)

## Twilio/ElevenLabs Setup

- Twilio/ElevenLabs Process (Express.js Webhook Server) [Sequence Diagram](https://github.com/Astrotope/voice-agents/blob/main/README.md#twilioelevenlabs-process), [Code](twilio_elevenlabs/javascript)

## Twilio/Ultravox/Cartesia/Cerebrium Self-hosted Setup

- Twilio/Ultravox/Cartesia/Cerebrium Process (Python Webhook Server) [Sequence Diagram](https://github.com/Astrotope/voice-agents/blob/main/README.md#twilioultravoxcartesiacerebrium-process), [Code](twilio_ultravox_cerebrium/v1)
  - This is a future option for self-hosting Ultravox
    - It would require a moderate customer base to make it viable
  - Pay-as-you-go serverless GPU service
    - Can run GPU's during business or busy hours
    - Start-up is estimated at 40 seconds
    - This would need some careful thought about when to spin-up GPU's

## Twilio/Ultravox Process (n8n Webhook Server)

See code ... [Twiliod Ultravox n8n v1](twilio_ultravox/n8n)

See code ... [Twiliod Ultravox n8n v2](twilio_ultravox/n8n/v2)

Sequence Diagram

```mermaid
sequenceDiagram
    participant You as Customer
    participant Restaurant as Restaurant Phone
    participant Twilio as Twilio Service
    participant n8nWebhook as n8n Webhook
    participant LogNode as Log Incoming Call
    participant UltravoxAPI as Ultravox API
    participant ExtractNode as Extract Response
    participant LogSuccess as Log Success
    participant UltravoxAgent as Ultravox AI Agent
    participant ErrorLog as Log Error
    participant ErrorResponse as Error Response
    
    You->>Restaurant: 1. Makes call to restaurant
    Note over Restaurant: Restaurant has call forwarding enabled
    Restaurant->>Twilio: 2. Redirects call to Twilio number
    
    Twilio->>n8nWebhook: 3. POST /webhook with call data
    Note over n8nWebhook: Receives From, To, CallSid params
    
    n8nWebhook->>LogNode: 4. Pass call data
    Note over LogNode: Logs: From, To, CallSid
    
    LogNode->>UltravoxAPI: 5. POST /api/calls with config
    Note over LogNode: Sends systemPrompt, model: fixie-ai/ultravox,<br/>voice: Mark, temperature: 0.3
    
    alt Success Path
        UltravoxAPI->>ExtractNode: Returns joinUrl and callId
        ExtractNode->>LogSuccess: Pass response data
        Note over LogSuccess: Logs: joinUrl, callId
        LogSuccess->>Twilio: 6. Returns TwiML with Connect Stream
        Note over LogSuccess: XML: <Connect><Stream url="joinUrl" name="ultravox"/></Connect>
        
        Twilio->>UltravoxAgent: 7. Establishes WebSocket stream to joinUrl
        Note over Twilio, UltravoxAgent: Bidirectional audio stream established
        
        rect rgb(220, 255, 220)
            Note over You, UltravoxAgent: 8. Ultravox AI Agent takes over
            You->>UltravoxAgent: Customer speaks
            UltravoxAgent->>You: AI responds (Steve: "Ask name, see how doing")
            Note over UltravoxAgent: AI processes with fixie-ai/ultravox model
        end
    else Error Path
        UltravoxAPI-->>ErrorLog: API Error
        Note over ErrorLog: Logs: httpCode, error message, full error details
        ErrorLog->>ErrorResponse: Handle error
        ErrorResponse->>Twilio: Error TwiML message
        Note over ErrorResponse: XML: <Say>Sorry, there was an error connecting your call.</Say>
        Twilio->>You: Plays error message
    end
```

## Twilio/Ultravox Process (Express.js or FastAPI Webhook Server)

See code ... [Twiliod Ultravox n8n Javascript](twilio_ultravox/javascript)

Notes/References (Basic Agent) ...
- [Ultravox Twilio Incoming Call Quickstart](https://github.com/fixie-ai/ultradox/tree/main/examples/twilio-incoming-quickstart-js)
- [Ultravox Docs](https://docs.ultravox.ai/gettingstarted/quickstart-phone-incoming)
- [Code Link](https://github.com/fixie-ai/ultradox/blob/main/examples/twilio-incoming-quickstart-js/index.js)

Notes/References (Advanced Agent) ...
- [Ultravox Twilio Incoming Call Advanced](https://github.com/fixie-ai/ultradox/tree/main/examples/twilio-incoming-advanced-js)
- [Youtube Video](https://www.youtube.com/watch?v=sa9uF5Rr9Os)
- [Code Link](https://github.com/fixie-ai/ultradox/tree/main/examples/twilio-incoming-advanced-js)

See code ... [Twiliod Ultravox n8n Python](twilio_ultravox/python)

Notes/References (Basic Agent)...
- Python/FastAPI/httpx - Basic (Converted with Claude)
- [Twilio Python SDK](https://www.twilio.com/docs/libraries/reference/twilio-python/)
- [Ultravox REST API](https://docs.ultravox.ai/api-reference/introduction)

Sequence Diagram

```mermaid
sequenceDiagram
    participant You as Customer
    participant Restaurant as Restaurant Phone
    participant Twilio as Twilio Service
    participant Webhook as Webhook Server
    participant UltravoxAPI as Ultravox API
    participant UltravoxAgent as Ultravox AI Agent

    You->>Restaurant: 1. Makes call to restaurant
    Note over Restaurant: Restaurant has call forwarding enabled
    Restaurant->>Twilio: 2. Redirects call to Twilio number
    
    Twilio->>Webhook: 3. POST /incoming webhook
    
    Webhook->>UltravoxAPI: 4. POST /api/calls with config
    Note over Webhook: Sends systemPrompt, model, voice, temperature
    UltravoxAPI->>UltravoxAgent: Creates AI agent session
    UltravoxAPI-->>Webhook: Returns joinUrl and callId
    
    Webhook->>Twilio: 5. Returns TwiML with Connect Stream
    Note over Webhook: TwiML contains Ultravox joinUrl
    
    Twilio->>UltravoxAgent: 6. Establishes WebSocket stream to joinUrl
    Note over Twilio, UltravoxAgent: Bidirectional audio stream established
    
    rect rgb(220, 255, 220)
        Note over You, UltravoxAgent: 7. Ultravox AI Agent takes over
        You->>UltravoxAgent: Customer speaks
        UltravoxAgent->>You: AI responds
        Note over UltravoxAgent: AI processes with fixie-ai/ultravox model
    end
    
    alt Error Handling
        UltravoxAPI-->>Webhook: API Error
        Webhook->>Twilio: Error TwiML message
        Twilio->>You: Plays error message
    end
```

## Twilio/ElevenLabs Process

See code ... [Twiliod ElevenLabs Javascript](twilio_elevenlabs/javascript)

Sequence Diagram

```mermaid
sequenceDiagram
    participant Customer
    participant Restaurant as Restaurant Phone
    participant Twilio as Twilio Service
    participant Webhook as Webhook Server
    participant ElevenLabs as ElevenLabs API
    participant Agent as ElevenLabs AI Agent

    Customer->>Restaurant: 1. Makes call to restaurant
    Note over Restaurant: Restaurant has call forwarding enabled
    Restaurant->>Twilio: 2. Redirects call to Twilio number
    
    Twilio->>Webhook: 3. POST /incoming-call-eleven
    Webhook->>Twilio: 4. Returns TwiML with Stream URL
    Twilio->>Webhook: 5. Establishes WebSocket connection (/media-stream)
    
    Note over Webhook: Server gets signed URL from ElevenLabs
    Webhook->>ElevenLabs: 6. GET signed_url (with agent_id)
    ElevenLabs->>Webhook: 7. Returns signed WebSocket URL
    Webhook->>Agent: 8. Establishes WebSocket connection
    
    Agent->>Webhook: 9. conversation_initiation_metadata
    
    rect rgb(220, 255, 220)
        Note over Customer, Agent: ElevenLabs AI Agent handles conversation
        Customer->>Twilio: Customer speaks
        Twilio->>Webhook: media event (base64 audio)
        Webhook->>Agent: user_audio_chunk (base64 audio)
        
        Agent->>Webhook: audio event (base64 response)
        Webhook->>Twilio: media event (base64 audio)
        Twilio->>Customer: Plays AI response
    end
    
    Note over Agent,Webhook: Ping/Pong for keepalive
    Agent->>Webhook: ping event
    Webhook->>Agent: pong response
    
    Note over Agent,Webhook: Handle interruptions
    Agent->>Webhook: interruption event
    Webhook->>Twilio: clear event
    
    alt Error Handling
        ElevenLabs-->>Webhook: API Error
        Webhook->>Twilio: Error handling
        Twilio->>Customer: Connection terminated
    end
```

## Twilio/Ultravox/Cartesia/Cerebrium Process

### Self-hosting Ultravox (STT/LLM) with Cartesia (TTS) on Cerebrium (Pay-as-you-go GPU's)

See code ... [Twiliod Ultravox Cartesia Cerebrium Python v1](twilio_ultravox_cerebrium/v1)

See code ... [Twiliod Ultravox Cartesia Cerebrium Python v2](twilio_ultravox_cerebrium/v2)

Sequence Diagram

```mermaid
sequenceDiagram
    participant Customer
    participant Restaurant as Restaurant Phone
    participant Twilio as Twilio Service
    participant Cerebrium as Cerebrium Container
    participant Ultravox as Ultravox Model
    participant Cartesia as Cartesia TTS

    Customer->>Restaurant: 1. Makes call to restaurant
    Note over Restaurant: Restaurant has call forwarding enabled
    Restaurant->>Twilio: 2. Redirects call to Twilio number
    
    Twilio->>Cerebrium: 3. POST / (webhook)
    Cerebrium->>Twilio: 4. Returns TwiML with WebSocket URL
    Twilio->>Cerebrium: 5. Establishes WebSocket connection (/ws)
    
    Note over Cerebrium: Ultravox model pre-loaded in container
    Cerebrium->>Cerebrium: 6. Initialize PipeCat pipeline
    Note over Cerebrium: Pipeline: WebSocket → Ultravox → Cartesia → WebSocket
    
    rect rgb(220, 255, 220)
        Note over Customer, Cartesia: Voice conversation with combined STT+LLM
        Customer->>Twilio: Customer speaks
        Twilio->>Cerebrium: Audio frames (WebSocket)
        Cerebrium->>Ultravox: Audio → Text + LLM response
        Note over Ultravox: Single model handles both STT and LLM
        Ultravox->>Cerebrium: Generated text response
        
        Cerebrium->>Cartesia: Text for TTS conversion
        Cartesia->>Cerebrium: Audio response
        Cerebrium->>Twilio: Audio frames (WebSocket)
        Twilio->>Customer: Plays AI response
    end
    
    Note over Cerebrium,Cartesia: Interruption handling
    Cerebrium->>Cerebrium: Detect speech interruption
    Cerebrium->>Cartesia: Cancel current TTS
    
    Note over Cerebrium: Auto-scaling based on call volume
    Cerebrium->>Cerebrium: Scale containers up/down
    
    alt Call Ends
        Customer->>Twilio: Hangs up
        Twilio->>Cerebrium: WebSocket close
        Cerebrium->>Cerebrium: Cleanup pipeline
    end
```



## Glossary

- **PSTN** - Public Switched Telephone Network
- **Webhook** - User-defined HTTP callbacks. Webhooks to let your application know when events happen. Webhooks make an HTTP request (usually a POST 	or GET) to the URL you configured for the webhook.

![](https://www.twilio.com/_next/image?url=https%3A%2F%2Fdocs-resources.prod.twilio.com%2Fe4a3b7408c6b3d528f785d2ef6da26f44efa83a88b6e66b70d270af9e84fb8d5.png&w=3840&q=75&dpl=dpl_C3sY6x2cwoCEVFxFhMknNSZWyAXt)

## Research

---

### [Twilio](https://www.twilio.com/)

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

### [Ultravox Open Source Model - Hugging Face](https://huggingface.co/fixie-ai/models)

May 7, 2025 - v0.5 70b - [fixie-ai/ultravox-v0_5-llama-3_3-70b](https://huggingface.co/fixie-ai/ultravox-v0_5-llama-3_3-70b)

Ultravox is a multimodal Speech LLM built around a pretrained Llama3.3-70B-Instruct and whisper-large-v3-turbo backbone.

- No Ultravox API/SDK
- No TTS system built-in. BYO TTS
- Requires A100 80GB to run (about USD $1.1/hr https://cloud.vast.ai/ or https://vm.massedcompute.com/)
- Need to agree to Meta Llama license

---

### [n8n]()

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
