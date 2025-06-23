# Twilio Text-to-Speech Voices Reference

A comprehensive reference for English voice options available in Twilio's Text-to-Speech service, including Amazon Polly and Google Cloud voices.

## Amazon Polly Voices

Amazon Polly offers multiple English voices across different regional accents.

### English (US) - `en-US`
- **Ivy** - Female
- **Joanna** - Female  
- **Kendra** - Female
- **Kimberly** - Female
- **Salli** - Female
- **Joey** - Male
- **Kevin** - Male

### English (British) - `en-GB`
- **Amy** - Female
- **Emma** - Female
- **Brian** - Male

### English (Welsh) - `en-GB-WLS`
- **Geraint** - Male

### English (Australian) - `en-AU`
- **Nicole** - Female
- **Russell** - Male

### English (Indian) - `en-IN`
- **Aditi** - Female
- **Raveena** - Female

---

## Google Cloud Text-to-Speech Voices (English Only)

Google offers English voices in Standard tier only for basic applications.

### English (US) - `en-US`

**Standard Voices:**
- **en-US-Standard-A** - Male
- **en-US-Standard-B** - Male
- **en-US-Standard-C** - Female
- **en-US-Standard-D** - Male
- **en-US-Standard-E** - Female
- **en-US-Standard-F** - Female
- **en-US-Standard-G** - Female
- **en-US-Standard-H** - Female
- **en-US-Standard-I** - Male
- **en-US-Standard-J** - Male

### English (UK) - `en-GB`

**Standard Voices:**
- **en-GB-Standard-A** - Female
- **en-GB-Standard-B** - Male
- **en-GB-Standard-C** - Female
- **en-GB-Standard-D** - Male
- **en-GB-Standard-F** - Female
- **en-GB-Standard-N** - Female
- **en-GB-Standard-O** - Male

### English (Australia) - `en-AU`

**Standard Voices:**
- **en-AU-Standard-A** - Female
- **en-AU-Standard-B** - Male
- **en-AU-Standard-C** - Female
- **en-AU-Standard-D** - Male

### English (India) - `en-IN`

**Standard Voices:**
- **en-IN-Standard-A** - Female
- **en-IN-Standard-B** - Male
- **en-IN-Standard-C** - Male
- **en-IN-Standard-D** - Female
- **en-IN-Standard-E** - Female
- **en-IN-Standard-F** - Male

---

## Usage in Twilio

### Using Amazon Polly Voices
```xml
<Say voice="Polly.Joanna">Hello from Amazon Polly!</Say>
<Say voice="Polly.Amy">Hello with a British accent!</Say>
<Say voice="Polly.Nicole">G'day from Australia!</Say>
```

### Using Google Cloud Standard Voices
```xml
<Say voice="Google.en-US-Standard-C">Hello from Google Cloud!</Say>
<Say voice="Google.en-GB-Standard-A">Hello from the UK!</Say>
<Say voice="Google.en-AU-Standard-A">Hello from Australia!</Say>
```

## Voice Selection Guidelines

### For Professional/Business Use:
- **Amazon Polly**: Joanna (US), Amy (UK), Nicole (AU), Aditi (India)
- **Google Standard**: en-US-Standard-C, en-GB-Standard-A, en-AU-Standard-A

### For Male Voices:
- **Amazon Polly**: Joey, Kevin (US), Brian (UK), Russell (AU)
- **Google Standard**: en-US-Standard-A, en-GB-Standard-B, en-AU-Standard-B

### Regional Considerations:
- **US Market**: Use en-US voices for familiarity
- **UK Market**: Use en-GB voices for local accent
- **Australian Market**: Use en-AU voices for regional appeal
- **Indian Market**: Use en-IN voices for local pronunciation

## Technical Notes

- Amazon Polly voices are available across all Twilio regions
- Google Standard voices offer basic quality suitable for most applications
- Voice availability may vary based on your Twilio account type and region
- Both services support SSML (Speech Synthesis Markup Language) for pronunciation control

## Reference Documentation

- **Amazon Polly Standard Voices**: https://docs.aws.amazon.com/polly/latest/dg/standard-voices.html
- **Google Cloud Standard Voices**: https://cloud.google.com/text-to-speech/docs/list-voices-and-types#standard_voices

## Implementation Example

```javascript
// Using in TwiML for restaurant booking system
const twiml = new twilio.twiml.VoiceResponse();
twiml.say({ 
  voice: 'Polly.Joanna' 
}, 'Welcome to Bella Vista Italian Restaurant!');

// Or with Google Standard voice
twiml.say({ 
  voice: 'Google.en-US-Standard-C' 
}, 'Thank you for calling our reservation line.');
```
