import pytest
import jupyter_rtc_automerge

def test_str_str_dict():
    a = {'hello': 'sally'}
    jupyter_rtc_automerge.load.str_str_dict(a)
    return

def test_str_int_dict():
    a = {"hello": 1, "sally": 2}
    jupyter_rtc_automerge.load.str_int_dict(a)
    return

def test_str_list_dict():
    return

