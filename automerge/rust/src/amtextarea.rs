// Python Wrappers
use pyo3::prelude::*;
use pyo3::wrap_pyfunction;
// Automerge Libraries
use automerge_backend;
use automerge_frontend;
use automerge_protocol;

fn default_document(doc_id: &str, default_text: &str) -> automerge_backend::Backend {
    let mut doc_backend = automerge_backend::Backend::init();
    let mut doc_frontend = automerge_frontend::Frontend::new();

    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key("docId"),
        automerge_frontend::Value::Primitive(automerge_protocol::ScalarValue::Str(
            doc_id.to_string(),
        )),
    );

    let change_request = doc_frontend
        .change::<_, automerge_frontend::InvalidChangeRequest>(
            Some("set root object".into()),
            |doc_frontend| {
                doc_frontend.add_change(change)?;
                Ok(())
            },
        )
        .unwrap();

    // let patch =
    doc_backend
        .apply_local_change(change_request.unwrap())
        .unwrap()
        .0;

    // the textArea key contains the content of the client-side text area
    let change = automerge_frontend::LocalChange::set(
        automerge_frontend::Path::root().key("textArea"),
        automerge_frontend::Value::Text(default_text.chars().collect()),
    );

    let change_request = doc_frontend
        .change::<_, automerge_frontend::InvalidChangeRequest>(Some("".into()), |doc_frontend| {
            doc_frontend.add_change(change)?;
            Ok(())
        })
        .unwrap();

    // let patch =
    doc_backend
        .apply_local_change(change_request.unwrap())
        .unwrap()
        .0;

    return doc_backend;
}

#[pyfunction]
fn new_document(doc_id: &str, default_text: &str) -> std::vec::Vec<u8> {
    let doc = default_document(doc_id, default_text);
    let doc_data = doc.save().and_then(|data| Ok(data));
    return doc_data.unwrap();
}

#[pyfunction]
fn apply_change(doc: std::vec::Vec<u8>, change_data: std::vec::Vec<u8>) -> std::vec::Vec<u8> {
    let mut doc_backend = automerge_backend::Backend::load(doc)
        .and_then(|back| Ok(back))
        .unwrap();

    let change = automerge_backend::Change::from_bytes(change_data)
        .and_then(|c| Ok(c))
        .unwrap();

    doc_backend
        .apply_changes(vec![change])
        .and_then(|patch| Ok(patch))
        .unwrap();

    let doc_data = doc_backend.save().and_then(|data| Ok(data));

    return doc_data.unwrap();
}

#[pyfunction]
fn get_changes(doc: std::vec::Vec<u8>) -> std::vec::Vec<std::vec::Vec<u8>> {
    let doc_backend = automerge_backend::Backend::load(doc)
        .and_then(|back| Ok(back))
        .unwrap();

    let changes = doc_backend.get_changes(&[]);

    let mut changes_bytes: std::vec::Vec<std::vec::Vec<u8>> = std::vec::Vec::new();

    for c in changes.iter() {
        changes_bytes.push(c.bytes.clone());
    }

    return changes_bytes;
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(new_document, module)?)?;
    module.add_function(wrap_pyfunction!(apply_change, module)?)?;
    module.add_function(wrap_pyfunction!(get_changes, module)?)?;
    Ok(())
}

#[test]
fn test_new_document() {

    // Simple test over the critical path : create document, get changes.
    
    // apply_changes will have to be tested :
    // - here, instanciating an automerge frontend and generating a patch of changes, and checking the document changed
    // - through an automated UI test using a text area
    
    let doc_data = new_document("test_doc_id", "Test content");
    let changes_data = get_changes(doc_data);
    

    // There must be two changes : one to set the doc id, one to set the content
    assert_eq!( changes_data.len(), 2  );
    
    
}

