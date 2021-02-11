from jupyter_rtc_automerge import hashmap as hm 

from unittest import TestCase


class TestHashMap(TestCase):

    def test_accessors(self):

        test_struct = {"key1": "value1", "key2": "value2"}
        new_value = "modified value %s"

        doc = hm.HashmapDocument(test_struct)

        # validates accessors
        doc.set("key1", new_value%(1) )
        self.assertEqual(doc.get("key1"), new_value%(1), "changing the value for a key failed" )

        doc["key1"] = new_value%(2)
        self.assertEqual(doc["key1"], new_value%(2), "changing the value for a key failed" )

        doc.key1 = new_value%(3)
        self.assertEqual(doc.key1, new_value%(3), "changing the value for a key failed" )


    def test_init_basic_types(self):

        test_set = [    { "key_none":None},
                        { "key_bool":True},
                        { "key_int":99},
                        { "key_float":0.123},
                        { "key_str":"string value"},
                        
                        # the following requires a fix in Automerge-rs : https://github.com/automerge/automerge-rs/issues/44
                        # { "key_utf8":"🌍🌎🌏"}, 
                        # { "key_list_utf8" : [ "السلام عليكم", "Dobrý den", "שָׁלוֹם", "नमस्ते", "こんにちは", "안녕하세요", "你好", "Olá", "Здравствуйте" ]}
                        
                        { "key_list_bools":[False, True] },
                        { "key_list_int":[1,2,3] },
                        { "key_list_str":["a","bc","def", "GHIJ"] },
                        { "key_list_int_str":[1, "abcdefgh", 2, "ijklmnop", 3, "qrstuvwx"] },
                        { "key_dict_str_str":{"subkey1":"val1","subkey2":"val2"}  }   ,
                        { "key_mixed": [ {"k1":"v1", "k2":2, "k3":[True, None, False, {"k31":"v31"}]}   ]}

        ]


        for test_struct in test_set :

            try:
                doc = hm.HashmapDocument(test_struct)
                self.assertEqual(doc.to_dict(), test_struct, "Building a backend and retrieving its data failed with init dict %s"%(test_struct) )
            except Exception as e:
                self.fail("Exception raised with test struct : %s"%(test_struct))


    def test_set_basic_types(self):

        doc = hm.HashmapDocument({})

        test_set = {     "key_none": None, 
                         "key_bool": True, 
                         "key_int": 99,
                         "key_float": 0.123,
                         "key_list_bools":[False, True],
                         "key_list_int": [1,2,3],
                         "key_list_str": ["a","bc","def", "GHIJ"],
                         "key_list_int_str": [1, "abcdefgh", 2, "ijklmnop", 3, "qrstuvwx"],
                         "key_dict_str_str": {"subkey1":"val1","subkey2":"val2"},
                         "key_mixed": [ {"k1":"v1", "k2":2, "k3":[True, None, False, {"k31":"v31"}]}   ]
        }

        for k in test_set:
            try:
                doc[k] = test_set[k]
                self.assertEqual(doc[k], test_set[k], "setting value %s and retrieving it failed"%(test_set[k]) )
            except Exception as e:
                self.fail("Exception raised setting value : %s"%(test_set[k]))

    

        


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


