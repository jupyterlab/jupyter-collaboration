from .jupyter_rtc_automerge import *
from .nbmodel import *

notebookState = {}


def init_nb():
    notebookState.update(
        {'nb': init_notebook(), 'shared': automerge.new_document()})
    return


def get_state():
    print(notebookState)
