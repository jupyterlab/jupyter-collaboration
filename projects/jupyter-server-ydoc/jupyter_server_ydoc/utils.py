# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from enum import Enum, IntEnum
from pathlib import Path
from typing import Tuple
import json
import uuid
from datetime import datetime, timezone
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

def _get_jupyter_session_store(root_dir: str) -> Path:
    """Return path to the session store file in .jupyter folder."""
    jupyter_dir = Path(root_dir).expanduser().resolve() / ".jupyter"
    jupyter_dir.mkdir(parents=True, exist_ok=True)
    return jupyter_dir / "collaboration_sessions.json"


def _load_previous_sessions(root_dir: str) -> dict:
    """Load previous session records from .jupyter folder."""
    store_path = _get_jupyter_session_store(root_dir)
    if store_path.exists():
        try:
            with open(store_path, "r") as f:
                sessions = json.load(f)
                return sessions
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_current_session(root_dir: str, session_id: str, version: str) -> None:
    """Persist the current session ID and version to .jupyter folder."""
    store_path = _get_jupyter_session_store(root_dir)
    sessions = _load_previous_sessions(root_dir)

    sessions[session_id] = {
        "version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Keep only the last 10 sessions to avoid unbounded growth
    if len(sessions) > 10:
        oldest_key = sorted(sessions, key=lambda k: sessions[k].get("created_at", ""))[0]
        del sessions[oldest_key]

    try:
        with open(store_path, "w") as f:
            json.dump(sessions, f, indent=2)
    except IOError as e:
        pass


def check_session_compatibility(
    root_dir: str,
    client_session_id: str,
    current_version: str,
) -> tuple[bool, str]:
    """
    Determine whether a client carrying an old session ID can reconnect.

    Returns:
        (can_reconnect: bool, reason: str)
    """
    if client_session_id == SERVER_SESSION:
        return True, ""

    previous_sessions = _load_previous_sessions(root_dir)

    # Session ID not in our records at all → unknown origin, reject
    if client_session_id not in previous_sessions:
        return False, "unknown_session"

    previous = previous_sessions[client_session_id]
    previous_version = previous.get("version", "")

    # Collaboration package version changed → reject
    if previous_version != current_version: # TODO check more versions
        return False, "version_mismatch"

    # Same directory + same version → safe to reconnect
    return True, ""
