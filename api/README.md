# NeMo Context Highway - FastAPI Backend

FastAPI backend for the NeMo Context Highway platform, powered by NVIDIA Nemotron, ElevenLabs, and Upstash Redis.

## 🚀 Features

### 🤖 AI & Voice
- **NVIDIA Nemotron Nano 9B v2** - Advanced language model with reasoning tokens (1024-2048)
- **ElevenLabs Speech-to-Text** - Scribe v1 model for real-time voice transcription
- **Streaming Responses** - Server-Sent Events (SSE) for real-time chat completions
- **Function Calling** - Tool support with weather API integration

### 🛣️ Context Highway (Redis Event Bus)
- **Upstash Redis Streams** - Serverless Redis for event persistence
- **Dual Stream Architecture**:
  - `context:events` - All incoming prompts
  - `context:filtered` - Filtered memory bank
- **Automatic Filtering** - Smart context preservation
- **REST API** - Full CRUD operations for context events
- **Stream Statistics** - Real-time metrics and monitoring

## 📋 Prerequisites

- **Python** 3.13.3 or higher (tested on 3.13.3)
- **NVIDIA API Key** - [Get one here](https://build.nvidia.com/)
- **ElevenLabs API Key** - [Get one here](https://elevenlabs.io/)
- **Upstash Redis** - [Create account](https://upstash.com/)

## 🛠️ Installation

### 1. Create Virtual Environment

```bash
cd api
python3 -m venv env
source env/bin/activate  # On Windows: env\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

Dependencies include:
- `fastapi>=0.120.0` - Web framework
- `uvicorn>=0.38.0` - ASGI server
- `openai>=2.6.1` - NVIDIA API client
- `elevenlabs>=1.0.0` - Speech-to-text
- `upstash-redis>=1.1.0` - Redis client
- `python-multipart>=0.0.6` - File uploads

### 3. Configure Environment

Copy the example file:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
NVIDIA_API_KEY=nvapi-your_key_here
ELEVENLABS_API_KEY=sk_your_key_here
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```

## 🚀 Running the API

### Development Mode (with auto-reload)

```bash
source env/bin/activate
uvicorn index:app --reload --host 0.0.0.0 --port 8000
```

Or from the root directory:
```bash
npm run fastapi-dev
```

### Production Mode

```bash
uvicorn index:app --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

## 🔌 API Endpoints

### Core Endpoints

#### `GET /`
Health check endpoint
```json
{
  "status": "ok",
  "message": "NVIDIA Nemotron API is running",
  "model": "nvidia/nvidia-nemotron-nano-9b-v2"
}
```

#### `POST /api/chat`
Streaming chat completions with tool support

**Request:**
```json
{
  "messages": [
    {
      "role": "user",
      "parts": [{"type": "text", "text": "Hello!"}]
    }
  ]
}
```

**Response:** Server-Sent Events (SSE) stream

**Features:**
- Automatically adds prompts to Context Bus
- Supports function calling (weather API)
- NVIDIA reasoning tokens enabled

#### `POST /api/speech-to-text`
Convert audio to text using ElevenLabs

**Request:** `multipart/form-data` with audio file

**Response:**
```json
{
  "text": "Transcribed text here"
}
```

**Supported formats:** WebM, MP3, WAV

### Context Bus Endpoints

#### `GET /api/context-bus/stats`
Get stream statistics

**Response:**
```json
{
  "total_events": 127,
  "filtered_events": 89,
  "last_event_id": "1761359832144-0"
}
```

#### `GET /api/context-bus/events?count=10`
Get recent events from main stream

**Parameters:**
- `count` (optional): Number of events (1-100, default: 10)

**Response:**
```json
{
  "events": [
    {
      "id": "1761359832144-0",
      "prompt": "What is machine learning?",
      "timestamp": "2025-10-25T02:37:12.066474",
      "user_id": "anonymous"
    }
  ],
  "count": 1
}
```

#### `GET /api/context-bus/filtered?count=10`
Get filtered events from memory bank

**Response:**
```json
{
  "events": [
    {
      "id": "1761359832144-0",
      "prompt": "Explain transformers",
      "timestamp": "2025-10-25T02:37:12.066474",
      "filter_reason": "relevant",
      "filtered": "true"
    }
  ],
  "count": 1
}
```

#### `POST /api/context-bus/add`
Manually add an event to the context bus

**Request:**
```json
{
  "prompt": "Custom prompt text",
  "user_id": "user123",
  "should_filter": true
}
```

**Response:**
```json
{
  "success": true,
  "main_event_id": "1761359832144-0",
  "filtered_event_id": "1761359832145-0"
}
```

## 🏗️ Project Structure

```
api/
├── index.py                    # Main FastAPI application
├── utils/
│   ├── redis_client.py        # Context Bus client (Upstash Redis)
│   ├── stream.py              # SSE streaming implementation
│   ├── prompt.py              # Message conversion utilities
│   ├── tools.py               # Function calling tools
│   └── attachment.py          # File attachment handling
├── requirements.txt           # Python dependencies
├── env/                       # Virtual environment (not in git)
├── .env                       # Environment variables (not in git)
└── .env.example              # Example environment file
```

## ⚙️ Configuration

### NVIDIA Nemotron Parameters

Edit `utils/stream.py` to customize model behavior:

```python
model="nvidia/nvidia-nemotron-nano-9b-v2"
temperature=0.6          # Creativity (0-1)
top_p=0.95              # Nucleus sampling
max_tokens=2048         # Response length limit
frequency_penalty=0     # Repetition penalty
presence_penalty=0      # Topic diversity
extra_body={
    "min_thinking_tokens": 1024,  # Minimum reasoning tokens
    "max_thinking_tokens": 2048   # Maximum reasoning tokens
}
```

### Context Bus Settings

Edit `utils/redis_client.py`:

```python
class ContextBusClient:
    STREAM_KEY = "context:events"           # Main event stream
    FILTERED_STREAM_KEY = "context:filtered" # Memory bank
    MAX_STREAM_LENGTH = 1000                # Max events per stream
```

## 🔧 Development

### Adding Custom Tools

1. **Define the function** in `utils/tools.py`:
```python
def my_custom_tool(param1: str, param2: int) -> dict:
    """Your tool implementation"""
    return {"result": "success"}
```

2. **Add tool definition**:
```python
TOOL_DEFINITIONS.append({
    "type": "function",
    "function": {
        "name": "my_custom_tool",
        "description": "What your tool does",
        "parameters": {
            "type": "object",
            "properties": {
                "param1": {
                    "type": "string",
                    "description": "Description"
                },
                "param2": {
                    "type": "integer",
                    "description": "Description"
                }
            },
            "required": ["param1"]
        }
    }
})
```

3. **Register the tool**:
```python
AVAILABLE_TOOLS["my_custom_tool"] = my_custom_tool
```

### Testing the Context Bus

```bash
# Get statistics
curl http://localhost:8000/api/context-bus/stats

# Fetch filtered events
curl http://localhost:8000/api/context-bus/filtered?count=5

# Add test event
curl -X POST http://localhost:8000/api/context-bus/add \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Test prompt",
    "should_filter": true
  }'
```

### Testing Speech-to-Text

```bash
curl -X POST http://localhost:8000/api/speech-to-text \
  -F "audio=@test.webm"
```

## 🐛 Troubleshooting

### Redis Connection Issues
- Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in `.env`
- Check Upstash dashboard for connection limits
- Test connection: `curl "https://your-url.upstash.io/ping"`

### NVIDIA API Errors
- Ensure API key is valid and has credits
- Check rate limits at https://build.nvidia.com/
- Model must be `nvidia/nvidia-nemotron-nano-9b-v2`

### ElevenLabs Issues
- Verify API key at https://elevenlabs.io/
- Audio must be in supported format (WebM, MP3, WAV)
- Check usage limits in ElevenLabs dashboard

## 📊 Monitoring

View logs in real-time:
```bash
# Check uvicorn logs
tail -f uvicorn.log

# Monitor Redis stream length
redis-cli -u redis://your-url XLEN context:filtered
```

## 🔒 Security Notes

- Never commit `.env` files to version control
- Use environment variables for all secrets
- Enable CORS restrictions in production
- Implement rate limiting for public APIs
- Rotate API keys regularly

## 📄 License

MIT

---

**Part of the NeMo Context Highway project**
Powered by NVIDIA Nemotron, ElevenLabs, and Upstash Redis
