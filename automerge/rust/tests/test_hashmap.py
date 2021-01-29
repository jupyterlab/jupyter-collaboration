from jupyter_rtc_automerge import hashmap as hm 

from unittest import TestCase


class TestHashMap(TestCase):


    def test_set_key(self):

        test_struct = {"key1": "value1", "key2": "value2"}
        new_value = "modified value 1"

        doc1 = hm.new_hashmap(test_struct)
        doc1 = hm.set(doc1, "key1", new_value)
        
        self.assertEqual(hm.get(doc1, "key1"), new_value, "changing the value for a key failed" )
        self.assertEqual(hm.get(doc1, "key2"), "value2", "changing the value for a key changed the value for the wrong key" )

    def test_repeat_set_key(self):

        test_struct = {"key0": "value0"}
        doc1 = hm.new_hashmap(test_struct)

        for i in range(1, 10):
            doc1 = hm.set(doc1, "key0", f"value{i}")
            self.assertEqual( len(hm.get_all_changes(doc1)), i+1 )
        

    def test_to_dict(self):
        # also test setting multiple keys in a row

        test_struct = {"key0": "value0", "key1": "value1", "key2": "value2"}
        doc1 = hm.new_hashmap(test_struct)

        doc1 = hm.set(doc1, "key0", "modified value 0")
        doc1 = hm.set(doc1, "key1", "modified value 1")
        doc1 = hm.set(doc1, "key2", "modified value 2")
        
        expected_result = {  "key0": "modified value 0",
                             "key1": "modified value 1",
                             "key2": "modified value 2" }

        self.assertEqual(hm.to_dict(doc1), expected_result, "Setting multiple keys and converting to python dict failed")



    def test_add_key(self):

        test_struct = {"key1": "value1"}
        
        doc1 = hm.new_hashmap(test_struct)
        doc1 = hm.set(doc1, "key2", "value2")
        
        self.assertEqual(hm.get(doc1, "key2"), "value2", "Setting the value for a new key failed" )
        self.assertEqual(hm.get(doc1, "key1"), "value1", "Setting the value for a new key changed the value for the wrong key" )
        


    def test_number_changes(self):

        test_struct = {"key0": "value0"}
        doc1 = hm.new_hashmap(test_struct)

        for i in range(1, 10):
            doc1 = hm.set(doc1, "key0", f"value{i}")
            self.assertEqual( len(hm.get_all_changes(doc1)), i+1 )
        
        # 10 changes : the creation with the initial value, and the for-loop
        self.assertEqual( len(hm.get_all_changes(doc1)), 10 )




    def test_apply_changes(self):

        test_struct = {"key0": "value0", "key1": "value1", "key2": "value2"}

        doc1 = hm.new_hashmap(test_struct)
        doc2 = doc1.copy()

        doc1 = hm.set(doc1, "key0", "modified value 0")
        doc1 = hm.set(doc1, "key1", "modified value 1")
        doc1 = hm.set(doc1, "key2", "modified value 2")
        
        changes = hm.get_all_changes(doc1)
        doc2 = hm.apply_changes(doc2, changes)

        expected_result = {  "key0": "modified value 0",
                             "key1": "modified value 1",
                             "key2": "modified value 2" }

        self.assertEqual(hm.to_dict(doc2), expected_result, "Applying changes from one doc to another failed")


