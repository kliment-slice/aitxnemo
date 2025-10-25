# NeMo Context Highway

An intelligent conversational AI platform powered by NVIDIA Nemotron and ElevenLabs, featuring a real-time Redis-backed context bus for advanced memory management and contextual awareness.

![NVIDIA Green](https://img.shields.io/badge/Powered%20by-NVIDIA-76B900?style=for-the-badge&logo=nvidia)
![ElevenLabs](https://img.shields.io/badge/Voice-ElevenLabs-00B4D8?style=for-the-badge)
![Redis](https://img.shields.io/badge/Memory-Upstash%20Redis-DC382D?style=for-the-badge&logo=redis)

## 🚀 Features

### 🎙️ **Voice-Enabled AI Chat**
- **NVIDIA Nemotron Nano 9B v2** - Advanced language model with reasoning capabilities
- **ElevenLabs Speech-to-Text** - Real-time voice input with the Scribe v1 model
- **Streaming Responses** - Server-Sent Events (SSE) for real-time chat completions
- **Tool Support** - Function calling with weather API integration

### 🛣️ **Context Highway - Redis Stream Event Bus**
- **Real-time Memory Bank** - All prompts automatically stored in Upstash Redis streams
- **Smart Filtering** - Intelligent context filtering for memory persistence
- **Live Visualization** - Watch events flow through the context bus in real-time
- **Event Statistics** - Track total events, filtered events, and memory usage
- **Auto-refresh** - Context updates every 5 seconds

### 🎨 **NVIDIA-Themed UI**
- **Official NVIDIA Colors** - Signature green (#76B900) throughout the interface
- **Dark Mode** - Sleek black background with green accents
- **Responsive Design** - Built with Next.js 16 and TailwindCSS
- **Framer Motion Animations** - Smooth transitions and interactions

## 📋 Prerequisites

- **Node.js** 20.19.2 or higher
- **Python** 3.13.3 or higher
- **NVIDIA API Key** - [Get one here](https://build.nvidia.com/)
- **ElevenLabs API Key** - [Get one here](https://elevenlabs.io/)
- **Upstash Redis** - [Create account](https://upstash.com/)

## 🛠️ Installation

### 1. Clone and Install Dependencies

```bash
# Install JavaScript dependencies
npm install

# Install Python dependencies
cd api
python3 -m venv env
source env/bin/activate  # On Windows: env\Scripts\activate
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment Variables

Create `.env.local` in the root directory (for Next.js):
```bash
cp .env.example .env.local
```

Create `.env` in the `api/` directory (already configured):
```env
NVIDIA_API_KEY=your_nvidia_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_token_here
```

### 3. Run the Application

From the repository root:
```bash
npm run dev
```

This starts both servers concurrently:
- **Next.js Frontend**: `http://localhost:3000`
- **FastAPI Backend**: `http://localhost:8000`

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Frontend                         │
│  - Chat Interface with Voice Input                          │
│  - Context Bus Visualization                                │
│  - Real-time Event Streaming                                │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                           │
│  - NVIDIA Nemotron Integration                              │
│  - ElevenLabs Speech-to-Text                                │
│  - Context Bus Manager                                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  Upstash Redis Streams                       │
│  - context:events (all prompts)                             │
│  - context:filtered (memory bank)                           │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
aitxnemo/
├── app/                      # Next.js app directory
│   ├── layout.tsx           # Root layout with metadata
│   ├── globals.css          # NVIDIA-themed styles
│   └── (chat)/
│       └── page.tsx         # Main chat page
├── components/              # React components
│   ├── navbar.tsx          # Header with NCH branding
│   ├── overview.tsx        # Context Bus visualization
│   ├── chat.tsx            # Chat interface
│   └── multimodal-input.tsx # Voice + text input
├── api/                     # FastAPI backend
│   ├── index.py            # Main FastAPI app
│   ├── utils/
│   │   ├── redis_client.py # Context Bus client
│   │   ├── stream.py       # SSE streaming
│   │   ├── prompt.py       # Message conversion
│   │   └── tools.py        # Function calling tools
│   └── requirements.txt    # Python dependencies
└── public/
    └── NCH.png             # NeMo Context Highway logo
```

## 🔌 API Endpoints

### Chat & Voice
- `POST /api/chat` - Streaming chat completions with tool support
- `POST /api/speech-to-text` - Convert audio to text using ElevenLabs

### Context Bus
- `GET /api/context-bus/stats` - Get stream statistics
- `GET /api/context-bus/events` - Retrieve recent events
- `GET /api/context-bus/filtered` - Get filtered memory bank events
- `POST /api/context-bus/add` - Manually add events

## 🎨 Customization

### NVIDIA Colors
Defined in `tailwind.config.js`:
```javascript
colors: {
  'nvidia-green': '#76B900',
  'nvidia-cyan': '#00B4D8',
  'nvidia-purple': '#7B1FA2'
}
```

### Model Configuration
Edit `api/utils/stream.py` to adjust NVIDIA Nemotron parameters:
```python
model="nvidia/nvidia-nemotron-nano-9b-v2"
temperature=0.6
max_tokens=2048
extra_body={
    "min_thinking_tokens": 1024,
    "max_thinking_tokens": 2048
}
```

## 🧪 Development

### Running Separately

**Frontend only:**
```bash
npm run next-dev
```

**Backend only:**
```bash
npm run fastapi-dev
# or
cd api && source env/bin/activate && uvicorn index:app --reload
```

### Testing the Context Bus

```bash
# Check stream statistics
curl http://localhost:8000/api/context-bus/stats

# Get filtered events
curl http://localhost:8000/api/context-bus/filtered?count=10

# Add a test event
curl -X POST http://localhost:8000/api/context-bus/add \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Test message", "should_filter": true}'
```

## 📦 Dependencies

### Frontend
- **Next.js 16** with Turbopack
- **React 19**
- **TailwindCSS** with NVIDIA custom colors
- **Framer Motion** for animations
- **AI SDK** for chat streaming

### Backend
- **FastAPI** - Modern Python web framework
- **Uvicorn** - ASGI server
- **OpenAI SDK** - NVIDIA API client
- **ElevenLabs SDK** - Speech-to-text
- **Upstash Redis** - Serverless Redis for streams

## 🤝 Contributing

This is a demo project showcasing the integration of NVIDIA Nemotron, ElevenLabs, and Redis streams. Feel free to fork and customize for your needs.

## 📄 License

MIT

---

**Powered by NVIDIA & ElevenLabs**
