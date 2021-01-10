// Python Wrappers
use pyo3::prelude::*;
use pyo3::wrap_pyfunction;

// Automerge Libraries
use automerge_backend;
use automerge_frontend;
use automerge_protocol;

fn default_backend() -> automerge_backend::Backend {
    let mut backend = automerge_backend::Backend::init();
    let mut doc = automerge_frontend::Frontend::new();

    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key("docId"),
        automerge_frontend::Value::Primitive(automerge_protocol::ScalarValue::Str(
            "automerge-room".to_string(),
        )),
    );

    let change_request = doc
        .change::<_, automerge_frontend::InvalidChangeRequest>(
            Some("set root object".into()),
            |doc| {
                doc.add_change(change)?;
                Ok(())
            },
        )
        .unwrap();

    // let patch =
    backend
        .apply_local_change(change_request.unwrap())
        .unwrap()
        .0;

    // the textArea key contains the content of the client-side text area
    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key("textArea"),
        automerge_frontend::Value::Text("Hello".chars().collect()),
    );

    let change_request = doc
        .change::<_, automerge_frontend::InvalidChangeRequest>(Some("".into()), |doc| {
            doc.add_change(change)?;
            Ok(())
        })
        .unwrap();

    // let patch =
    backend
        .apply_local_change(change_request.unwrap())
        .unwrap()
        .0;

    return backend;
}

#[pyfunction]
fn new_backend() -> std::vec::Vec<u8> {
    let backend = default_backend();

    let backend_data = backend.save().and_then(|data| Ok(data));

    return backend_data.unwrap();
}

#[pyfunction]
fn apply_change(
    backend_data: std::vec::Vec<u8>,
    change_data: std::vec::Vec<u8>,
) -> std::vec::Vec<u8> {
    let mut backend = automerge_backend::Backend::load(backend_data)
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

#[pyfunction]
fn get_changes(backend_data: std::vec::Vec<u8>) -> std::vec::Vec<std::vec::Vec<u8>> {
    let backend = automerge_backend::Backend::load(backend_data)
        .and_then(|back| Ok(back))
        .unwrap();

    let changes = backend.get_changes(&[]);

    let mut changes_bytes: std::vec::Vec<std::vec::Vec<u8>> = std::vec::Vec::new();

    for c in changes.iter() {
        changes_bytes.push(c.bytes.clone());
    }

    return changes_bytes;
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(new_backend, module)?)?;
    module.add_function(wrap_pyfunction!(apply_change, module)?)?;
    module.add_function(wrap_pyfunction!(get_changes, module)?)?;
    Ok(())
}
