import os
import json
from typing import List, Dict, Optional
from datetime import datetime
from upstash_redis import Redis

class ContextBusClient:
    """Redis Stream client for managing the Context Highway event bus"""

    STREAM_KEY = "context:events"
    FILTERED_STREAM_KEY = "context:filtered"  # High-priority traffic (Memory)
    REJECTED_STREAM_KEY = "context:rejected"  # Filtered out content (Filtered)
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
            event_data["metadata"] = json.dumps(metadata)

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
            event_data["metadata"] = json.dumps(metadata)

        event_id = self.redis.xadd(
            key=self.FILTERED_STREAM_KEY,
            id="*",  # Auto-generate ID
            data=event_data,
            maxlen=self.MAX_STREAM_LENGTH
        )

        return event_id

    def add_rejected_event(self, prompt: str, reject_reason: str = "filtered", metadata: Optional[Dict] = None) -> str:
        """
        Add a rejected/filtered event to the rejected stream

        Args:
            prompt: The rejected prompt
            reject_reason: Reason for rejection (e.g., "non-traffic", "spam")
            metadata: Optional additional metadata

        Returns:
            Event ID from Redis stream
        """
        event_data = {
            "prompt": prompt,
            "timestamp": datetime.utcnow().isoformat(),
            "reject_reason": reject_reason,
            "rejected": "true",
        }

        if metadata:
            event_data["metadata"] = json.dumps(metadata)

        event_id = self.redis.xadd(
            key=self.REJECTED_STREAM_KEY,
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

        try:
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
        except Exception:
            # Stream might not exist yet
            return []

    def get_filtered_events(self, count: int = 10) -> List[Dict]:
        """Get recent filtered events from the memory bank"""
        return self.get_recent_events(count=count, stream_key=self.FILTERED_STREAM_KEY)

    def get_rejected_events(self, count: int = 10) -> List[Dict]:
        """Get recent rejected events from the filtered stream"""
        return self.get_recent_events(count=count, stream_key=self.REJECTED_STREAM_KEY)

    def get_stream_info(self) -> Dict:
        """
        Get information about the streams

        Returns:
            Dictionary with stream stats
        """
        def safe_get_stream_length(stream_key: str) -> int:
            """Safely get stream length, return 0 if stream doesn't exist"""
            try:
                # Use xlen (more reliable for Upstash Redis)
                return self.redis.xlen(stream_key)
            except Exception:
                # Stream doesn't exist yet or other error
                return 0

        def safe_get_last_id(stream_key: str) -> str:
            """Safely get last generated ID, return 0-0 if stream doesn't exist"""
            try:
                # Get recent events to find last ID
                events = self.redis.xrevrange(stream_key, "+", "-", count=1)
                if events and len(events) > 0:
                    return events[0][0]  # First element is the ID
                return "0-0"
            except Exception:
                return "0-0"

        return {
            "total_events": safe_get_stream_length(self.STREAM_KEY),
            "memory_events": safe_get_stream_length(self.FILTERED_STREAM_KEY),  # High-priority traffic
            "filtered_events": safe_get_stream_length(self.REJECTED_STREAM_KEY),  # Rejected content
            "last_event_id": safe_get_last_id(self.STREAM_KEY),
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

    def delete_event(self, event_id: str, from_filtered: bool = True) -> bool:
        """
        Delete an event from the Redis streams

        Args:
            event_id: The ID of the event to delete
            from_filtered: Whether to also delete from filtered stream

        Returns:
            True if deletion was successful
        """
        try:
            # Delete from main stream
            self.redis.xdel(self.STREAM_KEY, event_id)

            # Also delete from filtered stream if requested
            if from_filtered:
                self.redis.xdel(self.FILTERED_STREAM_KEY, event_id)

            return True
        except Exception as e:
            print(f"Error deleting event {event_id}: {e}")
            return False

    def clear_rejected_stream(self) -> bool:
        """
        Clear all events from the rejected stream

        Returns:
            True if clearing was successful
        """
        try:
            # Delete the entire stream (this removes all events)
            # Redis XTRIM with MAXLEN 0 effectively clears the stream
            self.redis.xtrim(self.REJECTED_STREAM_KEY, maxlen=0)
            print(f"[Redis] Cleared all events from rejected stream: {self.REJECTED_STREAM_KEY}")
            return True
        except Exception as e:
            print(f"Error clearing rejected stream: {e}")
            return False
