use automerge_backend;
use automerge_frontend;
use automerge_protocol;

use pyo3::prelude::*;
use pyo3::wrap_pyfunction;

fn base_document(doc_id: &str, default_text: &str) -> automerge_backend::Backend {
    let mut doc = automerge_backend::Backend::init();
    let mut frontend = automerge_frontend::Frontend::new();
    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key("docId"),
        automerge_frontend::Value::Primitive(automerge_protocol::ScalarValue::Str(
            doc_id.to_string(),
        )),
    );
    let change_request = frontend
        .change::<_, automerge_frontend::InvalidChangeRequest>(
            Some("set root object".into()),
            |frontend| {
                frontend.add_change(change)?;
                Ok(())
            },
        )
        .unwrap();
    doc.apply_local_change(change_request.unwrap())
        .unwrap()
        .0;
    let changes = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key("textArea"),
        automerge_frontend::Value::Text(default_text.chars().collect()),
    );
    let change_request = frontend
        .change::<_, automerge_frontend::InvalidChangeRequest>(Some("".into()), |frontend| {
            frontend.add_change(changes)?;
            Ok(())
        })
        .unwrap();
    doc.apply_local_change(change_request.unwrap())
        .unwrap()
        .0;
    return doc;
}

#[pyfunction]
fn new_document(doc_id: &str, text: &str) -> std::vec::Vec<u8> {
    let doc = base_document(doc_id, text);
    let data = doc.save().and_then(|data| Ok(data));
    return data.unwrap();
}

// TODO : Rename this into "apply_change", as it applies only *one* change
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
fn get_all_changes(doc: std::vec::Vec<u8>) -> std::vec::Vec<std::vec::Vec<u8>> {
    let doc = automerge_backend::Backend::load(doc)
        .and_then(|back| Ok(back))
        .unwrap();
    let changes = doc.get_changes(&[]);
    let mut bytes: std::vec::Vec<std::vec::Vec<u8>> = std::vec::Vec::new();
    for c in changes.iter() {
        bytes.push(c.bytes.clone());
    }
    return bytes;
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(new_document, module)?)?;
    module.add_function(wrap_pyfunction!(apply_changes, module)?)?;
    module.add_function(wrap_pyfunction!(get_all_changes, module)?)?;
    Ok(())
}

/*
 * Critical path: new_document, get_all_changes.
 * TODO apply_changes
 */
#[test]
fn test_new_document() {
    // Instanciating an automerge frontend and generating a patch of changes, and checking the document changed.
    let doc = new_document("test_doc_id", "Test content");
    let changes = get_all_changes(doc);
    // There must be two changes : one to set the doc id, one to set the content.
    assert_eq!( changes.len(), 2  );
}
