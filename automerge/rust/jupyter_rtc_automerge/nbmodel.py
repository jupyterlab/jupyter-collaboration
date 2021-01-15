import nbformat
import uuid

def init_notebook():
    nb = nbformat.v4.new_notebook()
    return nb

def read_notebook_fp(path):
    nb = nbformat.read(fp, nbformat.NO_CONVERT)
    return nb

def read_notebook_dict(nbdict):
    nb = nbformat.from_dict(nbdict)
    nbformat.validate(nb)
    return nb
        
def get_cell_dict(nb):
    cells = nb[cells]
    return cells

def init_cell():
    nb = nbformat.v4.new_code_cell()
    cells = [nb]
    return cells


