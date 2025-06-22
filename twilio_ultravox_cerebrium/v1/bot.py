import os
import sys
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
from twilio.rest import Client

# Configure logging
logger.remove(0)
logger.add(sys.stderr, level="DEBUG")

# Initialize Twilio client
twilio_client = Client(
    os.environ.get("TWILIO_ACCOUNT_SID"), 
    os.environ.get("TWILIO_AUTH_TOKEN")
)

# Load Ultravox model globally (runs when container starts on Cerebrium)
logger.info("Loading Ultravox model...")
ultravox_processor = UltravoxSTTService(
    model_name="fixie-ai/ultravox-v0_4_1-llama-3_1-8b",  # Using smaller 8B model for faster startup
    hf_token=os.getenv("HF_TOKEN"),
    temperature=0.7,
    max_tokens=200,
)
logger.info("Ultravox model loaded successfully")

async def main(websocket_client, stream_sid):
    """Main function to set up and run the voice agent pipeline"""
    
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
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22",  # British Lady voice
        model="sonic-english",  # Use the latest Cartesia model
        # Optional: customize other TTS parameters
        # speed=1.0,
        # emotion=["positivity:high", "curiosity:medium"]
    )

    # System message for the voice agent
    initial_messages = [
        {
            "role": "system",
            "content": """You are a helpful AI assistant taking phone calls for a restaurant. 
            You can help customers with:
            - Making reservations
            - Providing menu information
            - Answering questions about hours and location
            - General restaurant inquiries
            
            Keep responses concise and natural for voice conversation. 
            Don't use special characters or formatting in your responses as they will be converted to speech.
            Be friendly, professional, and helpful."""
        }
    ]

    # Create the pipeline with Ultravox (STT+LLM) and Cartesia (TTS)
    pipeline = Pipeline([
        transport.input(),        # Audio input from Twilio
        ultravox_processor,       # Ultravox handles both STT and LLM processing
        tts,                      # Cartesia TTS for speech synthesis
        transport.output(),       # Audio output to Twilio
    ])

    # Create pipeline task with interruption support
    task = PipelineTask(
        pipeline, 
        params=PipelineParams(allow_interruptions=True)
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        """Handle client connection - start the conversation"""
        logger.info("Client connected to voice agent")
        
        # Send initial greeting
        greeting_messages = initial_messages + [
            {
                "role": "system", 
                "content": "Please greet the customer and ask how you can help them today."
            }
        ]
        await task.queue_frames([LLMMessagesFrame(greeting_messages)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        """Handle client disconnection"""
        logger.info("Client disconnected from voice agent")
        await task.queue_frames([EndFrame()])

    # Run the pipeline
    runner = PipelineRunner(handle_sigint=False)
    
    try:
        logger.info("Starting voice agent pipeline")
        await runner.run(task)
    except Exception as e:
        logger.error(f"Error running pipeline: {e}")
        raise
    finally:
        logger.info("Voice agent pipeline ended")
