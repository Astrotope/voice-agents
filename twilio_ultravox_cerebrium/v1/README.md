# Cerebrium + Twilio + Ultravox Voice Agent

This implementation combines:
- **Cerebrium** for serverless AI deployment
- **Twilio** for phone call handling  
- **Ultravox** open-source model for STT + LLM (replacing separate ASR + LLM)
- **Cartesia** for high-quality TTS
- **PipeCat** for pipeline orchestration

## Architecture Benefits

- **Reduced Latency**: Ultravox combines STT + LLM into one model, eliminating ASR bottleneck
- **Cost Effective**: Open-source Ultravox model vs. proprietary alternatives
- **Restaurant Ready**: Pre-configured for restaurant phone calls with forwarding support
- **Auto-scaling**: Cerebrium handles scaling based on call volume

## Prerequisites

1. **Cerebrium Account**: [Sign up here](https://dashboard.cerebrium.ai/register)
2. **Twilio Account**: [Sign up here](https://www.twilio.com/try-twilio)
3. **Hugging Face Account**: [Sign up here](https://huggingface.co/signup) - needed for Ultravox model access
4. **Cartesia Account**: [Sign up here](https://play.cartesia.ai/) - for TTS service

## Setup Instructions

### 1. Install Cerebrium CLI

```bash
pip install cerebrium
cerebrium login
```

### 2. Initialize Project

```bash
cerebrium init twilio-ultravox-agent
cd twilio-ultravox-agent
```

### 3. Add Files

Copy the provided files into your project directory:
- `main.py` - FastAPI server and WebSocket handling
- `bot.py` - Voice agent pipeline with Ultravox
- `cerebrium.toml` - Deployment configuration
- `.env` - Environment variables (create from .env.example)

### 4. Configure Environment Variables

Create a `.env` file with your API keys:

```bash
# Copy the example and fill in your keys
cp .env.example .env
```

**Required API Keys:**
- `TWILIO_ACCOUNT_SID` & `TWILIO_AUTH_TOKEN` - From Twilio Console
- `HF_TOKEN` - Hugging Face token with read access
- `CARTESIA_API_KEY` - From Cartesia dashboard
- `CEREBRIUM_PROJECT_ID` - Your Cerebrium project ID

### 5. Request Ultravox Model Access

1. Go to [Ultravox Model Page](https://huggingface.co/fixie-ai/ultravox-v0_4_1-llama-3_1-8b)
2. Request access to the model (usually approved quickly)
3. Ensure your HF_TOKEN has read permissions

### 6. Upload Secrets to Cerebrium

1. Go to your [Cerebrium Dashboard](https://dashboard.cerebrium.ai)
2. Navigate to "Secrets" section
3. Upload your `.env` file

### 7. Deploy to Cerebrium

```bash
cerebrium deploy
```

**Note**: First deployment takes 5-10 minutes to download the Ultravox model. Subsequent deployments are faster.

### 8. Configure Twilio Phone Number

1. In Twilio Console, go to Phone Numbers > Manage > Active Numbers
2. Click on your phone number
3. In the "Voice" section, set:
   - **Webhook URL**: `https://api.cortex.cerebrium.ai/v4/YOUR_PROJECT_ID/twilio-ultravox-agent/`
   - **HTTP Method**: POST
4. Save the configuration

### 9. Set Up Call Forwarding (Optional)

For restaurant integration:

1. Configure your restaurant's phone system to forward calls to your Twilio number
2. Or port your existing restaurant number to Twilio
3. Update the system prompt in `bot.py` for your specific restaurant

## Testing

1. Call your Twilio phone number
2. The agent should:
   - Answer with a greeting
   - Respond to your questions about the restaurant
   - Handle interruptions naturally
   - Maintain conversation context

## Customization

### Change Voice

Edit the `voice_id` in `bot.py`:

```python
tts = CartesiaTTSService(
    api_key=os.getenv("CARTESIA_API_KEY"),
    voice_id="YOUR_PREFERRED_VOICE_ID",  # Browse Cartesia voices
    model="sonic-english",
)
```

### Modify Restaurant Prompts

Update the system message in `bot.py`:

```python
initial_messages = [
    {
        "role": "system",
        "content": """You are taking calls for [Your Restaurant Name].
        Located at [Address]. Hours: [Your Hours].
        Specialties: [Your Specialties].
        ...customize for your restaurant..."""
    }
]
```

### Scaling Configuration

Adjust in `cerebrium.toml`:

```toml
[cerebrium.scaling]
min_replicas = 1          # Always keep 1 container warm
max_replicas = 5          # Scale up to 5 for high call volume
replica_concurrency = 2   # 2 concurrent calls per container
```

## Architecture Comparison

| Component | Traditional | This Implementation |
|-----------|-------------|-------------------|
| **STT** | Separate ASR service | Integrated in Ultravox |
| **LLM** | Separate OpenAI/etc | Integrated in Ultravox |
| **TTS** | Various providers | Cartesia |
| **Latency** | ~1000ms+ | ~600ms |
| **Cost** | Higher (multiple APIs) | Lower (open source LLM) |

## Monitoring

Check logs in Cerebrium dashboard:
1. Go to your project
2. Click on "Logs" tab
3. Monitor call handling and any errors

## Troubleshooting

### Model Loading Issues
- Ensure HF_TOKEN has access to Ultravox model
- Check GPU resources are sufficient (A10 minimum)

### Call Connection Issues  
- Verify Twilio webhook URL is correct
- Check environment variables are properly uploaded to Cerebrium

### Audio Quality Issues
- Adjust Cartesia voice settings
- Check internet connection stability
- Monitor Cerebrium container health

## Cost Optimization

- Use `scaling_buffer = 0` if you don't mind cold starts
- Adjust `replica_concurrency` based on your call patterns
- Monitor usage in Cerebrium dashboard

## Support

- [Cerebrium Documentation](https://docs.cerebrium.ai/)
- [Twilio Documentation](https://www.twilio.com/docs)
- [Ultravox GitHub](https://github.com/fixie-ai/ultravox)
- [Cartesia Documentation](https://docs.cartesia.ai/)
