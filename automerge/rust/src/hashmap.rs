use automerge_backend;
use automerge_frontend;
use automerge_protocol;

use std::println;

use pyo3::class::{PyMappingProtocol, PyObjectProtocol};
use pyo3::exceptions::*;
use pyo3::ffi;
use pyo3::prelude::*;
use pyo3::type_object::PyTypeObject;
use pyo3::types::{
    PyAny, PyByteArray, PyBytes, PyDict, PyFloat, PyInt, PyList, PyLong, PyString, PyUnicode,
};
use std::collections::HashMap;
use std::os::raw::c_long;

#[pyclass]
struct HashmapDocument {
    serialized_backend: std::vec::Vec<u8>,
}

#[pymethods]
impl HashmapDocument {
    #[new]
    fn new(py_struct: &PyDict) -> Self {
        //  Convert from a PyDict to a Hashmap<Str : automerge_frontend::Value>
        let hashmap_struct: std::result::Result<HashMap<String, &PyAny>, PyErr> = py_struct
            .extract()
            .and_then(|hashmap_struct| Ok(hashmap_struct));

        let backend = base_document(hashmap_struct.unwrap());

        let serialized_backend = backend.save().and_then(|data| Ok(data)).unwrap();

        HashmapDocument { serialized_backend }
    }

    fn dump_backend(&self) {
        println!("DUMP BACKEND : \n {:?}", self.serialized_backend);
    }

    fn copy(&self) -> PyResult<Self> {
        let backend = automerge_backend::Backend::load(self.serialized_backend.clone())
            .and_then(|back| Ok(back))
            .unwrap();

        let serialized_backend = backend.save().and_then(|data| Ok(data)).unwrap();
        Ok(HashmapDocument { serialized_backend })
    }

    // WARNING : this function is named "apply_changes", plural, on purpose.
    // It takes a  Vector of changes (each change being a Vector of u8)
    fn apply_changes(&mut self, raw_changes: std::vec::Vec<std::vec::Vec<u8>>) -> PyResult<()> {
        let mut backend = automerge_backend::Backend::load(self.serialized_backend.clone())
            .and_then(|back| Ok(back))
            .unwrap();

        let mut changes: std::vec::Vec<automerge_backend::Change> = std::vec::Vec::new();
        for raw_c in raw_changes.iter() {
            let change = automerge_backend::Change::from_bytes(raw_c.to_vec())
                .and_then(|c| Ok(c))
                .unwrap();

            changes.push(change)
        }

        backend
            .apply_changes(changes)
            .and_then(|patch| Ok(patch))
            .unwrap();

        self.serialized_backend = backend.save().and_then(|data| Ok(data)).unwrap();
        Ok(())
    }

    fn get_all_changes(&self) -> PyResult<(std::vec::Vec<std::vec::Vec<u8>>)> {
        let backend = automerge_backend::Backend::load(self.serialized_backend.clone())
            .and_then(|back| Ok(back))
            .unwrap();
        let changes = backend.get_changes(&[]);
        let mut bytes: std::vec::Vec<std::vec::Vec<u8>> = std::vec::Vec::new();
        for c in changes.iter() {
            bytes.push(c.bytes.clone());
        }
        Ok(bytes)
    }
    fn get<'p>(&self, py: Python<'p>, key: String) -> PyResult<&'p PyAny> {
        // According to Alex Good from the Automerge Team, to get a value from an automerge_backend::backend object :
        // > Right, so what you'll need to do is
        // >  instantiate an automerge_backend::Backend (as you're doing),
        // >  then get the patch from that using automerge_backend::Backed::get_patch,
        // >  then apply that patch to a fresh instance of a frontend using automerge_frontend::Frontend::apply_patch.
        // > At this point you have a frontend with the converged value in it,
        // > you can retrieve that using automerge_frontend::Frontend::state() which returns an automerge_frontend::Value.
        // Alex also added, in order to retrieve the data in json :
        // > automerge_frontend::Value implementes serde::Deserialize, so you can turn it into a JSON string with serde_json::to_string
        // > Alternatively you could write a function to turn it into a python value directly as it's a reasonably simple enum
        // > But I would start with the JSON string

        let mut frontend = automerge_frontend::Frontend::new();
        let backend = automerge_backend::Backend::load(self.serialized_backend.clone())
            .and_then(|back| Ok(back))
            .unwrap();

        frontend.apply_patch(backend.get_patch().unwrap());

        let root_path = automerge_frontend::Path::root().key(key);
        let value: automerge_frontend::Value = frontend.get_value(&root_path).unwrap();

        Ok(automerge_to_py_val(py, &value))
    }

    fn set<'p>(&mut self, py: Python<'p>, key: String, value: &'p PyAny) -> PyResult<()> {
        println!("DUMP set value {:?} {:?}", key, value);
        let mut backend = automerge_backend::Backend::load(self.serialized_backend.clone())
            .and_then(|back| Ok(back))
            .unwrap();
        let mut frontend = automerge_frontend::Frontend::new();
        frontend.apply_patch(backend.get_patch().unwrap());
        // println!("RUST set {:?}->{:?}", key, value);
        // Create a "change" action, that sets the value for the given key
        let change = automerge_frontend::LocalChange::set(
            automerge_frontend::Path::root().key(key),
            py_to_automerge_val(value),
        );
        // Apply this change
        let change_request = frontend
            .change::<_, automerge_frontend::InvalidChangeRequest>(Some("set".into()), |frontend| {
                frontend.add_change(change)?;
                Ok(())
            })
            .unwrap();
        // println!("RUST change request {:?} \n", change_request);
        let _patch = backend
            .apply_local_change(change_request.unwrap())
            .unwrap()
            .0;
        self.serialized_backend = backend.save().and_then(|data| Ok(data)).unwrap();
        Ok(())
    }

    fn to_dict<'p>(&self, py: Python<'p>) -> PyResult<HashMap<String, &'p PyAny>> {
        let mut frontend = automerge_frontend::Frontend::new();
        let backend = automerge_backend::Backend::load(self.serialized_backend.clone())
            .and_then(|back| Ok(back))
            .unwrap();
        frontend.apply_patch(backend.get_patch().unwrap());
        let root_path = automerge_frontend::Path::root();
        let value: automerge_frontend::Value = frontend.get_value(&root_path).unwrap();
        let mut result = HashMap::new();
        match value {
            automerge_frontend::Value::Map(map, _) => {
                result = map
                    .iter()
                    .map(|(k, v)| (k.clone(), automerge_to_py_val(py, &v)))
                    .collect();
            }
            _ => (),
        }
        Ok(result)
    }
}

