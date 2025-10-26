import os
import base64
import json
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from pydantic import BaseModel
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    Form,
    Query,
    Request as FastAPIRequest,
    File,
    UploadFile,
    HTTPException,
)
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from elevenlabs.client import ElevenLabs
import httpx
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
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # Allow all Vercel preview deployments
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Context Bus client (lazy initialization to prevent startup crashes)
context_bus = None

COSMOS_MODEL = "nvidia/vila"
NEMOTRON_MODEL = "nvidia/nvidia-nemotron-nano-9b-v2"
TOOLHOUSE_AGENT_URL = os.getenv("TOOLHOUSE_AGENT_URL", None)


def get_context_bus():
    """Lazy initialization of context bus to handle connection errors gracefully"""
    global context_bus
    if context_bus is None:
        try:
            context_bus = ContextBusClient()
        except Exception as e:
            print(f"Warning: Failed to initialize ContextBusClient: {e}")
            # Return None to allow app to continue without context bus
            return None
    return context_bus


def get_nvidia_client() -> OpenAI:
    """Create an OpenAI client configured for NVIDIA's Integrate API."""
    nvidia_api_key = os.getenv("NVIDIA_API_KEY")
    if not nvidia_api_key:
        raise HTTPException(
            status_code=500,
            detail="NVIDIA_API_KEY not configured",
        )

    return OpenAI(
        api_key=nvidia_api_key,
        base_url="https://integrate.api.nvidia.com/v1",
    )


def _to_dict(response) -> Dict:
    """Attempt to coerce OpenAI SDK responses into plain dictionaries."""
    if response is None:
        return {}
    if isinstance(response, dict):
        return response
    if hasattr(response, "model_dump"):
        try:
            return response.model_dump()
        except Exception:
            pass
    if hasattr(response, "to_dict_recursive"):
        try:
            return response.to_dict_recursive()
        except Exception:
            pass
    if hasattr(response, "dict"):
        try:
            return response.dict()
        except Exception:
            pass
    try:
        return json.loads(response.json())
    except Exception:
        return {}


def extract_output_text(response) -> str:
    """Extract the primary text content from a responses.create result."""
    data = _to_dict(response)

    # Preferred: responses output array
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                return content["text"]

    # Legacy fallback: choices structure
    for choice in data.get("choices", []):
        message = choice.get("message", {})
        if isinstance(message, dict):
            if "content" in message and isinstance(message["content"], list):
                for content in message["content"]:
                    if (
                        isinstance(content, dict)
                        and content.get("type") in {"output_text", "text"}
                        and content.get("text")
                    ):
                        return content["text"]
            if message.get("content"):
                return message["content"]
            if message.get("text"):
                return message["text"]

    # Direct text convenience property
    if data.get("output_text"):
        return data["output_text"]

    return ""


def extract_json_block(payload: str) -> Dict:
    """Parse a JSON object from a model response, trimming code fences if needed."""
    if not payload:
        return {}
    trimmed = payload.strip()
    # Remove markdown fences
    if trimmed.startswith("```"):
        trimmed = trimmed.split("```", maxsplit=2)
        if len(trimmed) > 1:
            trimmed = trimmed[1]
        else:
            trimmed = trimmed[0]
        trimmed = trimmed.strip()
    if trimmed.startswith("json"):
        trimmed = trimmed[4:].strip()

    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        start = payload.find("{")
        end = payload.rfind("}")
        if start != -1 and end != -1 and end > start:
            snippet = payload[start : end + 1]
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                return {}
    return {}


async def build_cosmos_content(
    text: str,
    attachments: Optional[List[UploadFile]],
) -> Tuple[List[Dict], List[Dict]]:
    """
    Prepare multimodal content blocks for Cosmos Nemotron and collect metadata.

    Returns:
        tuple of (content_blocks, attachment_metadata)
    """
    content: List[Dict] = []
    metadata: List[Dict] = []

    if text and text.strip():
        content.append(
            {"type": "input_text", "text": text.strip()},
        )

    if attachments:
        for upload in attachments:
            try:
                data = await upload.read()
                encoded = base64.b64encode(data).decode("utf-8")
                media_type = upload.content_type or ""
                info = {
                    "filename": upload.filename,
                    "media_type": media_type,
                    "size_bytes": len(data),
                }

                if media_type.startswith("image/"):
                    content.append(
                        {
                            "type": "input_image",
                            "image_base64": encoded,
                            "media_type": media_type,
                        }
                    )
                elif media_type.startswith("video/"):
                    content.append(
                        {
                            "type": "input_video",
                            "video_base64": encoded,
                            "media_type": media_type,
                        }
                    )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported file type: {media_type or 'unknown'}",
                    )

                metadata.append(info)
            finally:
                await upload.close()

    content.append(
        {
            "type": "input_text",
            "text": (
                "Summarize this traffic report in under 120 words. "
                "Identify the location, root cause, lanes or routes affected, "
                "and immediate operational recommendations."
            ),
        }
    )

    return content, metadata


