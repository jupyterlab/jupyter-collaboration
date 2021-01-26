use automerge_backend;
use automerge_frontend;
use automerge_protocol;
use log::{debug, info, LevelFilter};
use pyo3::conversion::FromPyObject;
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyInt, PyList, PyString};
use pyo3::wrap_pyfunction;
use std::collections::HashMap;
use std::vec;

/// This enum is important as it gives us all
/// the possible types for python dictionary
/// values.
#[derive(FromPyObject)]
enum nbCodeCell<'a> {
    id(String),
    cell_type(String),
    metadata(HashMap<String, String>),
    execution_count(i32),
    source(String),
    output(Vec<i32>),
    CatchAll(&'a PyAny),
}

#[derive(FromPyObject)]
enum nbModel<'a> {
    nbformat(i32),
    nbformat_minor(i32),
    metadata(HashMap<String, String>),
    cells(Vec<nbCodeCell<'a>>),
    CatchAll(&'a PyAny),
}

/// Takes a Python Objet of Type List and then
/// unpacks it to a rust vector type.
fn _pylist_to_vector(pyd: PyObject, py: Python) {
    let res: Vec<i32> = pyd.extract(py).unwrap();
}

/// Takes a PythonObject of Type Dictionary
/// and then unpacks it to a Rust HashMap.
///
/// Note: The type of the Keys and Values of
/// the hashmap cannot be inferred. Therefore,
/// we expect them to be defined when passed in
/// from Python.
///
/// Returns a rust hashmap.
fn _pydict_to_hashmap(pyd: PyObject, py: Python) {
    let res: HashMap<&str, &str> = pyd.extract(py).unwrap();
    info!("The hashmap from the dict: {:?}", res);
}

#[pyfunction]
fn serialize_notebook(pynb: PyObject, py: Python) {
    let res: HashMap<&str, nbModel> = pynb.extract(py).unwrap();
}

#[pyfunction]
fn apply_change(current_data: Vec<u8>, change_data: Vec<u8>) -> Vec<u8> {
    let mut backend = automerge_backend::Backend::load(current_data)
        .and_then(|back| Ok(back))
        .unwrap();
    let change = automerge_backend::Change::from_bytes(change_data)
        .and_then(|c| Ok(c))
        .unwrap();
    backend
        .apply_changes(vec![change])
        .and_then(|patch| Ok(patch))
        .unwrap();
    let backend_data = backend.save().and_then(|data| Ok(data));
    return backend_data.unwrap();
}

/// Initializes the Automerge Backend on the Rust side
///
/// Interal Method
/// Returns a new `automerge_backend` object.
fn _initialize_automerge_backend() -> automerge_backend::Backend {
    let mut backend = automerge_backend::Backend::init();
    return backend;
}

/// Processes the change that was recieved. The change will
/// come from python.
///
/// Internal Function
/// get_changes takes a byte-serialized
/// vector and returns the changes comp
#[pyfunction]
fn get_changes(current_state: Vec<u8>) -> Vec<Vec<u8>> {
    let current_state = automerge_backend::Backend::load(current_state)
        .and_then(|back| Ok(back))
        .unwrap();

    let changes = current_state.get_changes(&[]);
    let mut cb: Vec<Vec<u8>> = Vec::new();
    return cb;
}

/// `nbdoc` is shorthand for notebook document. This
/// is a special method which lets the notebook passed
/// into the function map to an automerge document.
///
/// Python Method
/// Returns a Vec<u8> to Python
#[pyfunction]
fn initialize_nbdoc(pynb: PyObject, py: Python) -> Vec<u8> {
    let backend = _initialize_automerge_backend();
    let backend_data = backend.save().and_then(|data| Ok(data));
    return backend_data.unwrap();
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(initialize_nbdoc, module)?)?;
    module.add_function(wrap_pyfunction!(get_changes, module)?)?;
    module.add_function(wrap_pyfunction!(apply_change, module)?)?;
    Ok(())
}
