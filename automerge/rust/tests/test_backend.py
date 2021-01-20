import pytest
import jupyter_rtc_automerge

def test_notebook_model():
    jupyter_rtc_automerge.automerge.consume_notebook(jupyter_rtc_automerge.init_notebook())
    return

