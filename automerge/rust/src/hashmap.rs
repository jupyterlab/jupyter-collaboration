use automerge_backend;
use automerge_frontend;
use automerge_protocol;

use std::println;

use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyInt, PyList, PyString};
use pyo3::wrap_pyfunction;
use std::collections::HashMap;

fn base_document(hashmap_struct: HashMap<String, String>) -> automerge_backend::Backend {
    let mut doc = automerge_backend::Backend::init();
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

    println!("RUST initial change request {:?}", change_request);

    doc.apply_local_change(change_request.unwrap()).unwrap().0;
    return doc;
}

#[pyfunction]
fn new_hashmap(py_struct: &PyDict) -> std::vec::Vec<u8> {
    // let gil = Python::acquire_gil();
    // let py = gil.python();

    println!("RUST {:?}", py_struct);

    //  Convert from a PyDict to a Hashmap Str:Str
    let hashmap_struct: std::result::Result<HashMap<String, String>, PyErr> = py_struct
        .extract()
        .and_then(|hashmap_struct| Ok(hashmap_struct));
    println!("RUST {:?}", hashmap_struct);

    let doc = base_document(hashmap_struct.unwrap());

    let data = doc.save().and_then(|data| Ok(data));
    return data.unwrap();
}

#[pyfunction]
fn apply_changes(doc: std::vec::Vec<u8>, changes_bytes: std::vec::Vec<u8>) -> std::vec::Vec<u8> {
    let mut doc = automerge_backend::Backend::load(doc)
        .and_then(|back| Ok(back))
        .unwrap();
    let changes = automerge_backend::Change::from_bytes(changes_bytes)
        .and_then(|c| Ok(c))
        .unwrap();
    doc.apply_changes(vec![changes])
        .and_then(|patch| Ok(patch))
        .unwrap();
    let data = doc.save().and_then(|data| Ok(data));
    return data.unwrap();
}

#[pyfunction]
fn set(doc: std::vec::Vec<u8>, key: String, value: String) -> std::vec::Vec<u8> {
    let mut frontend = automerge_frontend::Frontend::new();
    let mut doc = automerge_backend::Backend::load(doc)
        .and_then(|back| Ok(back))
        .unwrap();

    println!("RUST set {:?}->{:?}", key, value);

    // Create a "change" action, that sets the value for the given key
    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key(key),
        automerge_frontend::Value::Text(value.chars().collect()),
    );

    // println!("RUST change {}", change);

    // Apply this change
    let change_request = frontend
        .change::<_, automerge_frontend::InvalidChangeRequest>(Some("set".into()), |frontend| {
            frontend.add_change(change)?;
            Ok(())
        })
        .unwrap();

    println!("RUST change request {:?}", change_request);

    let _patch = doc.apply_local_change(change_request.unwrap()).unwrap().0;

    // test
    let changes = doc.get_changes(&[]);
    println!("RUST (set) get changes {:?}", changes);
    //

    let data = doc.save().and_then(|data| Ok(data));
    return data.unwrap();
}

#[pyfunction]
fn get_all_changes(doc: std::vec::Vec<u8>) -> std::vec::Vec<std::vec::Vec<u8>> {
    let doc = automerge_backend::Backend::load(doc)
        .and_then(|back| Ok(back))
        .unwrap();
    let changes = doc.get_changes(&[]);

    let changes = doc.get_changes(&[]);
    println!("RUST get changes {:?}", changes);

    let mut bytes: std::vec::Vec<std::vec::Vec<u8>> = std::vec::Vec::new();
    for c in changes.iter() {
        bytes.push(c.bytes.clone());
    }
    return bytes;
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(new_hashmap, module)?)?;
    module.add_function(wrap_pyfunction!(apply_changes, module)?)?;
    module.add_function(wrap_pyfunction!(get_all_changes, module)?)?;
    module.add_function(wrap_pyfunction!(set, module)?)?;
    Ok(())
}

// /*
//  * Critical path: new_document, get_all_changes.
//  * TODO apply_changes
//  */
// #[test]
// fn test_new_document() {
//     // Instanciating an automerge frontend and generating a patch of changes, and checking the document changed.
//     let doc = new_document("test_doc_id", "Test content");
//     let changes = get_all_changes(doc);
//     // There must be two changes : one to set the doc id, one to set the content.
//     assert_eq!(changes.len(), 2);
// }
