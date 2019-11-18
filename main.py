"""
Describe API in fast API then translate to openapi b/c writing python
is nicer than writing YAML!
"""

from fastapi import FastAPI
from typing import *
from dataclasses import dataclass
import json

app = FastAPI()


@app.post("/kernelspecs/refresh")
def refresh_kernelspecs() -> None:
    """
    Update the kernelspecs table.
    """
    ...


@app.post("/status/refresh")
def refresh_status() -> None:
    """
    Update the status table.
    """
    ...


@app.post("/terminals", response_model=str)
def create_terminal() -> str:
    """
    Creates a new terminal and returns the name.
    """
    ...


@app.delete("/terminals")
def delete_terminal(name: str) -> None:
    """
    Deletes a terminal.
    """
    ...


@app.post("/kernels/refresh")
def refresh_kernels() -> None:
    """
    Update the kernels table.
    """
    ...


@app.post("/kernels", response_model=str)
def create_kernel(name: str) -> str:
    """
    Creates a new kernel and returns the ID
    """
    ...


@app.delete("/kernels")
def delete_kernel(id: str) -> None:
    """
    Kills a kernel
    """
    ...


@app.post("/kernels/interrupt")
def interrupt_kernel(id: str) -> None:
    """
    Interrupts a kernel
    """
    ...


@app.post("/sessions/refresh")
def refresh_sessions() -> None:
    """
    Refresh sessions.
    """
    ...


@app.delete("/sessions")
def delete_sessions(id: str) -> None:
    """
    Deletes a session.
    """
    ...


@app.post("/sessions", response_model=str)
def create_session(
    path: str,
    type: str,
    name: Optional[str] = None,
    kernel_name: Optional[str] = None,
    kernel_id: Optional[str] = None,
) -> str:
    """
    Creates a new session or returns existing one if path exists
    """
    ...


@app.patch("/sessions")
def update_session(
    id: str,
    path: Optional[str] = None,
    name: Optional[str] = None,
    type: Optional[str] = None,
    kernel_name: Optional[str] = None,
    kernel_id: Optional[str] = None,
) -> None:
    """
    Updates an existing session.
    """
    ...

print(json.dumps(app.openapi()))
