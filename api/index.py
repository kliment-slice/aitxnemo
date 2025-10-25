import os
from typing import List, Optional
from pydantic import BaseModel
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request as FastAPIRequest, File, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from elevenlabs.client import ElevenLabs
from utils.prompt import ClientMessage, convert_to_openai_messages
from utils.stream import patch_response_with_headers, stream_text
from utils.tools import AVAILABLE_TOOLS, TOOL_DEFINITIONS
from utils.redis_client import ContextBusClient


# Load environment variables from .env file
load_dotenv(".env")
load_dotenv(".env.local")

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://aitxnemo.vercel.app",
        "https://*.vercel.app",  # Allow all Vercel preview deployments
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Context Bus client
context_bus = ContextBusClient()


class Request(BaseModel):
    messages: List[ClientMessage]


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "NVIDIA Nemotron API is running",
        "model": "nvidia/nvidia-nemotron-nano-9b-v2"
    }


@app.post("/api/speech-to-text")
async def speech_to_text(audio: UploadFile = File(...)):
    """Convert speech to text using ElevenLabs STT API"""
    import tempfile

    # Use ElevenLabs for speech-to-text
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
    if not elevenlabs_api_key:
        raise ValueError("ELEVENLABS_API_KEY not found in environment variables")

    client = ElevenLabs(api_key=elevenlabs_api_key)

    # Read the audio file
    audio_data = await audio.read()

    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
        temp_file.write(audio_data)
        temp_file_path = temp_file.name

    try:
        # Use ElevenLabs STT API
        with open(temp_file_path, "rb") as audio_file:
            result = client.speech_to_text.convert(
                model_id="scribe_v1",
                file=audio_file
            )

        return {"text": result.text}
    finally:
        # Clean up temp file
        import os as os_module
        if os_module.path.exists(temp_file_path):
            os_module.unlink(temp_file_path)


@app.get("/api/context-bus/events")
async def get_context_events(count: int = Query(10, ge=1, le=100)):
    """Get recent events from the context bus"""
    try:
        events = context_bus.get_recent_events(count=count)
        return {"events": events, "count": len(events)}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.get("/api/context-bus/filtered")
async def get_filtered_events(count: int = Query(10, ge=1, le=100)):
    """Get recent filtered events from the memory bank"""
    try:
        events = context_bus.get_filtered_events(count=count)
        return {"events": events, "count": len(events)}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.get("/api/context-bus/stats")
async def get_context_stats():
    """Get statistics about the context bus streams"""
    try:
        stats = context_bus.get_stream_info()
        return stats
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


class ContextEvent(BaseModel):
    prompt: str
    user_id: Optional[str] = None
    should_filter: bool = True


@app.post("/api/context-bus/add")
async def add_context_event(event: ContextEvent):
    """Add a new event to the context bus"""
    try:
        main_id, filtered_id = context_bus.filter_and_store(
            prompt=event.prompt,
            should_filter=event.should_filter
        )
        return {
            "success": True,
            "main_event_id": main_id,
            "filtered_event_id": filtered_id
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.post("/api/chat")
async def handle_chat_data(request: Request, protocol: str = Query('data')):
    messages = request.messages
    openai_messages = convert_to_openai_messages(messages)

    # Add user message to context bus
    if messages and len(messages) > 0:
        last_message = messages[-1]
        if hasattr(last_message, 'parts') and last_message.parts:
            for part in last_message.parts:
                if hasattr(part, 'type') and part.type == 'text' and hasattr(part, 'text'):
                    # Add to context bus (will be filtered)
                    context_bus.filter_and_store(part.text, should_filter=True)
                    break

    # Initialize OpenAI client with NVIDIA API
    nvidia_api_key = os.getenv("NVIDIA_API_KEY")
    if not nvidia_api_key:
        raise ValueError("NVIDIA_API_KEY not found in environment variables")

    client = OpenAI(
        api_key=nvidia_api_key,
        base_url="https://integrate.api.nvidia.com/v1"
    )

    response = StreamingResponse(
        stream_text(client, openai_messages, TOOL_DEFINITIONS, AVAILABLE_TOOLS, protocol),
        media_type="text/event-stream",
    )
    return patch_response_with_headers(response, protocol)
