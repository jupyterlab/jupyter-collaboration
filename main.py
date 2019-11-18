"""
Describe API in fast API then translate to openapi b/c writing python
is nicer than writing YAML!
"""

from fastapi import FastAPI
from typing import *

app = FastAPI()


@app.post("/refresh_kernelspecs")
def refresh_kernelspecs() -> None:
    """
    Update the kernelspecs table.
    """
    ...

@app.post("/refresh_status")
def refresh_status() -> None:
    """
    Update the status table.
    """
    ...


@app.post("/terminals")
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