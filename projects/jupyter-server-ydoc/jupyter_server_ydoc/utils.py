# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from enum import Enum, IntEnum
from pathlib import Path
from typing import Tuple

EVENTS_FOLDER_PATH = Path(__file__).parent / "events"
JUPYTER_COLLABORATION_EVENTS_URI = "https://schema.jupyter.org/jupyter_collaboration/session/v1"
EVENTS_SCHEMA_PATH = EVENTS_FOLDER_PATH / "session.yaml"
JUPYTER_COLLABORATION_AWARENESS_EVENTS_URI = (
    "https://schema.jupyter.org/jupyter_collaboration/awareness/v1"
)
AWARENESS_EVENTS_SCHEMA_PATH = EVENTS_FOLDER_PATH / "awareness.yaml"


class MessageType(IntEnum):
    SYNC = 0
    AWARENESS = 1
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
