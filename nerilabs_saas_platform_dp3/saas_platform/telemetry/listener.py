"""
Telemetry Listener & Event Beacon Ingestion Service.
Ingests batched HTTP beacons from the client SDK (scroll depth, dwell time, clicks, conversions)
with strict deduplication (Constraint 5.4).
"""

from typing import List, Dict, Any
from saas_platform.models.schemas import TelemetryEventDTO, EventType
from saas_platform.models.database import db


class TelemetryListener:
    _listeners = []

    @classmethod
    def register_event_listener(cls, callback):
        cls._listeners.append(callback)

    @classmethod
    def ingest_beacon_batch(cls, events: List[TelemetryEventDTO]) -> Dict[str, Any]:
        accepted = 0
        duplicates = 0

        for evt in events:
            is_new = db.record_telemetry_event(evt)
            if is_new:
                accepted += 1
                # Notify registered listeners (e.g. MAB engine, friction engine)
                for listener in cls._listeners:
                    try:
                        listener(evt)
                    except Exception as e:
                        print(f"Telemetry listener error: {e}")
            else:
                duplicates += 1

        return {
            "status": "processed",
            "batch_size": len(events),
            "accepted": accepted,
            "duplicates_ignored": duplicates
        }
