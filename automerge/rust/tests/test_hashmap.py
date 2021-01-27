from jupyter_rtc_automerge import hashmap as hm 


test_struct = {"key1": "value1", "key2": "value2"}


doc1 = hm.new_hashmap(test_struct)
print(f"doc1 :  {doc1}")

doc2 = hm.new_hashmap(test_struct)
print(f"doc2 : {doc2}")


changes = hm.get_all_changes(doc1)
print(f"Changes count doc1: {len(changes)}")
print(f"Changes doc1: {changes}")


#hm_am_doc["key1"] = "modified value 1"
# or :
doc1 = hm.set(doc1, "key1", "modified value 1")
changes = hm.get_all_changes(doc1)
print(f"Changes count doc1: {len(changes)}")
print(f"Changes doc1: {changes}")

for change in changes:
    doc2_test = hm.apply_changes(doc2, change)

print("doc1 : ", doc1)
# print("doc2 : ", doc2)
print("doc test : ", doc2_test)


# hm.set(hm_am_doc, "key2", "modified value 2")
# changes = hm.get_all_changes(hm_am_doc)
# print(f"Changes : {len(changes)}")
