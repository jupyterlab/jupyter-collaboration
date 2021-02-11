import logging
from hypothesis import given, strategies as st 
from jupyter_rtc_automerge import automerge_map as am

logger = logging.getLogger(__name__)

def test_hardcoded_struct():
    test_struct = { "key_string":"string value", 
                    "key_int":99,
                    "key_list_int":[1,2,3],
                    "key_list_str":["a","bc","def", "GHIJ", "🌍🌎🌏"],
                    "key_list_int_str":[1, "abcdefgh", 2, "ijklmnop", 3, "qrstuvwx"],
                    "key_dict_str_str":{"subkey1":"val1", 
                                    "subkey2":"val2"}
            }

    doc = am.AutomergeMap(test_struct)

@given(st.integers() | st.floats() )
def test_document_numerics(object):
    doc = am.AutomergeMap({ 'numeric_python_value' : object })

@given(st.characters() | st.text())
def test_document_stringlike(object):
    doc = am.AutomergeMap({ 'stringlike_python_value' : object })

@given(st.lists(st.integers())  )
def test_document_listNumeric_ints(object):
    doc = am.AutomergeMap({ 'list_numeric_unival_python_value' : object })

@given(st.lists(st.floats()) )
def test_document_listNumeric_floats(object):
    doc = am.AutomergeMap({ 'list_numeric_unival_python_value' : object })


@given(st.dictionaries(st.text(), st.integers() | st.floats()))
def test_document_dictNumerics(object):
    doc = am.AutomergeMap({ 'dict_numeric_test' : object })

@given(st.dictionaries(st.text(), st.text() | st.characters()))
def test_document_dictStringlike(object):
    doc = am.AutomergeMap({ 'dict_stringlike_test' : object })

@given(st.dictionaries(st.text(), st.lists(st.integers() | st.text())))
def test_document_dictlist(object):
    doc = am.AutomergeMap({ 'dict_with_list_test' : object })

#print(dir(doc))
#print("\n")
#print(doc.get("key_int"))