#[pyproto]
impl<'p> PyObjectProtocol<'p> for HashmapDocument {
    fn __getattr__(&'p self, name: String) -> PyResult<&'p PyAny> {
        unsafe {
            let py: Python<'p> = Python::assume_gil_acquired();
            self.get(py, name)
        }
    }

    fn __setattr__(&'p mut self, name: String, value: &'p PyAny) -> PyResult<()> {
        unsafe {
            let py: Python<'p> = Python::assume_gil_acquired();
            self.set(py, name, value)
        }
    }
    // TODO
    // fn __delattr__(&mut self, name: FromPyObject) -> PyResult<()>
}

#[pyproto]
impl PyMappingProtocol for HashmapDocument {
    // TODO
    // fn __len__(&self) -> usize

    fn __getitem__(&'p self, name: String) -> PyResult<&'p PyAny> {
        unsafe {
            let py: Python<'p> = Python::assume_gil_acquired();
            self.get(py, name)
        }
    }
    fn __setitem__(&'p mut self, name: String, value: &'p PyAny) -> PyResult<()> {
        unsafe {
            let py: Python<'p> = Python::assume_gil_acquired();
            self.set(py, name, value)
        }
    }
}

// Convert from an automerge scalar value (used by automerge_value::Primitive) to something Python compatible
fn automerge_primivite_to_py<'p>(
    py: Python<'p>,
    am_prim: &automerge_protocol::ScalarValue,
) -> &'p PyAny {
    match am_prim {
        automerge_protocol::ScalarValue::Int(i) => unsafe {
            &(py.from_owned_ptr(ffi::PyLong_FromLongLong(*i)))
        },
        automerge_protocol::ScalarValue::F64(f) => &PyFloat::new(py, *f),

        automerge_protocol::ScalarValue::Boolean(b) => PyString::new(py, "TODO"),
        // Doesn't compile, fix it
        // automerge_protocol::ScalarValue::Null => &(py.None().extract(py).unwrap()),
        automerge_protocol::ScalarValue::Null => PyString::new(py, "TODO"),

        // we're not supposed to store any of the following values in the backend
        automerge_protocol::ScalarValue::Str(s) => PyString::new(py, "N/A"),
        automerge_protocol::ScalarValue::Uint(ui) => PyString::new(py, "N/A"),
        automerge_protocol::ScalarValue::F32(f) => PyString::new(py, "N/A"),
        automerge_protocol::ScalarValue::Counter(c) => PyString::new(py, "N/A"),
        automerge_protocol::ScalarValue::Timestamp(t) => PyString::new(py, "N/A"),
    }
}

// Convert from an automerge_value to something Python compatible
fn automerge_to_py_val<'p>(py: Python<'p>, am_value: &automerge_frontend::Value) -> &'p PyAny {
    let result: &PyAny = match am_value {
        automerge_frontend::Value::Text(chars) => {
            PyUnicode::new(py, &chars.iter().collect::<String>())
        }
        automerge_frontend::Value::Primitive(scalar) => automerge_primivite_to_py(py, scalar),
        automerge_frontend::Value::Sequence(seq) => {
            // seq is type Vec<automerge_frontend::Value>
            let mut converted_list: std::vec::Vec<&PyAny> = std::vec::Vec::new();
            for am_val in seq.iter() {
                converted_list.push(automerge_to_py_val(py, am_val));
            }
            PyList::new(py, &converted_list)
        }
        automerge_frontend::Value::Map(map, _) => {
            let converted_map = PyDict::new(py);

            for key in map.keys() {
                converted_map.set_item(key, automerge_to_py_val(py, &map[key]));
            }

            converted_map
        }
    };
    return result;
}