def extract_coordinates_from_response(response_data: Dict) -> Optional[Dict[str, float]]:
    """
    Extract latitude and longitude from Toolhouse agent response.

    Returns:
        Dict with 'latitude' and 'longitude' keys, or None if not found.
    """
    try:
        import re

        # Try to find coordinates in the result
        result = response_data.get("result", {})

        print(f"[extract_coordinates] Searching in result: {result}")

        # Check if coordinates are directly in the result
        if isinstance(result, dict):
            if "latitude" in result and "longitude" in result:
                coords = {
                    "latitude": float(result["latitude"]),
                    "longitude": float(result["longitude"])
                }
                print(f"[extract_coordinates] Found direct fields: {coords}")
                return coords

            # Check in output text for coordinate patterns
            output = result.get("output", "")

            # Also check other common field names
            if not output:
                output = result.get("text", "")
            if not output:
                output = result.get("content", "")
            if not output:
                output = str(result)

            print(f"[extract_coordinates] Searching in text: {output[:200]}...")

            if isinstance(output, str):
                # Look for patterns like "latitude: 37.7749, longitude: -122.4194"
                coord_pattern = r"latitude:\s*(-?\d+\.?\d*),?\s*longitude:\s*(-?\d+\.?\d*)"
                coord_match = re.search(coord_pattern, output, re.IGNORECASE)

                if coord_match:
                    coords = {
                        "latitude": float(coord_match.group(1)),
                        "longitude": float(coord_match.group(2))
                    }
                    print(f"[extract_coordinates] Found with coord_pattern: {coords}")
                    return coords

                # Fallback: Look for lat/lng patterns
                lat_pattern = r"(?:lat(?:itude)?[:\s]+)(-?\d+\.?\d*)"
                lng_pattern = r"(?:lng|lon(?:gitude)?[:\s]+)(-?\d+\.?\d*)"

                lat_match = re.search(lat_pattern, output, re.IGNORECASE)
                lng_match = re.search(lng_pattern, output, re.IGNORECASE)

                if lat_match and lng_match:
                    coords = {
                        "latitude": float(lat_match.group(1)),
                        "longitude": float(lng_match.group(1))
                    }
                    print(f"[extract_coordinates] Found with lat/lng pattern: {coords}")
                    return coords

        print(f"[extract_coordinates] No coordinates found in response")
        return None
    except Exception as e:
        print(f"[extract_coordinates] Error: {e}")
        import traceback
        traceback.print_exc()
        return None


