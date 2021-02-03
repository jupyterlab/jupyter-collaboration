
from jupyter_rtc_automerge import hashmap as hm # hashmap<str:str>

from jupyter_rtc_automerge import hashmap2 as hm2 # hashmap<str:*>   with * = Lst, int, str, hashmap<str:*>


doc = hm.HashmapDocument({"key_string":"string value", "test":"value test"})

print(doc.get("key_string"))
print(doc.get("test"))
print("__________")


test_struct = { "key_string":"string value", 
                "key_int":99,
                "key_list_int":[1,2,3],
                "key_list_str":["a","bc","def", "GHIJ", "🌍🌎🌏"],
                "key_list_int_str":[1, "abcdefgh", 2, "ijklmnop", 3, "qrstuvwx"],
                "key_dict_str_str":{"subkey1":"val1", 
                                "subkey2":"val2"}
        }

print(test_struct)

doc = hm2.HashmapDocument(test_struct)


print(dir(doc))
print("\n")
print(doc.get("key_int"))
# print(doc.get("key_string"))