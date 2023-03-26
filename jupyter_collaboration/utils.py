from typing import Tuple


def decode_file_path(path: str) -> Tuple[str, str, str]:
    format, file_type, file_id = path.split(":", 2)
    return (format, file_type, file_id)


def encode_file_path(format: str, file_type: str, file_id: str) -> str:
    return f"{format}:{file_type}:{file_id}"
