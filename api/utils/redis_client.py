import os
from typing import List, Dict, Optional
from datetime import datetime
from upstash_redis import Redis

class ContextBusClient:
    """Redis Stream client for managing the Context Highway event bus"""

    STREAM_KEY = "context:events"
    FILTERED_STREAM_KEY = "context:filtered"
    MAX_STREAM_LENGTH = 1000

    def __init__(self):
        """Initialize Upstash Redis client"""
        redis_url = os.getenv("UPSTASH_REDIS_REST_URL", "https://engaged-yeti-29190.upstash.io")
        redis_token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "AXIGAAIncDIwMzJhMDBjNmQ4NmI0ZTdlYjc4ZjM3OTkzYWY5MjQzZXAyMjkxOTA")

        self.redis = Redis(url=redis_url, token=redis_token)

    def add_event(self, prompt: str, user_id: Optional[str] = None, metadata: Optional[Dict] = None) -> str:
        """
        Add a new event to the context stream

        Args:
            prompt: The user prompt/message
            user_id: Optional user identifier
            metadata: Optional additional metadata

        Returns:
            Event ID from Redis stream
        """
        event_data = {
            "prompt": prompt,
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id or "anonymous",
        }

        if metadata:
            event_data["metadata"] = str(metadata)

        # Add to stream with auto-generated ID
        # upstash-redis signature: xadd(key, id, data, maxlen=None, ...)
        event_id = self.redis.xadd(
            key=self.STREAM_KEY,
            id="*",  # Auto-generate ID
            data=event_data,
            maxlen=self.MAX_STREAM_LENGTH
        )

        return event_id

    def add_filtered_event(self, prompt: str, filter_reason: str = "relevant", metadata: Optional[Dict] = None) -> str:
        """
        Add a filtered event to the filtered stream (memory bank)

        Args:
            prompt: The filtered prompt
            filter_reason: Reason for filtering (e.g., "relevant", "contextual")
            metadata: Optional additional metadata

        Returns:
            Event ID from Redis stream
        """
        event_data = {
            "prompt": prompt,
            "timestamp": datetime.utcnow().isoformat(),
            "filter_reason": filter_reason,
            "filtered": "true",
        }

        if metadata:
            event_data["metadata"] = str(metadata)

        event_id = self.redis.xadd(
            key=self.FILTERED_STREAM_KEY,
            id="*",  # Auto-generate ID
            data=event_data,
            maxlen=self.MAX_STREAM_LENGTH
        )

        return event_id

    def get_recent_events(self, count: int = 10, stream_key: Optional[str] = None) -> List[Dict]:
        """
        Get recent events from the stream

        Args:
            count: Number of events to retrieve
            stream_key: Which stream to query (defaults to main stream)

        Returns:
            List of event dictionaries
        """
        key = stream_key or self.STREAM_KEY

        # Read last N events using XREVRANGE
        events = self.redis.xrevrange(key, "+", "-", count=count)

        if not events:
            return []

        # Format events
        # xrevrange returns: [[id, [k1, v1, k2, v2, ...]], ...]
        formatted_events = []
        for event_entry in events:
            event_id = event_entry[0]
            event_fields = event_entry[1]

            # Convert flat list [k1, v1, k2, v2] to dict
            event_data = {}
            for i in range(0, len(event_fields), 2):
                key_name = event_fields[i]
                value = event_fields[i + 1]
                event_data[key_name] = value

            event = {
                "id": event_id,
                **event_data
            }
            formatted_events.append(event)

        return formatted_events

    def get_filtered_events(self, count: int = 10) -> List[Dict]:
        """Get recent filtered events from the memory bank"""
        return self.get_recent_events(count=count, stream_key=self.FILTERED_STREAM_KEY)

    def get_stream_info(self) -> Dict:
        """
        Get information about the streams

        Returns:
            Dictionary with stream stats
        """
        try:
            main_info = self.redis.xinfo_stream(self.STREAM_KEY)
            filtered_info = self.redis.xinfo_stream(self.FILTERED_STREAM_KEY)

            return {
                "total_events": main_info.get("length", 0),
                "filtered_events": filtered_info.get("length", 0),
                "last_event_id": main_info.get("last-generated-id", "0-0"),
            }
        except Exception:
            # Streams might not exist yet
            return {
                "total_events": 0,
                "filtered_events": 0,
                "last_event_id": "0-0",
            }

    def filter_and_store(self, prompt: str, should_filter: bool = True) -> tuple[str, Optional[str]]:
        """
        Add event to main stream and optionally to filtered stream

        Args:
            prompt: The user prompt
            should_filter: Whether to add to filtered stream

        Returns:
            Tuple of (main_event_id, filtered_event_id)
        """
        main_id = self.add_event(prompt)
        filtered_id = None

        if should_filter:
            filtered_id = self.add_filtered_event(prompt, filter_reason="relevant")

        return main_id, filtered_id
