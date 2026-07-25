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


def lineage_fingerprint(content: Any, procedure: str) -> str:
    """Fingerprint of a deterministic rebuild of a document.

        Parameters:
            content (Any): The document content model.
            procedure (str): An opaque description of *how* the content is
                turned into Yjs items (see
                ``DocumentRoom._rebuild_procedure``).

        Returns:
            digest (str): The hexadecimal SHA-256 digest identifying the
                rebuild.

    ### Note:
        Two rebuilds sharing a fingerprint must produce byte-identical Yjs
        items, because the fingerprint decides both whether a room keeps
        its document session and which client id the rebuild uses. Anything
        the resulting items depend on must therefore be part of it:

        - the content *including the order of its keys*: ``jupyter_ydoc``
          inserts map entries in iteration order, and Yjs items record that
          order, so a re-serialized file with reordered keys rebuilds to
          different items (this is why the JSON is **not** sorted here);
        - the procedure, which covers the loading mode and the version of
          the library performing the load.
    """
    serialized = json.dumps(content, sort_keys=False, default=str, ensure_ascii=False)
    digest = hashlib.sha256()
    digest.update(procedure.encode("utf-8"))
    digest.update(b"\0")
    digest.update(serialized.encode("utf-8"))
    return digest.hexdigest()


@dataclass
class DocumentSession:
    """A record describing the current session of a document room.

    The ``origin`` records how the session came to be:

    - ``"rest"``: minted by the session REST handler before any websocket
      connection; no Yjs history exists under this session yet, so the first
      room initialization may adopt it regardless of how it loads content.
    - ``"store"``: the session covers a history lineage restored from a YStore.
    - ``"rebuild"``: the session started from a deterministic rebuild of the
      on-disk content whose fingerprint is ``rebuild_hash``.

    ``rebuild_hash`` is cleared as soon as the lineage advances past that
    founding rebuild (see ``DocumentSessionStore.invalidate_rebuild``), so a
    later rebuild can only be recognized as replaying the lineage while the
    lineage still *is* its founding rebuild.
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

    def invalidate_rebuild(self, room_id: str) -> None:
        """Record that the lineage advanced past its founding rebuild.

        Parameters:
            room_id (str): Room ID.

        ### Note:
            Keeping a session across a rebuild is only sound while the
            lineage still holds exactly the content that founded it: the
            rebuild then replays the very items the clients already have.
            Once the room has written different content to disk (a save, or
            adopting an out-of-band change), a future rebuild of the
            *founding* content - e.g. the file being reverted by a version
            control checkout - is a different lineage, and clients holding
            the advanced one must not silently resynchronize onto it (they
            would push the content the file was reverted away from back).
        """
        session = self._sessions.get(room_id)
        if session is None or session.rebuild_hash is None:
            return
        session.rebuild_hash = None
        self._persist()

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
