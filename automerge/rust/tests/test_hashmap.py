from jupyter_rtc_automerge import hashmap as hm 


test_struct = {"key1": "value1", "key2": "value2"}


doc1 = hm.new_hashmap(test_struct)
print(f"doc1 :  {doc1}")

doc2 = hm.new_hashmap(test_struct)
print(f"doc2 : {doc2}")


changes = hm.get_all_changes(doc1)
print(f"Changes count doc1: {len(changes)}")
print(f"Changes doc1: {changes}")


#doc1["key1"] = "modified value 1"
# or :
doc1 = hm.set(doc1, "key1", "modified value 1")
changes = hm.get_all_changes(doc1)
print(f"Changes count doc1: {len(changes)}")
print(f"Changes doc1: {changes}")


doc2 = hm.apply_changes(doc2, changes)
    

print("should be equal to 'modified value 1' : ",  hm.get(doc2, "key1")) 
# it's not the case so far - it's still WIP.


print("\n"*3)
print( hm.to_dict(doc1) ) )
print("\n"*3)
print( hm.to_dict(doc2) ) )