async def trigger_toolhouse_agent(
    summary: str,
    severity: str,
    raw_text: str,
    extract_coordinates: bool = False,
) -> Dict:
    """
    Trigger Toolhouse agent via the streaming API endpoint.

    Returns:
        Dict with status information and optionally extracted coordinates.
    """
    if not TOOLHOUSE_AGENT_URL:
        return {
            "status": "skipped (missing TOOLHOUSE_AGENT_URL)",
        }

    # Build the payload for the agent
    if extract_coordinates:
        # Extract location from the raw text and add context
        location_hint = raw_text if raw_text else summary

        payload = {
            "message": (
                f"GEOCODE THIS LOCATION WITH HIGH PRECISION: {location_hint}\n\n"
                "If the location doesn't specify a city, assume it's in Austin, Texas.\n\n"
                "REQUIRED: Use the Google Maps geocoding tool to get PRECISE coordinates for the exact intersection or location.\n"
                "For street intersections, geocode the EXACT intersection point, not nearby addresses.\n"
                "Return your response in this exact format with at least 4 decimal places:\n"
                "latitude: XX.XXXX, longitude: YY.YYYY\n\n"
                "Then provide traffic conditions and alternate routes.\n\n"
                "DO NOT ask for more information. DO NOT say you cannot retrieve coordinates. "
                "You MUST use the geocoding tool available to you and provide the most accurate coordinates possible."
            ),
        }
    else:
        payload = {
            "summary": summary,
            "severity": severity,
            "raw_report": raw_text,
            "instructions": (
                "Leverage Google Maps via the MCP server to validate congestion, "
                "suggest detours, and surface navigation notes for control rooms."
            ),
        }

    headers = {
        "Content-Type": "application/json",
    }

    # Increase timeout and add connection pooling for better reliability
    timeout_config = httpx.Timeout(timeout=120.0, connect=30.0)
    limits = httpx.Limits(max_keepalive_connections=5, max_connections=10)
    async with httpx.AsyncClient(timeout=timeout_config, limits=limits) as client:
        try:
            # Call the Toolhouse agent streaming API
            response = await client.post(
                TOOLHOUSE_AGENT_URL,
                headers=headers,
                json=payload,
            )
            response.raise_for_status()

            # Try to parse response
            try:
                result_data = response.json()
            except Exception:
                result_data = {"output": response.text}

            return {
                "status": "completed",
                "run_id": result_data.get("id", "unknown"),
                "result": result_data,
            }
        except httpx.HTTPError as exc:
            return {
                "status": "failed",
                "error": str(exc),
            }


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
    import os as os_module

    # Use ElevenLabs for speech-to-text
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
    if not elevenlabs_api_key:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not found in environment variables")

    client = ElevenLabs(api_key=elevenlabs_api_key)

    # Read the audio file
    audio_data = await audio.read()

    # Validate that we have audio data
    if len(audio_data) == 0:
        raise HTTPException(status_code=400, detail="No audio data received")

    # Enhanced audio validation
    if len(audio_data) < 1000:  # Less than 1KB is likely too short
        raise HTTPException(status_code=400, detail="Audio data too short - may be empty or corrupted")

    # Determine file extension and content type with better detection
    content_type = audio.content_type or ""
    print(f"[STT] Received audio: size={len(audio_data)} bytes, content_type='{content_type}'")

    # More specific content type handling prioritizing STT-friendly formats
    content_lower = content_type.lower()
    if "wav" in content_lower:
        suffix = ".wav"
        mime_type = "audio/wav"
    elif "mp4" in content_lower or "m4a" in content_lower:
        suffix = ".m4a"
        mime_type = "audio/mp4"
    elif "mpeg" in content_lower or "mp3" in content_lower:
        suffix = ".mp3"
        mime_type = "audio/mpeg"
    elif "webm" in content_lower:
        suffix = ".webm"
        mime_type = "audio/webm"
    elif "ogg" in content_lower:
        suffix = ".ogg"
        mime_type = "audio/ogg"
    else:
        # Default to MP4 for better STT compatibility
        suffix = ".m4a"
        mime_type = "audio/mp4"
        print(f"[STT] Unknown content type '{content_type}', defaulting to MP4/M4A for better STT compatibility")

    # Create temp file with proper extension
    temp_file_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio_data)
            temp_file.flush()
            temp_file_path = temp_file.name

        print(f"[STT] Created temp file: {temp_file_path} with suffix {suffix}")

        # Try different approaches for ElevenLabs API with progressive fallback
        result = None
        last_error = None

        # List of models to try in order of preference
        models_to_try = [
            ("turbo_v2", "Latest turbo model"),
            ("turbo_v2.5", "Enhanced turbo model v2.5"),
            ("scribe_english_v2", "English-optimized model v2"),
            ("scribe_v1", "Original scribe model"),
            (None, "Default model")
        ]

        for model_id, description in models_to_try:
            try:
                print(f"[STT] Trying {description} (model_id: {model_id})...")

                with open(temp_file_path, "rb") as audio_file:
                    if model_id:
                        result = client.speech_to_text.convert(
                            model_id=model_id,
                            file=(f"recording{suffix}", audio_file, mime_type)
                        )
                    else:
                        # Try without specifying model (uses default)
                        result = client.speech_to_text.convert(
                            file=(f"recording{suffix}", audio_file, mime_type)
                        )

                print(f"[STT] Success with {description}: '{result.text}'")
                break  # Success, stop trying other models

            except Exception as e:
                last_error = e
                print(f"[STT] {description} failed: {str(e)[:200]}...")
                continue  # Try next model

        if result is None:
            print(f"[STT] All models failed. Last error: {last_error}")
            raise last_error or Exception("All STT models failed")

        # Validate the result
        if not result or not hasattr(result, 'text'):
            raise HTTPException(status_code=500, detail="ElevenLabs returned empty result")

        transcribed_text = result.text.strip() if result.text else ""

        # Check for common error patterns in transcription that indicate poor audio quality
        error_patterns = [
            "(clicking noise)",
            "(background noise)",
            "(inaudible)",
            "eleven louse",
            "elevenlouse",
            "11 louse",
            "eleven labs",
            "eleven lab",
            "test test test",
            "...",
            "unintelligible",
            "unclear audio",
            "static",
            "silence"
        ]

        # Also check for very short or repetitive transcriptions that might indicate issues
        suspicious_patterns = [
            "a",
            "the",
            "and",
            "uh",
            "um",
            "ah"
        ]

        text_lower = transcribed_text.lower().strip()

        # Check for obvious error patterns
        if any(pattern in text_lower for pattern in error_patterns):
            print(f"[STT] Warning: Detected error pattern in transcription: '{transcribed_text}'")
            # Don't reject, but log the issue

        # Check for suspiciously short single-word transcriptions
        words = transcribed_text.strip().split()
        if len(words) == 1 and words[0].lower() in suspicious_patterns:
            print(f"[STT] Warning: Suspiciously short transcription (single word): '{transcribed_text}'")
            print("[STT] This might indicate poor audio quality or very short recording")

        # Check for very short transcriptions that might be spurious
        if len(transcribed_text.strip()) < 3:
            print(f"[STT] Warning: Very short transcription: '{transcribed_text}' - may indicate audio issues")

        if len(transcribed_text) == 0:
            print("[STT] Warning: Empty transcription result")
            return {"text": "", "warning": "Empty transcription - audio may be silent or too short"}

        print(f"[STT] Final transcription: '{transcribed_text}'")
        return {"text": transcribed_text}

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Log detailed error information
        print(f"[STT] Unexpected error: {str(e)}")
        print(f"[STT] Audio size: {len(audio_data)} bytes")
        print(f"[STT] Content type: {content_type}")
        print(f"[STT] Detected MIME type: {mime_type}")
        print(f"[STT] File suffix: {suffix}")

        # Import traceback for detailed error logging
        import traceback
        traceback.print_exc()

        raise HTTPException(
            status_code=500,
            detail=f"Speech-to-text conversion failed: {str(e)}"
        )
    finally:
        # Clean up temp file
        if temp_file_path and os_module.path.exists(temp_file_path):
            try:
                os_module.unlink(temp_file_path)
                print(f"[STT] Cleaned up temp file: {temp_file_path}")
            except Exception as cleanup_error:
                print(f"[STT] Failed to cleanup temp file: {cleanup_error}")


