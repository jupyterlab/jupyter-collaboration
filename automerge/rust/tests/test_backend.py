import pytest
import jupyter_rtc_automerge

def test_notebook_model():
    jupyter_rtc_automerge.automerge.new_backend(jupyter_rtc_automerge.serialize_to_bytes(jupyter_rtc_automerge.init_notebook()))
    return

