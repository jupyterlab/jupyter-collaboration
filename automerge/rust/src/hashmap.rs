use automerge_backend;
use automerge_frontend;
use automerge_protocol;

use std::println;

use pyo3::prelude::*;
// use pyo3::types::{PyBytes, PyDict, PyInt, PyList, PyString};
use pyo3::types::PyDict;
use pyo3::wrap_pyfunction;
use std::collections::HashMap;

fn base_document(hashmap_struct: HashMap<String, String>) -> automerge_backend::Backend {
    let mut backend = automerge_backend::Backend::init();
    let mut frontend = automerge_frontend::Frontend::new();

    // Convert the values of the hashamp into automerge_frontend::Value::Text
    let mut hashmap_converted: HashMap<String, automerge_frontend::Value> = HashMap::new();
    for key in hashmap_struct.keys() {
        let converted_value =
            automerge_frontend::Value::Text(hashmap_struct[key].chars().collect());
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

    // println!("RUST initial change request {:?}", change_request);

    backend
        .apply_local_change(change_request.unwrap())
        .unwrap()
        .0;
    return backend;
}

#[pyfunction]
fn new_hashmap(py_struct: &PyDict) -> std::vec::Vec<u8> {
    // let gil = Python::acquire_gil();
    // let py = gil.python();

    // println!("RUST {:?}", py_struct);

    //  Convert from a PyDict to a Hashmap Str:Str
    let hashmap_struct: std::result::Result<HashMap<String, String>, PyErr> = py_struct
        .extract()
        .and_then(|hashmap_struct| Ok(hashmap_struct));
    // println!("RUST {:?}", hashmap_struct);

    let backend = base_document(hashmap_struct.unwrap());

    let data = backend.save().and_then(|data| Ok(data));
    return data.unwrap();
}

// WARNING : this function is named "apply_changes", plural, on purpose.
// It takes a  Vector of changes (each change being a Vector of u8)
#[pyfunction]
fn apply_changes(
    raw_backend: std::vec::Vec<u8>,
    raw_changes: std::vec::Vec<std::vec::Vec<u8>>,
) -> std::vec::Vec<u8> {
    let mut backend = automerge_backend::Backend::load(raw_backend)
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
    let data = backend.save().and_then(|data| Ok(data));
    return data.unwrap();
}

#[pyfunction]
fn set(raw_backend: std::vec::Vec<u8>, key: String, value: String) -> std::vec::Vec<u8> {
    let mut backend = automerge_backend::Backend::load(raw_backend)
        .and_then(|back| Ok(back))
        .unwrap();

    let mut frontend = automerge_frontend::Frontend::new();
    frontend.apply_patch(backend.get_patch().unwrap());

    // println!("RUST set {:?}->{:?}", key, value);

    // Create a "change" action, that sets the value for the given key
    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key(key),
        automerge_frontend::Value::Text(value.chars().collect()),
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

    let data = backend.save().and_then(|data| Ok(data));
    return data.unwrap();
}

#[pyfunction]
fn get_all_changes(raw_backend: std::vec::Vec<u8>) -> std::vec::Vec<std::vec::Vec<u8>> {
    let backend = automerge_backend::Backend::load(raw_backend)
        .and_then(|back| Ok(back))
        .unwrap();
    let changes = backend.get_changes(&[]);

    // println!("RUST get changes {:?}", changes);

    let mut bytes: std::vec::Vec<std::vec::Vec<u8>> = std::vec::Vec::new();
    for c in changes.iter() {
        bytes.push(c.bytes.clone());
    }
    return bytes;
}

#[pyfunction]
fn get(raw_backend: std::vec::Vec<u8>, key: String) -> String {
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

    let backend = automerge_backend::Backend::load(raw_backend)
        .and_then(|back| Ok(back))
        .unwrap();
    frontend.apply_patch(backend.get_patch().unwrap());

    let root_path = automerge_frontend::Path::root().key(key);
    let value: automerge_frontend::Value = frontend.get_value(&root_path).unwrap();

    // println!("RUST value {:?}", value);

    let result = match value {
        automerge_frontend::Value::Text(chars) => chars.iter().cloned().collect::<String>(),
        _ => String::new(),
    };

    return result;
}

//
#[pyfunction]
fn to_dict(raw_backend: std::vec::Vec<u8>) -> HashMap<String, String> {
    let mut frontend = automerge_frontend::Frontend::new();

    let backend = automerge_backend::Backend::load(raw_backend)
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
                .map(|(k, v)| {
                    (
                        k.clone(),
                        match v {
                            automerge_frontend::Value::Text(chars) => {
                                chars.iter().cloned().collect::<String>()
                            }
                            _ => String::new(),
                        },
                    )
                })
                .collect();
        }
        _ => (),
    }

    return result;
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(new_hashmap, module)?)?;
    module.add_function(wrap_pyfunction!(apply_changes, module)?)?;
    module.add_function(wrap_pyfunction!(get_all_changes, module)?)?;
    module.add_function(wrap_pyfunction!(set, module)?)?;
    module.add_function(wrap_pyfunction!(get, module)?)?;
    module.add_function(wrap_pyfunction!(to_dict, module)?)?;
    Ok(())
}
