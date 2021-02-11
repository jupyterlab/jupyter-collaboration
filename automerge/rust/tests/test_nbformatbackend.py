import pytest
import jupyter_rtc_automerge 
import nbformat

def test_backend():
    test_nb = nbformat.v4.new_notebook()
    f = jupyter_rtc_automerge.nb.serialize_notebook(test_nb)
    return
