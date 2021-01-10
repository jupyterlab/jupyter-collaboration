// TODO: Take out before release
use std::fs::File;
use std::println;
use std::thread::spawn;

// Logging
use log::{info, LevelFilter};
use simplelog::*;

// Python Wrappers
use pyo3::prelude::*;
use pyo3::types::IntoPyDict;
use pyo3::{wrap_pyfunction, wrap_pymodule};

// Automerge Libraries
use automerge_backend;
use automerge_protocol;

// State Storage
struct automergeState {
    ledger: automerge_backend::Backend,
}

#[pyfunction]
fn init(log_path: &str) {
    info!("Initializing automerge backend...");
    let mut am = automergeState {
        ledger: automerge_backend::Backend::init(),
    };
    info!("Initialized automerge backend, {:?}", am.ledger);
}

// TODO: Serialize char to a byte string in python :)
fn add_change(am: &mut automergeState) {
    info!("Adding a change.");
    // note v is a vector of type Vec<automerge_backend::Change>
    //automerge_backend::Backend::apply_changes(&mut am.ledger, v);
    info!("Added change: {:?}", am.ledger);
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(init, module)?)?;
    Ok(())
}
