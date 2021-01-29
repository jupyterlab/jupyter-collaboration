use automerge_backend;
use log::info;
use pyo3::conversion::FromPyObject;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use pyo3::wrap_pyfunction;
use std::collections::HashMap;
use std::vec;

/// This enum is important as it gives us all
/// the possible types for python dictionary
/// values.
#[derive(Debug, FromPyObject)]
enum nbCodeCell<'a> {
    id(String),
    cell_type(String),
    metadata(HashMap<String, String>),
    execution_count(i32),
    source(String),
    output(Vec<i32>),
    CatchAll(&'a PyAny),
}

#[derive(Debug, FromPyObject)]
struct nbModel<'a> {
    nbformat: i32,
    nbformat_minor: i32,
    metadata: Option<HashMap<String, &'a PyAny>>,
    cells: Option<Vec<nbCodeCell<'a>>>,
}

/// Takes a notebook from python's nbformat
/// and then uses the `v4` version of the document
/// to let rust access the document using native
/// rust types.
///
/// Check logs for decompiled version.
#[pyfunction]
fn serialize_notebook(pynb: PyObject, py: Python) {
    let nbformat_model: &PyDict = pynb.extract(py).unwrap();
    let mut nb = nbModel {
        nbformat: nbformat_model
            .get_item("nbformat")
            .unwrap()
            .extract()
            .unwrap(),
        nbformat_minor: nbformat_model
            .get_item("nbformat_minor")
            .unwrap()
            .extract()
            .unwrap(),
        metadata: nbformat_model
            .get_item("metadata")
            .unwrap()
            .extract()
            .unwrap(),
        cells: nbformat_model.get_item("cells").unwrap().extract().unwrap(),
    };
    info!("The nbmod from the dict: {:?}", nb);
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
    module.add_function(wrap_pyfunction!(serialize_notebook, module)?)?;
    module.add_function(wrap_pyfunction!(initialize_nbdoc, module)?)?;
    module.add_function(wrap_pyfunction!(get_changes, module)?)?;
    module.add_function(wrap_pyfunction!(apply_change, module)?)?;
    Ok(())
}
