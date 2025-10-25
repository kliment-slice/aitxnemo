# NeMo Context Highway

An intelligent traffic incident reporting and management platform powered by NVIDIA Nemotron, ElevenLabs, Toolhouse, and Google Maps, featuring a real-time Redis-backed context bus for advanced memory management and intelligent traffic routing.

![NVIDIA Green](https://img.shields.io/badge/Powered%20by-NVIDIA-76B900?style=for-the-badge&logo=nvidia)
![ElevenLabs](https://img.shields.io/badge/Voice-ElevenLabs-00B4D8?style=for-the-badge)
![Redis](https://img.shields.io/badge/Memory-Upstash%20Redis-DC382D?style=for-the-badge&logo=redis)
![Toolhouse](https://img.shields.io/badge/Agents-Toolhouse-4A90E2?style=for-the-badge)

## 🌐 Live Demo

- **Frontend**: [https://aitxnemo.vercel.app/](https://aitxnemo.vercel.app/)
- **API**: Deployed on Railway

## 🚀 Features

### 🚦 **Traffic Incident Reporting**
- **Multimodal Input** - Report via voice, text, photo, or video
- **Voice Recording** - Real-time speech-to-text with ElevenLabs Scribe v1
- **Camera Integration** - Quick tap for photo, hold for 5-second video
- **Live Location** - Automatic geolocation for accurate incident positioning

### 🤖 **AI-Powered Incident Processing**
- **NVIDIA Cosmos Nemotron 34B** - Advanced multimodal understanding for text and visual analysis
- **NVIDIA Nemotron Nano 9B v2** - Intelligent filtering and severity classification
- **Automatic Summarization** - AI generates concise incident summaries
- **Severity Detection** - Classifies incidents as low, medium, or high priority

### 🛣️ **Context Highway - Redis Stream Event Bus**
- **Real-time Memory Bank** - All incidents stored in Upstash Redis streams
- **Smart Filtering** - Intelligent context filtering for critical incidents
- **Live Visualization** - Watch events flow through the context bus in real-time
- **Event Statistics** - Track total events, filtered events, and memory usage
- **Auto-refresh** - Context updates every 5 seconds

### 🗺️ **Live Traffic Map**
- **Google Maps Integration** - Real-time map centered on user's location
- **Custom Dark Theme** - NVIDIA-themed map styling with green accents
- **Geolocation** - Automatic location detection with permissions
- **Interactive Controls** - Street view, zoom, map type controls

### 🤝 **Toolhouse Agent Integration**
- **Automated Response** - Triggers agents for high-priority incidents
- **Google Maps Validation** - Verifies congestion via MCP server
- **Route Suggestions** - Provides detour recommendations
- **Control Room Alerts** - Surfaces navigation notes for traffic management

### 🎨 **NVIDIA-Themed UI**
- **Official NVIDIA Colors** - Signature green (#00ffaa) throughout the interface
- **Dark Mode** - Sleek black background with green/cyan accents
- **Responsive Design** - Built with Next.js 16 and TailwindCSS
- **Framer Motion Animations** - Smooth transitions and interactions

## 📋 Prerequisites

- **Node.js** 20.19.2 or higher
- **Python** 3.13.3 or higher
- **NVIDIA API Key** - [Get one here](https://build.nvidia.com/)
- **ElevenLabs API Key** - [Get one here](https://elevenlabs.io/)
- **Upstash Redis** - [Create account](https://upstash.com/)
- **Toolhouse API Key** - [Get one here](https://toolhouse.ai/)
- **Google Maps API Key** - [Get one here](https://console.cloud.google.com/)

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

Create `.env.local` in the root directory:
```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
NEXT_PUBLIC_API_URL=http://localhost:8000  # or your Railway URL for production
```

Create `.env` in the `api/` directory:
```env
NVIDIA_API_KEY=your_nvidia_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_token_here
TOOLHOUSE_API_KEY=your_toolhouse_api_key_here
TOOLHOUSE_AGENT_URL=https://agents.toolhouse.ai/your-agent-id
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

### 3. Enable Google Maps APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the following APIs:
   - Maps JavaScript API
   - Geolocation API

### 4. Run the Application

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
│  - Traffic Report UI with Voice/Camera                      │
│  - Live Google Maps Integration                             │
│  - Context Bus Visualization                                │
│  - Real-time Event Streaming                                │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                           │
│  - NVIDIA Cosmos Nemotron 34B (Multimodal)                  │
│  - NVIDIA Nemotron Nano 9B v2 (Filtering)                   │
│  - ElevenLabs Speech-to-Text                                │
│  - Context Bus Manager                                       │
│  - Toolhouse Agent Trigger                                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  Upstash Redis Streams                       │
│  - context:events (all incidents)                           │
│  - context:filtered (high-priority memory bank)             │
└─────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Toolhouse Agent (Async)                         │
│  - Google Maps MCP Server                                   │
│  - Congestion Validation                                    │
│  - Detour Suggestions                                       │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
aitxnemo/
├── app/                      # Next.js app directory
│   ├── layout.tsx           # Root layout with metadata
│   ├── globals.css          # NVIDIA-themed styles
│   ├── page.tsx             # Landing page with live map
│   └── new-user/
│       └── page.tsx         # Traffic report submission
├── components/              # React components
│   ├── navbar.tsx          # Header with NCH branding
│   ├── overview.tsx        # Context Bus + Map visualization
│   ├── traffic-map.tsx     # Google Maps component
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
├── hooks/
│   └── use-voice-recording.ts # Voice recording hook
└── public/
    └── NCH.png             # NeMo Context Highway logo
```

## 🔌 API Endpoints

### Traffic Reporting
- `POST /api/traffic-intake` - Submit traffic incident with multimodal data
- `POST /api/speech-to-text` - Convert audio to text using ElevenLabs

### Context Bus
- `GET /api/context-bus/stats` - Get stream statistics
- `GET /api/context-bus/events` - Retrieve recent events
- `GET /api/context-bus/filtered` - Get filtered memory bank events
- `POST /api/context-bus/add` - Manually add events

### Chat (Legacy)
- `POST /api/chat` - Streaming chat completions with tool support

## 🎨 Customization

### NVIDIA Colors
Defined in `tailwind.config.js`:
```javascript
colors: {
  'nvidia-green': '#00ffaa',
  'nvidia-cyan': '#00e5ff',
  'nvidia-purple': '#7B1FA2'
}
```

### Model Configuration
Edit `api/index.py` to adjust NVIDIA models:
```python
COSMOS_MODEL = "nvidia/cosmos-nemotron-34b-instruct"  # Multimodal analysis
NEMOTRON_MODEL = "nvidia/nemotron-nano-9b-v2"         # Filtering
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

# Submit traffic incident
curl -X POST http://localhost:8000/api/traffic-intake \
  -F "text=Heavy traffic on I-280 northbound" \
  -F "attachments=@photo.jpg"
```

## 📦 Dependencies

### Frontend
- **Next.js 16** with Turbopack
- **React 19**
- **TailwindCSS** with NVIDIA custom colors
- **Framer Motion** for animations
- **@vis.gl/react-google-maps** for map integration
- **AI SDK** for chat streaming

### Backend
- **FastAPI** - Modern Python web framework
- **Uvicorn** - ASGI server
- **OpenAI SDK** - NVIDIA API client
- **ElevenLabs SDK** - Speech-to-text
- **Upstash Redis** - Serverless Redis for streams
- **httpx** - Async HTTP client for Toolhouse

## 🚀 Deployment

### Frontend (Vercel)
```bash
vercel --prod
```

### Backend (Railway)
1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy from `api/` directory

## 🎯 Use Cases

1. **Citizen Traffic Reporting** - Allow drivers to report incidents via voice/camera
2. **Emergency Response** - Route high-priority incidents to control rooms
3. **Real-time Traffic Management** - AI-powered congestion detection and routing
4. **Public Safety** - Multimodal incident documentation with GPS coordinates

## 🤝 Contributing

This is a demo project showcasing the integration of NVIDIA Nemotron, ElevenLabs, Toolhouse, and Google Maps for intelligent traffic management. Feel free to fork and customize for your needs.

## 📄 License

MIT

---

**Powered by NVIDIA, ElevenLabs, Toolhouse & Google Maps**
