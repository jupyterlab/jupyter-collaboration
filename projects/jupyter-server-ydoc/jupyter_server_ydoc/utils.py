# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from enum import Enum, IntEnum
from pathlib import Path
from typing import Tuple

from anyio import Path as AnyioPath

from ._version import __version__  # noqa

EVENTS_FOLDER_PATH = Path(__file__).parent / "events"
JUPYTER_COLLABORATION_EVENTS_URI = "https://schema.jupyter.org/jupyter_collaboration/session/v1"
EVENTS_SCHEMA_PATH = EVENTS_FOLDER_PATH / "session.yaml"
JUPYTER_COLLABORATION_AWARENESS_EVENTS_URI = (
    "https://schema.jupyter.org/jupyter_collaboration/awareness/v1"
)
JUPYTER_COLLABORATION_FORK_EVENTS_URI = "https://schema.jupyter.org/jupyter_collaboration/fork/v1"
AWARENESS_EVENTS_SCHEMA_PATH = EVENTS_FOLDER_PATH / "awareness.yaml"
FORK_EVENTS_SCHEMA_PATH = EVENTS_FOLDER_PATH / "fork.yaml"
SERVER_SESSION = str(uuid.uuid4())
YDOC_SERVER_VERSION = __version__


class MessageType(IntEnum):
    SYNC = 0
    AWARENESS = 1
    RAW = 2
    CHAT = 125


class LogLevel(Enum):
    INFO = "INFO"
    DEBUG = "DEBUG"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class OutOfBandChanges(Exception):
    pass


class ReadError(Exception):
    pass


class WriteError(Exception):
    pass


def decode_file_path(path: str) -> Tuple[str, str, str]:
    """
    Decodes a file path. The file path is composed by the format,
    content type, and path or file id separated by ':'.

        Parameters:
            path (str): File path.

        Returns:
            components (Tuple[str, str, str]): A tuple with the format,
                content type, and path or file id.
    """
    format, file_type, file_id = path.split(":", 2)
    return (format, file_type, file_id)


def encode_file_path(format: str, file_type: str, file_id: str) -> str:
    """
    Encodes a file path. The file path is composed by the format,
    content type, and path or file id separated by ':'.

        Parameters:
            format (str): File format.
            type (str): Content type.
            path (str): Path or file id.

        Returns:
            path (str): File path.
    """
    return f"{format}:{file_type}:{file_id}"


def room_id_from_encoded_path(encoded_path: str) -> str:
    """Transforms the encoded path into a stable room identifier."""
    return encoded_path.split("/")[-1]


async def _get_jupyter_session_store(root_dir: str) -> AnyioPath:
    """Return path to the session store file in .jupyter folder."""
    try:
        expanded = await AnyioPath(root_dir).expanduser()
        resolved = await expanded.resolve()
        jupyter_dir = resolved / ".jupyter"
        await jupyter_dir.mkdir(parents=True, exist_ok=True)
        return jupyter_dir / "collaboration_sessions.json"
    except OSError:
        # In case if the server root dir is read-only
        return AnyioPath(os.devnull)


async def _load_previous_sessions(root_dir: str) -> dict:
    """Load previous session records from .jupyter folder."""
    store_path = await _get_jupyter_session_store(root_dir)
    if await store_path.exists():
        try:
            sessions = json.loads(await store_path.read_text())
            # Ensure the loaded JSON is a dict mapping session IDs to dicts.
            if not isinstance(sessions, dict):
                return {}
            clean_sessions = {}
            for key, value in sessions.items():
                if isinstance(value, dict):
                    clean_sessions[str(key)] = value
            return clean_sessions
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


async def save_current_session(
    root_dir: str,
    session_id: str,
    version: str,
    lock: asyncio.Lock,
    document_version: str | None = None,
) -> None:
    """Persist the current session ID, server version, and optionally 
    document version to .jupyter folder."""
    store_path = await _get_jupyter_session_store(root_dir)
    sessions = await _load_previous_sessions(root_dir)

    sessions[session_id] = {
        "version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if document_version is not None:
        sessions[session_id]["document_version"] = document_version

    # Keep only the last 10 sessions to avoid unbounded growth
    if len(sessions) > 10:
        oldest_key = sorted(sessions, key=lambda k: sessions[k].get("created_at", ""))[0]
        del sessions[oldest_key]

    try:
        async with lock:
            await store_path.write_text(json.dumps(sessions, indent=2))
    except IOError:
        pass


async def check_session_compatibility(
    root_dir: str,
    client_session_id: str,
    current_version: str,
    current_document_version: str | None = None,
) -> tuple[bool, str]:
    """
    Determine whether a client carrying an old session ID can reconnect or not.

    Returns:
        (cannot_reconnect: bool, reason: str)
    """
    if client_session_id == SERVER_SESSION:
        return False, ""

    previous_sessions = await _load_previous_sessions(root_dir)

    # Session ID not in our records at all → unknown origin, reject
    if client_session_id not in previous_sessions:
        return True, "unknown_session"

    previous = previous_sessions[client_session_id]
    previous_version = previous.get("version", "")

    # Collaboration package version changed → reject
    if previous_version != current_version:
        return True, "version_mismatch"

    # Check document version if both old and new sessions have it
    if current_document_version is not None:
        previous_document_version = previous.get("document_version")
        if (
            previous_document_version is not None
            and previous_document_version != current_document_version
        ):
            return True, "version_mismatch"

    # Same directory + same versions → safe to reconnect
    return False, ""