// fn py_int_to_bytearray<'p>(py: Python<'p>, val: int) -> &'p PyByteArray {}

fn py_to_automerge_val(py_value: &PyAny) -> automerge_frontend::Value {
    let gil = Python::acquire_gil();
    let py = gil.python();
    let scalar_null = automerge_protocol::ScalarValue::Null;
    let mut converted_value: automerge_frontend::Value =
        automerge_frontend::Value::Primitive(scalar_null);

    if PyInt::type_object(py).is_instance(py_value).unwrap() {
        // First, extract the int value
        let int_value = py_value
            .downcast::<PyInt>()
            .unwrap()
            .extract::<i64>() // To build an Automerge Scalar Value, we need i64
            .unwrap();

        // Turn it into a scalar value for automerge - required for Primitive frontend values
        let scalar_value = automerge_protocol::ScalarValue::Int(int_value);

        // Now, we can build a frontend value from this scalar value
        converted_value = automerge_frontend::Value::Primitive(scalar_value);
    } else if PyFloat::type_object(py).is_instance(py_value).unwrap() {
        // First, extract the Float value
        let float_value = py_value
            .downcast::<PyFloat>()
            .unwrap()
            .extract::<f64>() // To build an Automerge Scalar Value, we need f32 or f64
            .unwrap();

        // Turn it into a scalar value for automerge - required for Primitive frontend values
        let scalar_value = automerge_protocol::ScalarValue::F64(float_value);

        // Now, we can build a frontend value from this scalar value
        converted_value = automerge_frontend::Value::Primitive(scalar_value);
    } else if PyByteArray::type_object(py).is_instance(py_value).unwrap() {
        // TODO :  Build the frontend value
        let byte_array_value = py_value.downcast::<PyByteArray>().unwrap();
        println!(" RUST TODO HANDLE BYTE ARRAY {:?}", py_value);
        println!(" RUST UNICODE VALUE {:?}", byte_array_value);
    } else if PyUnicode::type_object(py).is_instance(py_value).unwrap() {
        let unicode_value = py_value.downcast::<PyUnicode>().unwrap();

        let str_value = py_value
            .downcast::<PyUnicode>()
            .unwrap()
            .extract::<String>()
            .unwrap();
        converted_value =
            automerge_frontend::Value::Text(unicode_value.to_str().unwrap().chars().collect());
    } else if PyList::type_object(py).is_instance(py_value).unwrap() {
        // Extract the list value
        let list_value = py_value.downcast::<PyList>().unwrap();

        let mut converted_list: std::vec::Vec<automerge_frontend::Value> = std::vec::Vec::new();
        for item in list_value.iter() {
            converted_list.push(py_to_automerge_val(item));
        }

        converted_value = automerge_frontend::Value::Sequence(converted_list);
    } else if PyDict::type_object(py).is_instance(py_value).unwrap() {
        // Extract the dict value
        let dict_value = py_value.downcast::<PyDict>().unwrap();

        // WARNING : Automerge only handles HashMap<String, Value>
        // So we can't handle python dicts with keys other than strings for the moment.
        let mut hashmap_converted: HashMap<String, automerge_frontend::Value> = HashMap::new();

        for key in dict_value.keys() {
            hashmap_converted
                .entry(key.to_string())
                .or_insert(py_to_automerge_val(dict_value.get_item(key).unwrap()));
        }

        converted_value =
            automerge_frontend::Value::Map(hashmap_converted, automerge_protocol::MapType::Map);
    } else {
        // TODO : handle this better
        println!(" RUST COULDNT CAST {:?}", py_value);
    }
    return converted_value;
}

//  This function is out of the #[pymethods] declaration because we don't want to expose it to Python
fn base_document(hashmap_struct: HashMap<String, &PyAny>) -> automerge_backend::Backend {
    let mut backend = automerge_backend::Backend::init();
    let mut frontend = automerge_frontend::Frontend::new();

    // Convert the values of the hashamp into automerge_frontend::Value
    let mut hashmap_converted: HashMap<String, automerge_frontend::Value> = HashMap::new();
    for key in hashmap_struct.keys() {
        let py_value = hashmap_struct[key];
        let converted_value = py_to_automerge_val(py_value);
        hashmap_converted
            .entry(key.to_string())
            .or_insert(converted_value);
    }

    // Create a "change" action, that sets the hashmap as root of my automerge document.
    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root(),
        automerge_frontend::Value::Map(hashmap_converted, automerge_protocol::MapType::Map),
    );

    // Apply this change
    let change_request = frontend
        .change::<_, automerge_frontend::InvalidChangeRequest>(
            Some("set root object".into()),
            |frontend| {
                frontend.add_change(change)?;
                Ok(())
            },
        )
        .unwrap();

    // the change can be none if something wrong happened, or if the initial hashmap_struct is an empty dict
    if !change_request.is_none() {
        backend
            .apply_local_change(change_request.unwrap())
            .unwrap()
            .0;
    }
    return backend;
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_class::<HashmapDocument>()?;

    Ok(())
}