@app.get("/api/context-bus/events")
async def get_context_events(count: int = Query(10, ge=1, le=100)):
    """Get recent events from the context bus"""
    try:
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )
        events = bus.get_recent_events(count=count)
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
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )
        events = bus.get_filtered_events(count=count)
        return {"events": events, "count": len(events)}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.get("/api/context-bus/rejected")
async def get_rejected_events(count: int = Query(10, ge=1, le=100)):
    """Get recent rejected events from the filtered stream"""
    try:
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )
        events = bus.get_rejected_events(count=count)
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
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )
        stats = bus.get_stream_info()
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


@app.post("/api/traffic-intake")
async def process_traffic_intake(
    text: str = Form(""),
    display_name: Optional[str] = Form(None),
    latitude: Optional[str] = Form(None),
    longitude: Optional[str] = Form(None),
    attachments: Optional[List[UploadFile]] = File(None),
):
    """Handle multimodal traffic intake, filtering, and routing."""
    if not text.strip() and not attachments:
        raise HTTPException(
            status_code=400,
            detail="Provide a description or at least one attachment.",
        )

    try:
        client = get_nvidia_client()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create NVIDIA client: {exc}",
        ) from exc

    attachments_list = attachments or []

    try:
        _, attachment_meta = await build_cosmos_content(
            text,
            attachments_list,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to prepare attachments: {exc}",
        ) from exc

    # Build a text representation of the content for the summary
    text_content = text.strip() if text.strip() else "Traffic report with attachments"

    # PRE-FILTER: Check if content is traffic-related using Nemotron
    # SECURITY: Default to FALSE - content must PROVE it's traffic-related
    is_traffic_related = False
    traffic_relevance_reason = "Default rejection for security"

    # Enhanced keyword check - look for meaningful traffic context, not just words
    # First check for obvious non-traffic phrases that should be rejected
    reject_phrases = [
        'bogus', 'non traffic', 'not traffic', 'fake', 'test message', 'spam',
        'hello', 'hi there', 'how are you', 'almost done', 'i\'m done', 'finished'
    ]

    # Real traffic keywords that indicate legitimate traffic content
    traffic_keywords = [
        # Incidents
        'accident', 'crash', 'collision', 'wreck', 'fender bender',
        # Blockages
        'blocking', 'blocked', 'stalled', 'disabled', 'breakdown', 'stuck',
        # Construction & Infrastructure
        'construction', 'road work', 'lane closure', 'closure', 'closed',
        # Traffic Conditions
        'congestion', 'jam', 'backup', 'slow', 'heavy traffic', 'delay',
        'detour', 'alternate route',
        # Vehicles & Objects
        'truck', 'car', 'vehicle', 'bus', 'motorcycle', 'debris', 'pothole',
        # Roads & Locations
        'intersection', 'street', 'road', 'highway', 'freeway', 'lane',
        'bridge', 'tunnel', 'exit', 'ramp', 'overpass',
        # Austin Specific
        'i-35', 'mopac', '183', '290', 'loop', 'toll', 'downtown', 'austin',
        'lavaca', 'congress', 'guadalupe', 'lamar', 'burnet'
    ]

    text_lower = text_content.lower()

    # First check for obvious rejection patterns
    has_reject_phrases = any(phrase in text_lower for phrase in reject_phrases)

    # Then check for legitimate traffic keywords (require more specific context)
    has_traffic_keywords = any(keyword in text_lower for keyword in traffic_keywords)

    if has_reject_phrases:
        print(f"[Keyword Filter] Reject phrases detected in: '{text_content[:50]}...'")
        has_traffic_keywords = False
    elif not has_traffic_keywords:
        print(f"[Keyword Filter] No specific traffic keywords found in: '{text_content[:50]}...'")
        has_traffic_keywords = False

    if not has_traffic_keywords:
        print(f"[Keyword Filter] REJECTED - No traffic keywords found in: '{text_content[:50]}...'")
        is_traffic_related = False
        traffic_relevance_reason = "No traffic keywords detected - immediate rejection"
    else:
        print("[Keyword Filter] PASSED - Traffic keywords found, proceeding with AI filter")

    # Only call AI filter if keywords were found
    if has_traffic_keywords:
        try:
            relevance_prompt = (
            "You are a STRICT traffic relevance filter. Your job is to REJECT anything that is not clearly traffic-related. "
            "ONLY ACCEPT content that explicitly mentions: roads, traffic, accidents, construction, vehicles, "
            "intersections, highways, streets, lanes, congestion, detours, road closures, traffic lights, "
            "parking, transportation incidents, or specific traffic-related locations.\n\n"
            "REJECT ALL content that is:\n"
            "- General conversation (\"i'm almost done\", \"hello\", \"how are you\")\n"
            "- Status updates without traffic context\n"
            "- Test messages or random text\n"
            "- Personal messages or chat\n"
            "- Spam or irrelevant content\n"
            "- Anything without clear traffic/transportation context\n\n"
            "Return ONLY a JSON object: {\"is_traffic_related\": boolean, \"reason\": \"explanation\"}\n\n"
            f"Content to evaluate: \"{text_content}\"\n\n"
            "Is this clearly about traffic/transportation? Be STRICT - when in doubt, REJECT."
        )

            relevance_response = client.chat.completions.create(
                model=NEMOTRON_MODEL,
                messages=[
                    {"role": "system", "content": "/think"},
                    {
                        "role": "user",
                        "content": relevance_prompt,
                    }
                ],
                temperature=0.6,
                top_p=0.95,
                max_tokens=150,
                frequency_penalty=0,
                presence_penalty=0,
                extra_body={
                    "min_thinking_tokens": 1024,
                    "max_thinking_tokens": 2048
                }
            )

            # Safely extract response content with proper null checks
            relevance_text = ""
            if relevance_response and relevance_response.choices and len(relevance_response.choices) > 0:
                if relevance_response.choices[0].message and relevance_response.choices[0].message.content:
                    relevance_text = relevance_response.choices[0].message.content

            print(f"[AI Filter] Raw response: {relevance_text[:200] if relevance_text else 'Empty response'}...")

            if not relevance_text:
                # Empty response from AI - default to accepting since keywords passed
                print("[AI Filter] Empty response from Nemotron, but keywords passed - defaulting to ACCEPT")
                is_traffic_related = True
                traffic_relevance_reason = "AI returned empty response but keywords detected - accepted"
            else:
                relevance_data = extract_json_block(relevance_text)
                print(f"[AI Filter] Parsed JSON: {relevance_data}")

                if relevance_data and "is_traffic_related" in relevance_data:
                    # Only set to True if AI explicitly confirms it's traffic-related
                    ai_says_traffic = bool(relevance_data.get("is_traffic_related", False))
                    if ai_says_traffic:
                        is_traffic_related = True
                        traffic_relevance_reason = relevance_data.get("reason", "AI confirmed traffic-related")
                    else:
                        is_traffic_related = False
                        traffic_relevance_reason = relevance_data.get("reason", "AI rejected as non-traffic")
                else:
                    # If keywords passed but AI failed, default to ACCEPTING for obvious traffic keywords
                    print("[AI Filter] JSON parsing failed, but keywords passed - defaulting to ACCEPT")
                    is_traffic_related = True
                    traffic_relevance_reason = f"AI parsing failed but keywords detected - accepted (raw: {relevance_text[:100]})"

            print(f"[AI Filter] Content: '{text_content[:50]}...' | Relevant: {is_traffic_related} | Reason: {traffic_relevance_reason}")

        except Exception as e:
            print(f"Warning: Traffic relevance filter failed: {e}")
            # If keywords passed but AI failed, default to ACCEPTING since keywords are reliable
            is_traffic_related = True
            traffic_relevance_reason = f"AI error but keywords detected - accepted ({str(e)[:50]})"

    # Only generate AI summary for traffic-related content using Nemotron-9B-v2
    nemotron_summary = text_content
    if is_traffic_related:
        try:
            print("[Nemotron] Generating summary for traffic-related content")
            nemotron_response = client.chat.completions.create(
                model=NEMOTRON_MODEL,
                messages=[
                    {"role": "system", "content": "/think"},
                    {
                        "role": "user",
                        "content": (
                            f"You are the NVIDIA Nemotron traffic incident summarizer. "
                            f"Summarize this traffic report in under 120 words. "
                            f"Identify the location, root cause, lanes or routes affected, "
                            f"and immediate operational recommendations.\n\n"
                            f"Traffic Report:\n{text_content}"
                        ),
                    }
                ],
                temperature=0.6,
                top_p=0.95,
                max_tokens=512,
                frequency_penalty=0,
                presence_penalty=0,
                extra_body={
                    "min_thinking_tokens": 1024,
                    "max_thinking_tokens": 2048
                }
            )
            nemotron_summary = nemotron_response.choices[0].message.content.strip() if nemotron_response.choices else text_content
        except Exception as e:
            print(f"Warning: Nemotron summary failed: {e}")
            nemotron_summary = text_content
    else:
        # For non-traffic content, use the original text without AI processing
        nemotron_summary = f"[NON-TRAFFIC]: {text_content}"
        print("[Nemotron] Skipping AI summary generation for non-traffic content")

    # Determine initial routing based on traffic relevance
    if not is_traffic_related:
        # Non-traffic content goes directly to Filtered, not Memory
        evaluation_payload = {
            "include_in_context": False,  # Force to Filtered only
            "severity": "irrelevant",
            "summary": f"[FILTERED - Non-traffic content]: {nemotron_summary}",
            "reason": f"Content rejected by traffic filter: {traffic_relevance_reason}"
        }
        print("[Traffic Filter] Content marked as irrelevant - will only go to Filtered stream")
    else:
        # Default evaluation payload for traffic-related content
        evaluation_payload = {
            "include_in_context": True,
            "severity": "medium",
            "summary": nemotron_summary,
            "reason": "Traffic report submitted by operator"
        }

        # Try to get AI evaluation for traffic-related content, but use defaults if it fails
        try:
            evaluation_prompt = (
                "You are the NVIDIA Nemotron Nano-9B traffic incident evaluator. "
                "Determine whether the following report requires escalation into the Context Highway. "
                "Return a JSON object with keys: include_in_context (boolean), severity (low|medium|high), "
                "summary (refined concise synopsis), and reason (short explanation). "
                "Report:\n"
                f"{nemotron_summary}\n\n"
                "Original Text:\n"
                f"{text.strip() or 'N/A'}"
            )

            evaluation_response = client.chat.completions.create(
                model=NEMOTRON_MODEL,
                messages=[
                    {"role": "system", "content": "/think"},
                    {
                        "role": "user",
                        "content": evaluation_prompt,
                    }
                ],
                temperature=0.6,
                top_p=0.95,
                max_tokens=256,
                frequency_penalty=0,
                presence_penalty=0,
                extra_body={
                    "min_thinking_tokens": 1024,
                    "max_thinking_tokens": 2048
                }
            )

            evaluation_text = evaluation_response.choices[0].message.content if evaluation_response.choices else ""
            parsed_payload = extract_json_block(evaluation_text)
            if parsed_payload:
                # Merge AI evaluation with defaults, ensuring traffic-related content defaults to include_in_context=True
                parsed_payload.setdefault("include_in_context", True)
                parsed_payload.setdefault("severity", "medium")
                parsed_payload.setdefault("summary", nemotron_summary)
                parsed_payload.setdefault("reason", "Traffic report submitted by operator")
                evaluation_payload.update(parsed_payload)
                print(f"[AI Evaluation] Merged payload: include_in_context={evaluation_payload.get('include_in_context')}, severity={evaluation_payload.get('severity')}")
        except Exception as e:
            print(f"Warning: Nemotron evaluation failed: {e}")
            # evaluation_payload already has defaults

    include_flag = bool(evaluation_payload.get("include_in_context"))
    severity = str(evaluation_payload.get("severity", "unknown")).lower()
    if severity not in {"low", "medium", "high", "irrelevant"}:
        severity = "unknown"
    refined_summary = evaluation_payload.get("summary") or nemotron_summary
    rationale = evaluation_payload.get("reason") or "No rationale provided."

    main_event_id: Optional[str] = None
    filtered_event_id: Optional[str] = None
    context_metadata = {
        "display_name": display_name or "anonymous",
        "severity": severity,
        "reason": rationale,
        "attachments": attachment_meta,
        "source": "traffic-intake",
    }

    # Only try to extract coordinates for traffic-related content
    extracted_coords = None
    if text.strip() and is_traffic_related:
        print(f"[Toolhouse] Calling agent to extract coordinates from traffic-related text: {text[:100]}...")
        toolhouse_coord_result = await trigger_toolhouse_agent(
            summary=refined_summary,
            severity=severity,
            raw_text=text,
            extract_coordinates=True,
        )

        print(f"[Toolhouse] Agent response status: {toolhouse_coord_result.get('status')}")
        print(f"[Toolhouse] Full response: {toolhouse_coord_result}")

        if toolhouse_coord_result.get("status") == "completed":
            extracted_coords = extract_coordinates_from_response(toolhouse_coord_result)
            print(f"[Toolhouse] Extracted coordinates: {extracted_coords}")

            if extracted_coords:
                # Use Toolhouse-extracted coordinates (from the report text)
                # OVERRIDE any user GPS coordinates
                # Ensure we preserve full precision (no rounding)
                latitude = f"{extracted_coords['latitude']:.10f}".rstrip('0').rstrip('.')
                longitude = f"{extracted_coords['longitude']:.10f}".rstrip('0').rstrip('.')
                print(f"✓ Using Toolhouse coordinates (full precision): {latitude}, {longitude}")
            else:
                print("⚠ Toolhouse couldn't extract coordinates from response")
                if latitude and longitude:
                    print(f"⚠ Falling back to user GPS coordinates: {latitude}, {longitude}")
        else:
            print(f"⚠ Toolhouse call failed with status: {toolhouse_coord_result.get('status')}")
            if latitude and longitude:
                print(f"⚠ Falling back to user GPS coordinates: {latitude}, {longitude}")
    else:
        print("[Toolhouse] Skipping coordinate extraction - content is not traffic-related")

    # Add coordinates to metadata ONLY for traffic-related content
    if latitude and longitude and is_traffic_related:
        context_metadata["latitude"] = latitude
        context_metadata["longitude"] = longitude
        print(f"[Metadata] Added coordinates for traffic-related content: {latitude}, {longitude}")
    elif latitude and longitude and not is_traffic_related:
        print(f"[Metadata] Suppressing coordinates for non-traffic content: {latitude}, {longitude}")
    else:
        print("[Metadata] No coordinates to add")

    bus = get_context_bus()
    if bus:
        try:
            # Always add to main event stream for audit purposes
            main_event_id = bus.add_event(
                prompt=refined_summary,
                user_id=display_name or None,
                metadata=context_metadata,
            )

            # Routing logic based on traffic relevance and AI evaluation
            if not is_traffic_related:
                # Non-traffic content: Goes to audit + rejected stream (increments "Filtered" counter)
                rejected_event_id = bus.add_rejected_event(
                    prompt=refined_summary,
                    reject_reason=f"NON-TRAFFIC: {rationale}",
                    metadata=context_metadata,
                )
                filtered_event_id = None
                print(f"[Context Bus] Non-traffic content routed to rejected stream: {rejected_event_id}")
            elif include_flag:
                # Traffic-related content that passed AI evaluation: Goes to Memory (filtered stream)
                filtered_event_id = bus.add_filtered_event(
                    prompt=refined_summary,
                    filter_reason=rationale,
                    metadata=context_metadata,
                )
                print(f"[Context Bus] Traffic content routed to Memory (filtered stream) - ID: {filtered_event_id}")
                print("[Memory Bank] ✓ COUNTER SHOULD INCREMENT - New event added to memory bank")
            else:
                # Traffic-related but low priority: Also skip filtered stream
                filtered_event_id = None
                print("[Context Bus] Low-priority traffic content - audit only")
        except Exception as exc:
            print(f"Warning: Failed to store traffic intake in context bus: {exc}")

    # We already extracted coordinates above, so we can skip the second Toolhouse call
    # The coordinate extraction call already provides traffic analysis in its response
    toolhouse_result: Dict = {"status": "skipped - coordinates already extracted"}

    evaluation_payload.update(
        {
            "include_in_context": include_flag,
            "summary": refined_summary,
            "reason": rationale,
            "severity": severity,
            "main_event_id": main_event_id,
            "filtered_event_id": filtered_event_id,
            "toolhouse_status": toolhouse_result.get("status"),
            "toolhouse_run_id": toolhouse_result.get("run_id"),
            "toolhouse_last_checked": datetime.now().isoformat(),
            "is_traffic_related": is_traffic_related,
            "traffic_filter_reason": traffic_relevance_reason,
        }
    )

    return {
        "success": True,
        "evaluation": evaluation_payload,
        "nemotron_summary": nemotron_summary,
        "attachments": attachment_meta,
        "toolhouse": toolhouse_result,
        "traffic_filtering": {
            "is_traffic_related": is_traffic_related,
            "filter_reason": traffic_relevance_reason,
            "routing_decision": "Memory" if (is_traffic_related and include_flag) else "Filtered only"
        }
    }


