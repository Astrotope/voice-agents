import json
import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import HTMLResponse
from loguru import logger
from dotenv import load_dotenv

# Import the bot logic
from bot import main

# Load environment variables
load_dotenv()

# Initialize FastAPI
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check endpoint for Cerebrium"""
    return {"status": "healthy"}

@app.post("/")
async def start_call():
    """Handle incoming Twilio calls and return TwiML"""
    logger.info("POST TwiML request received")
    
    # Get the project ID from environment or construct URL
    project_id = os.getenv("CEREBRIUM_PROJECT_ID", "p-xxxxxxx")
    app_name = os.getenv("CEREBRIUM_APP_NAME", "twilio-ultravox-agent")
    
    # Construct the WebSocket URL for Cerebrium deployment
    websocket_url = f"wss://api.cortex.cerebrium.ai/v4/{project_id}/{app_name}/ws"
    
    twiml_response = f'''<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Connect>
            <Stream url="{websocket_url}" />
        </Connect>
        <Pause length="40"/>
    </Response>'''
    
    return HTMLResponse(content=twiml_response, media_type="application/xml")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handle WebSocket connections from Twilio"""
    await websocket.accept()
    logger.info("WebSocket connection accepted")
    
    try:
        # Get the first two messages from Twilio
        start_data = websocket.iter_text()
        await start_data.__anext__()  # Skip the first message
        
        # Parse the call data from the second message
        call_data_str = await start_data.__anext__()
        call_data = json.loads(call_data_str)
        logger.info(f"Call data received: {call_data}")
        
        # Extract stream SID
        stream_sid = call_data["start"]["streamSid"]
        logger.info(f"Stream SID: {stream_sid}")
        
        # Start the voice agent
        await main(websocket, stream_sid)
        
    except Exception as e:
        logger.error(f"Error in WebSocket endpoint: {e}")
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8765))
    uvicorn.run(app, host="0.0.0.0", port=port)
