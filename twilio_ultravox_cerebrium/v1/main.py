import json
import os
import asyncio
import signal
from typing import Dict, Any, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import HTMLResponse
from loguru import logger
from dotenv import load_dotenv

# Import the bot logic
from bot import create_voice_agent

# Load environment variables
load_dotenv()

# Initialize FastAPI
app = FastAPI(
    title="Cerebrium Twilio Ultravox Voice Agent",
    description="Voice agent using Ultravox + Cartesia for restaurant calls",
    version="1.0.0"
)

# Configure logging
logger.remove()
logger.add(
    lambda msg: print(msg, end=""),
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state for graceful shutdown
shutdown_event = asyncio.Event()
active_connections: Dict[str, WebSocket] = {}

@app.get("/health")
async def health_check():
    """Health check endpoint for Cerebrium"""
    return {
        "status": "healthy",
        "active_connections": len(active_connections),
        "service": "twilio-ultravox-agent"
    }

@app.post("/")
async def start_call(request: dict = None):
    """Handle incoming Twilio calls and return TwiML"""
    logger.info("POST TwiML request received")
    
    try:
        # Get the project ID from environment - REQUIRED for production
        project_id = os.getenv("CEREBRIUM_PROJECT_ID")
        app_name = os.getenv("CEREBRIUM_APP_NAME", "twilio-ultravox-agent")
        
        if not project_id:
            logger.error("CEREBRIUM_PROJECT_ID environment variable not set")
            raise HTTPException(status_code=500, detail="Server configuration error")
        
        # Construct the WebSocket URL for Cerebrium deployment
        websocket_url = f"wss://api.cortex.cerebrium.ai/v4/{project_id}/{app_name}/ws"
        logger.info(f"Directing call to WebSocket: {websocket_url}")
        
        twiml_response = f'''<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Connect>
                <Stream url="{websocket_url}" />
            </Connect>
            <Pause length="40"/>
        </Response>'''
        
        return HTMLResponse(content=twiml_response, media_type="application/xml")
        
    except Exception as e:
        logger.error(f"Error in start_call: {e}")
        # Return error TwiML that plays a message to caller
        error_twiml = '''<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Say voice="alice">We're sorry, but our voice assistant is temporarily unavailable. Please try calling back later.</Say>
            <Hangup/>
        </Response>'''
        return HTMLResponse(content=error_twiml, media_type="application/xml")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handle WebSocket connections from Twilio"""
    connection_id = None
    
    try:
        await websocket.accept()
        logger.info("WebSocket connection accepted")
        
        # Set connection timeout
        timeout_task = asyncio.create_task(
            asyncio.sleep(300)  # 5 minute timeout
        )
        
        try:
            # Get the first two messages from Twilio with timeout
            start_data = websocket.iter_text()
            
            # Wait for first message (should be "connected")
            first_msg = await asyncio.wait_for(start_data.__anext__(), timeout=10.0)
            logger.debug(f"First message: {first_msg}")
            
            # Wait for second message with call data
            call_data_str = await asyncio.wait_for(start_data.__anext__(), timeout=10.0)
            call_data = json.loads(call_data_str)
            logger.info(f"Call data received: {call_data}")
            
            # Extract and validate stream SID
            if "start" not in call_data or "streamSid" not in call_data["start"]:
                raise ValueError("Invalid call data: missing streamSid")
                
            stream_sid = call_data["start"]["streamSid"]
            connection_id = stream_sid
            active_connections[connection_id] = websocket
            
            logger.info(f"Stream SID: {stream_sid}")
            
            # Cancel timeout task
            timeout_task.cancel()
            
            # Start the voice agent
            await create_voice_agent(websocket, stream_sid)
            
        except asyncio.TimeoutError:
            logger.error("Timeout waiting for Twilio messages")
            await websocket.close(code=1008, reason="Timeout")
            
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected by client")
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        await websocket.close(code=1007, reason="Invalid JSON")
        
    except Exception as e:
        logger.error(f"Error in WebSocket endpoint: {e}")
        try:
            await websocket.close(code=1011, reason="Internal error")
        except:
            pass
            
    finally:
        # Cleanup
        if connection_id and connection_id in active_connections:
            del active_connections[connection_id]
        
        if not timeout_task.cancelled():
            timeout_task.cancel()
        
        logger.info(f"WebSocket connection {connection_id} cleaned up")

async def graceful_shutdown():
    """Handle graceful shutdown of active connections"""
    logger.info("Starting graceful shutdown...")
    shutdown_event.set()
    
    # Close all active WebSocket connections
    for connection_id, websocket in list(active_connections.items()):
        try:
            await websocket.close(code=1001, reason="Server shutdown")
            logger.info(f"Closed connection {connection_id}")
        except Exception as e:
            logger.error(f"Error closing connection {connection_id}: {e}")
    
    active_connections.clear()
    logger.info("Graceful shutdown completed")

# Signal handlers for graceful shutdown
def signal_handler(signum, frame):
    logger.info(f"Received signal {signum}")
    asyncio.create_task(graceful_shutdown())

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8765))
    uvicorn.run(app, host="0.0.0.0", port=port)