@app.post("/api/context-bus/add")
async def add_context_event(event: ContextEvent):
    """Add a new event to the context bus"""
    try:
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )
        main_id, filtered_id = bus.filter_and_store(
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


class FlagEventRequest(BaseModel):
    event_id: str
    update: str
    original_prompt: str


@app.post("/api/context-bus/flag")
async def flag_event(request: FlagEventRequest):
    """Flag an event with an update report"""
    try:
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )

        # Generate a comprehensive update summary using Nemotron
        try:
            client = get_nvidia_client()

            # Create a prompt for Nemotron to generate a contextual update
            summary_prompt = (
                "You are the NVIDIA Nemotron traffic update summarizer. "
                "Generate a concise update report that references the original incident. "
                "Format your response as a single paragraph that includes:\n"
                "1. A brief quote or reference to the original incident\n"
                "2. The new update information\n"
                "3. Current status or implications\n\n"
                f"ORIGINAL INCIDENT: \"{request.original_prompt}\"\n\n"
                f"UPDATE REPORT: \"{request.update}\"\n\n"
                "Generate a contextual summary that clearly connects the update to the original incident:"
            )

            summary_response = client.chat.completions.create(
                model=NEMOTRON_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": summary_prompt,
                    }
                ],
                temperature=0.2,
                max_tokens=300,
            )

            enhanced_summary = summary_response.choices[0].message.content if summary_response.choices else None

        except Exception as e:
            print(f"Warning: Nemotron summary generation failed: {e}")
            # Fallback to basic format
            enhanced_summary = f"UPDATE regarding \"{request.original_prompt[:100]}{'...' if len(request.original_prompt) > 100 else ''}\": {request.update}"

        # Use enhanced summary if available, otherwise use fallback
        update_prompt = enhanced_summary or f"UPDATE: {request.update}"

        # Add the update as a new event to the context bus with enhanced metadata
        update_metadata = {
            "type": "update",
            "original_event_id": request.event_id,
            "original_prompt": request.original_prompt,
            "raw_update": request.update,
            "enhanced_summary": enhanced_summary,
            "source": "flag-update",
            "timestamp": datetime.now().isoformat()
        }

        update_id = bus.add_event(
            prompt=update_prompt,
            metadata=update_metadata
        )

        # Also add to filtered stream
        filtered_id = bus.add_filtered_event(
            prompt=update_prompt,
            filter_reason="event_update_with_context",
            metadata=update_metadata
        )

        return {
            "success": True,
            "update_id": update_id,
            "filtered_id": filtered_id,
            "enhanced_summary": enhanced_summary,
            "original_reference": request.original_prompt[:100] + ("..." if len(request.original_prompt) > 100 else "")
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


class ArchiveEventRequest(BaseModel):
    event_id: str


@app.post("/api/context-bus/archive")
async def archive_event(request: ArchiveEventRequest):
    """Archive (delete) an event from the context bus"""
    try:
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )

        # Delete the event from both Redis streams
        success = bus.delete_event(request.event_id, from_filtered=True)

        if not success:
            return JSONResponse(
                status_code=500,
                content={"error": "Failed to delete event from Redis"}
            )

        return {
            "success": True,
            "event_id": request.event_id,
            "message": "Event permanently deleted from context bus"
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.delete("/api/context-bus/rejected/all")
async def delete_all_rejected_events():
    """Delete all rejected events from the rejected stream"""
    try:
        bus = get_context_bus()
        if bus is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Context bus not available"}
            )

        # Get count before deletion
        events_before = bus.get_rejected_events(count=1000)  # Get a large number to count all
        count_before = len(events_before)

        # Delete all events from rejected stream
        success = bus.clear_rejected_stream()

        if not success:
            return JSONResponse(
                status_code=500,
                content={"error": "Failed to clear rejected events stream"}
            )

        return {
            "success": True,
            "deleted_count": count_before,
            "message": f"Successfully deleted {count_before} rejected events"
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.post("/api/chat")
async def handle_chat_data(request: Request, protocol: str = Query('data')):
    try:
        messages = request.messages
        openai_messages = convert_to_openai_messages(messages)

        # Add user message to context bus
        if messages and len(messages) > 0:
            last_message = messages[-1]
            if hasattr(last_message, 'parts') and last_message.parts:
                for part in last_message.parts:
                    if hasattr(part, 'type') and part.type == 'text' and hasattr(part, 'text'):
                        # Add to context bus (will be filtered)
                        try:
                            bus = get_context_bus()
                            if bus:
                                bus.filter_and_store(part.text, should_filter=True)
                        except Exception as e:
                            print(f"Warning: Failed to store in context bus: {e}")
                        break

        # Initialize OpenAI client with NVIDIA API
        try:
            client = get_nvidia_client()
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"error": exc.detail},
            )

        response = StreamingResponse(
            stream_text(client, openai_messages, TOOL_DEFINITIONS, AVAILABLE_TOOLS, protocol),
            media_type="text/event-stream",
        )
        return patch_response_with_headers(response, protocol)
    except Exception as e:
        print(f"Error in handle_chat_data: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": type(e).__name__}
        )
