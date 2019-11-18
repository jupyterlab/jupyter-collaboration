"""
Describe API in fast API then translate to openapi b/c writing python
is nicer than writing YAML!
"""

from fastapi import FastAPI
from typing import *
from dataclasses import dataclass

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


@app.post("/kernels/restart")
def restart_kernel(id: str) -> None:
    """
    Restarts a kernel
    """
    ...


print(app.openapi())
