import logging
from hypothesis import given, strategies 
from jupyter_rtc_automerge import hashmap2 as hm # hashmap<str:*>   with * = Lst, int, str, hashmap<str:*>

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

    doc = hm.HashmapDocument(test_struct)

@given(strategies.integers() | strategies.floats() | strategies.complex_numbers())
def test_document_numerics(object):
    doc = hm.HashmapDocument({ 'numeric_python_value' : object })

@given(strategies.characters() | strategies.text())
def test_document_stringlike(object):
    doc = hm.HashmapDocument({ 'stringlike_python_value' : object })

@given(strategies.lists(strategies.integers()) | strategies.lists(strategies.floats) | strategies.lists(strategies.complex_numbers()))
def test_document_listNumeric(object):
    doc = hm.HashmapDocument({ 'list_numeric_unival_python_value' : object })

@given(strategies.dictionaries(strategies.text(), strategies.integers() | strategies.floats()))
def test_document_dictNumerics(object):
    doc = hm.HashmapDocument({ 'dict_numeric_test' : object })

@given(strategies.dictionaries(strategies.text(), strategies.text() | strategies.characters()))
def test_document_dictStringlike(object):
    doc = hm.HashmapDocument({ 'dict_stringlike_test' : object })

@given(strategies.dictionaries(strategies.text(), strategies.lists(strategies.integers() | strategies.text())))
def test_document_dictlist(object):
    doc = hm.HashmapDocument({ 'dict_with_list_test' : object })

#print(dir(doc))
#print("\n")
#print(doc.get("key_int"))
