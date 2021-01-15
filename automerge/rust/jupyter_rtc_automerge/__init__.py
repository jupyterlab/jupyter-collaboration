from .jupyter_rtc_automerge import *
from .nbmodel import *

nbState = {}

def init_nb():
    notebookState.update(
        {'nb': init_notebook(), 'shared': automerge.new_backend()})
    return


def get_state():
    print(notebookState)
