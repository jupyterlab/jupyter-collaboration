from jupyter_rtc_automerge import hashmap as hm 

from unittest import TestCase


class TestHashMap(TestCase):

    def test_item_assignment(self):

        test_struct = {"key1": "value1", "key2": "value2"}
        new_value = "modified value %s"

        doc = hm.HashmapDocument(test_struct)
        
        doc.set("key1", new_value%(1) )
        self.assertEqual(doc.get("key1"), new_value%(1), "changing the value for a key failed" )

        doc["key1"] = new_value%(2)
        self.assertEqual(doc["key1"], new_value%(2), "changing the value for a key failed" )

        doc.key1 = new_value%(3)
        self.assertEqual(doc.key1, new_value%(3), "changing the value for a key failed" )

    def test_set_key(self):

        test_struct = {"key1": "value1", "key2": "value2"}
        new_value = "modified value 1"

        doc = hm.HashmapDocument(test_struct)
        # doc.set("key1", new_value)
        doc["key1"] = new_value
        
        # self.assertEqual(doc.get("key1"), new_value, "changing the value for a key failed" )
        # self.assertEqual(doc.get("key2"), "value2", "changing the value for a key changed the value for the wrong key" )
        self.assertEqual(doc["key1"], new_value, "changing the value for a key failed" )
        self.assertEqual(doc["key2"], "value2", "changing the value for a key changed the value for the wrong key" )

    def test_repeat_set_key(self):

        test_struct = {"key0": "value0"}
        doc = hm.HashmapDocument(test_struct)

        for i in range(1, 10):
            doc["key0"] = f"value{i}"
            
        self.assertEqual( doc["key0"], f"value{i}")
        

    def test_to_dict(self):
        # also test setting multiple keys in a row

        test_struct = {"key0": "value0", "key1": "value1", "key2": "value2"}
        doc = hm.HashmapDocument(test_struct)

        doc["key0"] = "modified value 0"
        doc["key1"] = "modified value 1"
        doc["key2"] = "modified value 2"
        
        expected_result = {  "key0": "modified value 0",
                             "key1": "modified value 1",
                             "key2": "modified value 2" }

        self.assertEqual(doc.to_dict(), expected_result, "Setting multiple keys and converting to python dict failed")



    def test_add_key(self):

        test_struct = {"key1": "value1"}
        
        doc = hm.HashmapDocument(test_struct)
        doc["key2"] = "value2"
        
        self.assertEqual(doc["key2"], "value2", "Setting the value for a new key failed" )
        self.assertEqual(doc["key1"], "value1", "Setting the value for a new key changed the value for the wrong key" )
        


    def test_number_changes(self):

        test_struct = {"key0": "value0"}
        doc = hm.HashmapDocument(test_struct)

        for i in range(1, 10):
            doc["key0"] = f"value{i}"
            self.assertEqual( len(doc.get_all_changes()), i+1 )
        
        # 10 changes : the creation with the initial value, and the for-loop
        self.assertEqual( len(doc.get_all_changes()), 10 )




    def test_apply_changes(self):

        test_struct = {"key0": "value0", "key1": "value1", "key2": "value2"}

        expected_result = {  "key0": "modified value 0",
                             "key1": "modified value 1",
                             "key2": "modified value 2" }

        doc1 = hm.HashmapDocument(test_struct)
        doc2 = doc1.copy()

        doc1["key0"] = expected_result["key0"] 
        doc1["key1"] = expected_result["key1"] 
        doc1["key2"] = expected_result["key2"] 
        
        self.assertNotEqual(doc2.to_dict(), expected_result, "Modifications on document 1 are reflected on document 2 : problem with copy")

        changes = doc1.get_all_changes()
        doc2.apply_changes(changes)


        self.assertEqual(doc2.to_dict(), expected_result, "Applying changes from one doc to another failed")


