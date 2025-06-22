import os
import sys
import asyncio
from typing import Optional
from loguru import logger
from pipecat.frames.frames import LLMMessagesFrame, EndFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.services.ultravox.stt import UltravoxSTTService
from pipecat.services.cartesia import CartesiaTTSService
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)
from pipecat.serializers.twilio import TwilioFrameSerializer

# Configure logging
logger.remove()
logger.add(
    sys.stderr,
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
)

# Global Ultravox processor - initialized once when container starts
_ultravox_processor: Optional[UltravoxSTTService] = None
_model_load_lock = asyncio.Lock()

async def get_ultravox_processor() -> UltravoxSTTService:
    """Get or create the Ultravox processor singleton"""
    global _ultravox_processor
    
    if _ultravox_processor is not None:
        return _ultravox_processor
    
    async with _model_load_lock:
        if _ultravox_processor is not None:
            return _ultravox_processor
            
        try:
            logger.info("Loading Ultravox model...")
            
            # Verify required environment variables
            hf_token = os.getenv("HF_TOKEN")
            if not hf_token:
                raise ValueError("HF_TOKEN environment variable is required")
            
            # Load the model
            _ultravox_processor = UltravoxSTTService(
                model_name=os.getenv("ULTRAVOX_MODEL", "fixie-ai/ultravox-v0_4_1-llama-3_1-8b"),
                hf_token=hf_token,
                temperature=float(os.getenv("ULTRAVOX_TEMPERATURE", "0.7")),
                max_tokens=int(os.getenv("ULTRAVOX_MAX_TOKENS", "200")),
            )
            
            logger.info("Ultravox model loaded successfully")
            return _ultravox_processor
            
        except Exception as e:
            logger.error(f"Failed to load Ultravox model: {e}")
            raise RuntimeError(f"Model loading failed: {e}")

async def create_voice_agent(websocket_client, stream_sid: str):
    """Create and run the voice agent pipeline"""
    
    try:
        # Get the Ultravox processor
        ultravox_processor = await get_ultravox_processor()
        
        # Configure WebSocket transport for Twilio
        transport = FastAPIWebsocketTransport(
            websocket=websocket_client,
            params=FastAPIWebsocketParams(
                audio_out_enabled=True,
                add_wav_header=False,
                vad_enabled=True,
                vad_analyzer=SileroVADAnalyzer(),
                vad_audio_passthrough=True,
                serializer=TwilioFrameSerializer(stream_sid),
            ),
        )

        # Configure Cartesia TTS service
        cartesia_api_key = os.getenv("CARTESIA_API_KEY")
        if not cartesia_api_key:
            raise ValueError("CARTESIA_API_KEY environment variable is required")
            
        tts = CartesiaTTSService(
            api_key=cartesia_api_key,
            voice_id=os.getenv("CARTESIA_VOICE_ID", "79a125e8-cd45-4c13-8a67-188112f4dd22"),
            model=os.getenv("CARTESIA_MODEL", "sonic-english"),
            # Additional TTS configuration
            speed=float(os.getenv("CARTESIA_SPEED", "1.0")),
        )

        # Restaurant-specific system message
        restaurant_name = os.getenv("RESTAURANT_NAME", "our restaurant")
        restaurant_address = os.getenv("RESTAURANT_ADDRESS", "downtown")
        restaurant_hours = os.getenv("RESTAURANT_HOURS", "Monday through Sunday, 11 AM to 10 PM")
        
        initial_messages = [
            {
                "role": "system",
                "content": f"""You are a helpful AI assistant taking phone calls for {restaurant_name}. 

IMPORTANT INSTRUCTIONS:
- Keep all responses under 50 words for natural conversation flow
- Never use special characters, formatting, or markdown in your responses
- Speak naturally as if talking to someone on the phone
- If you don't know specific information, politely say you'll have someone call them back

You can help customers with:
- Making reservations (ask for name, date, time, party size, phone number)
- Providing menu information and daily specials
- Answering questions about hours: {restaurant_hours}
- Location information: {restaurant_address}
- General restaurant inquiries
- Taking takeout orders (get their name and phone number)

For reservations, always collect: name, date, time, party size, and phone number.
For takeout orders, always get their name and phone number.

Be friendly, professional, and efficient. Ask one question at a time."""
            }
        ]

        # Create the pipeline with Ultravox (STT+LLM) and Cartesia (TTS)
        pipeline = Pipeline([
            transport.input(),        # Audio input from Twilio
            ultravox_processor,       # Ultravox handles both STT and LLM processing
            tts,                      # Cartesia TTS for speech synthesis
            transport.output(),       # Audio output to Twilio
        ])

        # Create pipeline task with interruption support and conversation limits
        task = PipelineTask(
            pipeline, 
            params=PipelineParams(
                allow_interruptions=True,
                enable_metrics=True,
                # Set conversation limits to manage memory
                max_conversation_turns=int(os.getenv("MAX_CONVERSATION_TURNS", "50"))
            )
        )

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            """Handle client connection - start the conversation"""
            logger.info(f"Client connected to voice agent for stream {stream_sid}")
            
            # Send initial greeting
            greeting_messages = initial_messages + [
                {
                    "role": "system", 
                    "content": f"A customer just called {restaurant_name}. Greet them warmly and ask how you can help them today. Keep it brief and friendly."
                }
            ]
            
            try:
                await task.queue_frames([LLMMessagesFrame(greeting_messages)])
            except Exception as e:
                logger.error(f"Error sending greeting: {e}")

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            """Handle client disconnection"""
            logger.info(f"Client disconnected from voice agent for stream {stream_sid}")
            try:
                await task.queue_frames([EndFrame()])
            except Exception as e:
                logger.error(f"Error handling disconnection: {e}")

        # Run the pipeline with timeout protection
        runner = PipelineRunner(handle_sigint=False)
        
        logger.info(f"Starting voice agent pipeline for stream {stream_sid}")
        
        # Set a maximum call duration (30 minutes)
        call_timeout = int(os.getenv("CALL_TIMEOUT_SECONDS", "1800"))
        
        try:
            await asyncio.wait_for(runner.run(task), timeout=call_timeout)
        except asyncio.TimeoutError:
            logger.warning(f"Call timeout reached for stream {stream_sid}")
            await task.queue_frames([EndFrame()])
        
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        raise
    except Exception as e:
        logger.error(f"Error in voice agent pipeline: {e}")
        raise
    finally:
        logger.info(f"Voice agent pipeline ended for stream {stream_sid}")

# Pre-warm the model when the module is imported (for Cerebrium)
async def _prewarm_model():
    """Pre-warm the model during container startup"""
    try:
        await get_ultravox_processor()
        logger.info("Model pre-warming completed")
    except Exception as e:
        logger.error(f"Model pre-warming failed: {e}")

# Only pre-warm in production (when running on Cerebrium)
if os.getenv("CEREBRIUM_PROJECT_ID"):
    import asyncio
    try:
        asyncio.get_event_loop().run_until_complete(_prewarm_model())
    except RuntimeError:
        # If no event loop is running, create one
        asyncio.run(_prewarm_model())
