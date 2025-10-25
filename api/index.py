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
NEMOTRON_MODEL = "nvidia/NVIDIA-Nemotron-Nano-9B-v2"
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

    async with httpx.AsyncClient(timeout=60) as client:
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

    # Use ElevenLabs for speech-to-text
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
    if not elevenlabs_api_key:
        raise ValueError("ELEVENLABS_API_KEY not found in environment variables")

    client = ElevenLabs(api_key=elevenlabs_api_key)

    # Read the audio file
    audio_data = await audio.read()

    # Validate that we have audio data
    if len(audio_data) == 0:
        raise HTTPException(status_code=400, detail="No audio data received")

    # Determine file extension based on content type
    content_type = audio.content_type or ""
    if "webm" in content_type:
        suffix = ".webm"
    elif "mp4" in content_type or "mp4a" in content_type:
        suffix = ".mp4"
    elif "mpeg" in content_type or "mp3" in content_type:
        suffix = ".mp3"
    elif "wav" in content_type:
        suffix = ".wav"
    else:
        suffix = ".webm"  # default

    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_file.write(audio_data)
        temp_file.flush()
        temp_file_path = temp_file.name

    try:
        # Use ElevenLabs STT API - pass filename with extension
        with open(temp_file_path, "rb") as audio_file:
            result = client.speech_to_text.convert(
                model_id="scribe_v1",
                file=(f"recording{suffix}", audio_file, content_type or "audio/webm")
            )

        return {"text": result.text}
    except Exception as e:
        # Log the error for debugging
        print(f"STT Error: {str(e)}")
        print(f"Audio size: {len(audio_data)} bytes")
        print(f"Content type: {content_type}")
        raise HTTPException(
            status_code=500,
            detail=f"Speech-to-text failed: {str(e)}"
        )
    finally:
        # Clean up temp file
        import os as os_module
        if os_module.path.exists(temp_file_path):
            os_module.unlink(temp_file_path)


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

    # Try to get AI summary, but continue if it fails
    cosmos_summary = text_content
    try:
        cosmos_response = client.chat.completions.create(
            model=COSMOS_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"{text_content}\n\n"
                        "Summarize this traffic report in under 120 words. "
                        "Identify the location, root cause, lanes or routes affected, "
                        "and immediate operational recommendations."
                    ),
                }
            ],
            temperature=0.2,
            max_tokens=512,
        )
        cosmos_summary = cosmos_response.choices[0].message.content.strip() if cosmos_response.choices else text_content
    except Exception as e:
        print(f"Warning: Cosmos summary failed: {e}")
        cosmos_summary = text_content

    # Default evaluation payload
    evaluation_payload = {
        "include_in_context": True,
        "severity": "medium",
        "summary": cosmos_summary,
        "reason": "Traffic report submitted by operator"
    }

    # Try to get AI evaluation, but use defaults if it fails
    try:
        evaluation_prompt = (
            "You are the NVIDIA Nemotron Nano-9B traffic incident evaluator. "
            "Determine whether the following report requires escalation into the Context Highway. "
            "Return a JSON object with keys: include_in_context (boolean), severity (low|medium|high), "
            "summary (refined concise synopsis), and reason (short explanation). "
            "Report:\n"
            f"{cosmos_summary}\n\n"
            "Original Text:\n"
            f"{text.strip() or 'N/A'}"
        )

        evaluation_response = client.chat.completions.create(
            model=NEMOTRON_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": evaluation_prompt,
                }
            ],
            temperature=0.1,
            max_tokens=256,
        )

        evaluation_text = evaluation_response.choices[0].message.content if evaluation_response.choices else ""
        parsed_payload = extract_json_block(evaluation_text)
        if parsed_payload:
            evaluation_payload = parsed_payload
    except Exception as e:
        print(f"Warning: Nemotron evaluation failed: {e}")
        # evaluation_payload already has defaults

    include_flag = bool(evaluation_payload.get("include_in_context"))
    severity = str(evaluation_payload.get("severity", "unknown")).lower()
    if severity not in {"low", "medium", "high"}:
        severity = "unknown"
    refined_summary = evaluation_payload.get("summary") or cosmos_summary
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

    # Always try to extract coordinates from the text using Toolhouse agent
    # This ensures we get the location mentioned in the report, not the user's GPS location
    extracted_coords = None
    if text.strip():
        print(f"[Toolhouse] Calling agent to extract coordinates from text: {text[:100]}...")
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

    # Add coordinates to metadata if available
    if latitude and longitude:
        context_metadata["latitude"] = latitude
        context_metadata["longitude"] = longitude

    bus = get_context_bus()
    if bus:
        try:
            main_event_id = bus.add_event(
                prompt=refined_summary,
                user_id=display_name or None,
                metadata=context_metadata,
            )
            if include_flag:
                filtered_event_id = bus.add_filtered_event(
                    prompt=refined_summary,
                    filter_reason=rationale,
                    metadata=context_metadata,
                )
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
        }
    )

    return {
        "success": True,
        "evaluation": evaluation_payload,
        "cosmos_summary": cosmos_summary,
        "attachments": attachment_meta,
        "toolhouse": toolhouse_result,
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

        # Add the update as a new event to the context bus
        update_metadata = {
            "type": "update",
            "original_event_id": request.event_id,
            "original_prompt": request.original_prompt,
            "source": "flag-update"
        }

        update_id = bus.add_event(
            prompt=f"UPDATE: {request.update}",
            metadata=update_metadata
        )

        # Also add to filtered stream
        filtered_id = bus.add_filtered_event(
            prompt=f"UPDATE: {request.update}",
            filter_reason="event_update",
            metadata=update_metadata
        )

        return {
            "success": True,
            "update_id": update_id,
            "filtered_id": filtered_id
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
