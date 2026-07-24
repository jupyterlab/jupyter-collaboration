# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import asdict, dataclass
from logging import Logger, getLogger
from pathlib import Path
from typing import Any, Literal

SessionOrigin = Literal["rest", "store", "rebuild"]


def document_session_store_path(
    root_dir: str, session_store_path: str | None = None
) -> Path | None:
    """Path of the document session store file.

        Parameters:
            root_dir (str): The server root directory.
            session_store_path (str | None): The configured session store
                path, if any.

        Returns:
            path (Path | None): The document session store file path, or
                ``None`` when no writable location is available (document
                sessions are then only kept in memory, and roll on server
                restart, which is safe, just more eager).

    ### Note:
        The path is derived from the (server) session store location so
        that both files live side by side.
    """
    from .utils import _get_jupyter_session_store

    base = _get_jupyter_session_store(root_dir, session_store_path)
    if str(base) == os.devnull:
        return None
    return base.with_name(base.stem + "_documents.json")


def content_hash(content: Any) -> str:
    """Canonical hash of a document content model.

        Parameters:
            content (Any): The document content model.

        Returns:
            digest (str): The hexadecimal SHA-256 digest of the canonical
                JSON serialization of the content.

    ### Note:
        Used both to decide whether a room rebuilt from disk replays the
        same deterministic history as a previous rebuild, and to derive the
        rebuild client id (see ``DocumentRoom._content_client_id``); the two
        must stay in lockstep so a kept session always implies identical
        Yjs coordinates.
    """
    serialized = json.dumps(content, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


@dataclass
class DocumentSession:
    """A record describing the current session of a document room.

    The ``origin`` records how the session came to be:

    - ``"rest"``: minted by the session REST handler before any websocket
      connection; no Yjs history exists under this session yet, so the first
      room initialization may adopt it regardless of how it loads content.
    - ``"store"``: the session covers a history lineage restored from a YStore.
    - ``"rebuild"``: the session started from a deterministic rebuild of the
      on-disk content whose canonical hash is ``rebuild_hash``.
    """

    session_id: str
    origin: SessionOrigin
    rebuild_hash: str | None = None


class DocumentSessionStore:
    """Tracks per-room document session IDs.

    A document session identifies one continuous Yjs history lineage of a
    document room. The session is preserved for as long as the history is
    carried forward (the room stays in memory, is restored from the YStore,
    or is deterministically rebuilt from byte-identical content) and rolled
    whenever the history is rebuilt from the source file with different
    content, so clients can detect that their local document belongs to a
    diverged lineage before any Yjs synchronization happens.

    The sessions are kept in memory (canonical within a server process) and
    written through to a JSON file so they survive server restarts alongside
    the YStore. Losing the file is safe: sessions roll more eagerly, which
    only makes clients re-validate their content.
    """

    def __init__(self, path: Path | None = None, log: Logger | None = None) -> None:
        self._path = path
        self._log = log or getLogger(__name__)
        self._sessions: dict[str, DocumentSession] = {}
        self._load()

    def _load(self) -> None:
        if self._path is None or not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            self._log.warning("Could not read document session store %s: %s", self._path, e)
            return
        if not isinstance(raw, dict):
            return
        for room_id, record in raw.items():
            if not isinstance(record, dict):
                continue
            session_id = record.get("session_id")
            origin = record.get("origin")
            if not isinstance(session_id, str) or origin not in ("rest", "store", "rebuild"):
                continue
            rebuild_hash = record.get("rebuild_hash")
            if rebuild_hash is not None and not isinstance(rebuild_hash, str):
                rebuild_hash = None
            self._sessions[str(room_id)] = DocumentSession(
                session_id=session_id,
                origin=origin,
                rebuild_hash=rebuild_hash,
            )

    def _persist(self) -> None:
        if self._path is None:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(
                json.dumps(
                    {room_id: asdict(session) for room_id, session in self._sessions.items()},
                    indent=2,
                )
            )
        except OSError as e:
            self._log.warning("Could not write document session store %s: %s", self._path, e)

    def get(self, room_id: str) -> DocumentSession | None:
        """The current session record for a room, if any.

        Parameters:
            room_id (str): Room ID.

        Returns:
            session (DocumentSession | None): The session record, or
                ``None`` when the room has no recorded session.
        """
        return self._sessions.get(room_id)

    def get_or_create(self, room_id: str, origin: SessionOrigin) -> str:
        """Return the current session ID for a room, minting one if needed.

        Parameters:
            room_id (str): Room ID.
            origin (SessionOrigin): The origin recorded when a new
                session needs to be minted.

        Returns:
            session_id (str): The current session ID.
        """
        session = self._sessions.get(room_id)
        if session is None:
            session = DocumentSession(session_id=str(uuid.uuid4()), origin=origin)
            self._sessions[room_id] = session
            self._persist()
        return session.session_id

    def update(self, room_id: str, origin: SessionOrigin, rebuild_hash: str | None = None) -> str:
        """Keep the current session ID but update its lineage metadata.

        Parameters:
            room_id (str): Room ID.
            origin (SessionOrigin): The new session origin.
            rebuild_hash (str | None): The content hash of the rebuild
                founding the lineage, if any.

        Returns:
            session_id (str): The (unchanged) session ID.
        """
        session = self._sessions.get(room_id)
        if session is None:
            return self.roll(room_id, origin, rebuild_hash)
        session.origin = origin
        session.rebuild_hash = rebuild_hash
        self._persist()
        return session.session_id

    def roll(self, room_id: str, origin: SessionOrigin, rebuild_hash: str | None = None) -> str:
        """Mint a new session ID for a room, marking the previous lineage dead.

        Parameters:
            room_id (str): Room ID.
            origin (SessionOrigin): The origin of the new session.
            rebuild_hash (str | None): The content hash of the rebuild
                founding the new lineage, if any.

        Returns:
            session_id (str): The newly minted session ID.
        """
        session = DocumentSession(
            session_id=str(uuid.uuid4()), origin=origin, rebuild_hash=rebuild_hash
        )
        self._sessions[room_id] = session
        self._persist()
        return session.session_id
