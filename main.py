"""
Describe API in fast API then translate to openapi b/c writing python
is nicer than writing YAML!
"""

from fastapi import FastAPI
from typing import *

app = FastAPI()


# @app.post("/refresh_kernelspecs")
# def refresh_kernelspecs(kernel_id: Optional[str] = None):
#     """
#     Update the kernelspecs table.
#     """
#     ...
