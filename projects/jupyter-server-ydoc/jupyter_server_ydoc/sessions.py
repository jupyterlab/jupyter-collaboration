# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import json
import os
import uuid
from dataclasses import asdict, dataclass
from logging import Logger, getLogger
from pathlib import Path
from typing import Literal

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


@dataclass
class DocumentSession:
    """A record describing the current session of a document room.

    The ``origin`` records how the session came to be:

    - ``"rest"``: minted by the session REST handler before any websocket
      connection; no Yjs history exists under this session yet, so the first
      room initialization may adopt it regardless of how it loads content.
    - ``"store"``: the session covers a history lineage restored from a YStore.
    - ``"rebuild"``: the session covers a lineage built from the on-disk
      content, which is new every time a room is rebuilt.
    """

    session_id: str
    origin: SessionOrigin


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
            self._sessions[str(room_id)] = DocumentSession(
                session_id=session_id,
                origin=origin,
            )

    def _persist(self) -> None:
        if self._path is None:
            return
        serialized = json.dumps(
            {room_id: asdict(session) for room_id, session in self._sessions.items()},
            indent=2,
        )
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            # Write through a temporary file in the same directory and rename
            # it over the store: a crash (or a second server writing
            # concurrently) then leaves the previous complete file in place
            # rather than a truncated one, which would drop every session and
            # make all connected clients re-validate their content.
            tmp = self._path.with_name(f"{self._path.name}.{os.getpid()}.tmp")
            try:
                tmp.write_text(serialized)
                os.replace(tmp, self._path)
            finally:
                tmp.unlink(missing_ok=True)
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

    def update(self, room_id: str, origin: SessionOrigin) -> str:
        """Keep the current session ID but record a new origin for it.

        Parameters:
            room_id (str): Room ID.
            origin (SessionOrigin): The new session origin.

        Returns:
            session_id (str): The (unchanged) session ID.
        """
        session = self._sessions.get(room_id)
        if session is None:
            return self.roll(room_id, origin)
        session.origin = origin
        self._persist()
        return session.session_id

    def adopt(self, room_id: str, session_id: str, origin: SessionOrigin) -> str:
        """Record a session ID recovered from outside the store.

        Parameters:
            room_id (str): Room ID.
            session_id (str): The session ID to record.
            origin (SessionOrigin): The origin of the session.

        Returns:
            session_id (str): The adopted session ID.

        ### Note:
            Used when a room recovers the session its restored history
            belongs to, after this store lost its record of it.
        """
        self._sessions[room_id] = DocumentSession(session_id=session_id, origin=origin)
        self._persist()
        return session_id

    def roll(self, room_id: str, origin: SessionOrigin) -> str:
        """Mint a new session ID for a room, marking the previous lineage dead.

        Parameters:
            room_id (str): Room ID.
            origin (SessionOrigin): The origin of the new session.

        Returns:
            session_id (str): The newly minted session ID.
        """
        session = DocumentSession(session_id=str(uuid.uuid4()), origin=origin)
        self._sessions[room_id] = session
        self._persist()
        return session.session_id
