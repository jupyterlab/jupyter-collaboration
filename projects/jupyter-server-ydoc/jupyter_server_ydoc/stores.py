# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from pycrdt.store import SQLiteYStore as _SQLiteYStore
from pycrdt.store import TempFileYStore as _TempFileYStore
from traitlets import Int, Unicode
from traitlets.config import LoggingConfigurable
import importlib
from typing import Callable


class TempFileYStore(_TempFileYStore):
    prefix_dir = "jupyter_ystore_"


class SQLiteYStoreMetaclass(type(LoggingConfigurable), type(_SQLiteYStore)):  # type: ignore
    pass


def import_from_dotted_path(dotted_path: str) -> Callable:
    """Import a function from a dotted import path.

    Args:
        dotted_path: String like 'module.submodule.function_name'

    Returns:
        The imported function

    Raises:
        ImportError: If the module or function cannot be imported
        AttributeError: If the function doesn't exist in the module
    """
    if not dotted_path:
        return None

    try:
        module_path, function_name = dotted_path.rsplit(".", 1)
        module = importlib.import_module(module_path)
        return getattr(module, function_name)
    except (ValueError, ImportError, AttributeError) as e:
        raise ImportError(f"Could not import '{dotted_path}': {e}")


class SQLiteYStore(LoggingConfigurable, _SQLiteYStore, metaclass=SQLiteYStoreMetaclass):
    db_path = Unicode(
        ".jupyter_ystore.db",
        config=True,
        help="""The path to the YStore database. Defaults to '.jupyter_ystore.db' in the current
        directory.""",
    )

    document_ttl = Int(
        None,
        allow_none=True,
        config=True,
        help="""The document time-to-live in seconds. Defaults to None (document history is never
        cleared).""",
    )

    compress_function = Unicode(
        "",
        config=True,
        help="""Dotted import path to compression function. The function should accept bytes
        and return compressed bytes. Defaults to None (no compression).""",
    )

    decompress_function = Unicode(
        "",
        config=True,
        help="""Dotted import path to decompression function. The function should accept
        compressed bytes and return decompressed bytes. Defaults to None (no decompression).""",
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._setup_compression()

    def _setup_compression(self):
        """Set up compression callbacks if both compress and decompress paths are provided."""
        if not self.compress_function or not self.decompress_function:
            # If either is empty, don't set up compression
            if self.compress_function or self.decompress_function:
                self.log.warning(
                    "Both compress_function and decompress_function must be specified "
                    "to enable compression. Currently only one is set."
                )
            return

        try:
            # Import the compression functions
            compress_func = import_from_dotted_path(self.compress_function)
            decompress_func = import_from_dotted_path(self.decompress_function)

            # Validate that they are callable
            if not callable(compress_func) or not callable(decompress_func):
                raise TypeError("Both compression functions must be callable")

            # Register the compression callbacks
            self.register_compression_callbacks(compress_func, decompress_func)
            self.log.info(
                f"Registered compression callbacks: {self.compress_function} / {self.decompress_function}"
            )
        except ImportError as e:
            self.log.error(f"Failed to import compression functions: {e}")
        except TypeError as e:
            self.log.error(f"Invalid compression functions: {e}")
        except Exception as e:
            self.log.error(f"Unexpected error setting up compression: {e}")
