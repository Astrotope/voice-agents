import os
import asyncio
from typing import Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response
import httpx
from twilio.twiml.voice_response import VoiceResponse
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Ultravox FastAPI Server")

# Configuration
ULTRAVOX_API_KEY = os.getenv('ULTRAVOX_API_KEY')
ULTRAVOX_API_URL = 'https://api.ultravox.ai/api/calls'

if not ULTRAVOX_API_KEY:
    raise ValueError("ULTRAVOX_API_KEY environment variable is required")

# Ultravox configuration
SYSTEM_PROMPT = 'Your name is Steve. You are receiving a phone call. Ask them their name and see how they are doing.'

ULTRAVOX_CALL_CONFIG = {
    "systemPrompt": SYSTEM_PROMPT,
    "model": "fixie-ai/ultravox",
    "voice": "Mark",
    "temperature": 0.3,
    "firstSpeaker": "FIRST_SPEAKER_AGENT",
    "medium": {"twilio": {}}
}

async def create_ultravox_call() -> dict:
    """Create Ultravox call and get join URL"""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                ULTRAVOX_API_URL,
                json=ULTRAVOX_CALL_CONFIG,
                headers={
                    'Content-Type': 'application/json',
                    'X-API-Key': ULTRAVOX_API_KEY
                },
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error calling Ultravox API: {e.response.status_code} - {e.response.text}")
            raise HTTPException(
                status_code=502,
                detail=f"Ultravox API error: {e.response.status_code}"
            )
        except httpx.RequestError as e:
            logger.error(f"Request error calling Ultravox API: {e}")
            raise HTTPException(
                status_code=502,
                detail="Failed to connect to Ultravox API"
            )

@app.post("/incoming")
async def handle_incoming_call(request: Request):
    """Handle incoming calls from Twilio"""
    try:
        logger.info("Incoming call received")
        
        # Create Ultravox call
        ultravox_response = await create_ultravox_call()
        
        # Generate TwiML response
        twiml = VoiceResponse()
        connect = twiml.connect()
        connect.stream(
            url=ultravox_response['joinUrl'],
            name='ultravox'
        )
        
        # Return TwiML as XML
        return Response(
            content=str(twiml),
            media_type="text/xml"
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions (these have proper error responses)
        raise
    except Exception as e:
        logger.error(f"Unexpected error handling incoming call: {e}")
        
        # Return error TwiML
        twiml = VoiceResponse()
        twiml.say('Sorry, there was an error connecting your call.')
        
        return Response(
            content=str(twiml),
            media_type="text/xml"
        )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "Ultravox FastAPI Server"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
