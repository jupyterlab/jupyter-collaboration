use tokio_tungstenite;
use tungstenite;

// Websocket
use std::net::TcpListener;
use std::thread::spawn;
use tungstenite::server::accept;
use tungstenite::*;

// stdlib
use std::fs::File;
use std::println;

// Python Wrappers
use pyo3::prelude::*;
use pyo3::wrap_pyfunction;

// Thread
use std::sync::Arc;
use std::thread;

// Logging
use log::{debug, info, LevelFilter};
use simplelog::*;

mod amserver;
use amserver::init_submodule;

mod ambackend;

use automerge_backend as amb;
use automerge_frontend::{Frontend, InvalidChangeRequest, LocalChange, Path, Value};
use automerge_protocol as amp;

// Start a tungstenite based websocket server
#[pyfunction]
fn start_server(port: usize, log_path: &str) {
    CombinedLogger::init(vec![
        TermLogger::new(LevelFilter::Warn, Config::default(), TerminalMode::Mixed),
        WriteLogger::new(
            LevelFilter::Info,
            Config::default(),
            File::create(log_path.to_owned() + "/gt_wss.log").unwrap(),
        ),
    ])
    .unwrap();
    let mbackend = Arc::new(std::sync::Mutex::new(amb::Backend::init()));
    let mdoc = Arc::new(std::sync::Mutex::new(Frontend::new()));

    thread::spawn(move || {
        let web_localhost: String = "127.0.0.1:".to_owned();
        let url = web_localhost + &port.to_string();
        info!("glootalkrs | Starting WebSocket Server on {}", url);
        let server = TcpListener::bind(url).unwrap();
        for stream in server.incoming() {
            spawn(move || {
                /*let mut websocket = accept(stream.unwrap()).unwrap();
                let mut backend = mbackend.lock().unwrap();
                let mut doc = mdoc.lock().unwrap();
                // --
                // It's important the docId value passed here ("automerge-room") is equal
                // to the value set in the client
                let change = LocalChange::set(
                    Path::root().key("docId"),
                    Value::Primitive(amp::ScalarValue::Str("automerge-room".to_string())),
                );

                let change_request = doc
                    .change::<_, InvalidChangeRequest>(Some("set root object".into()), |doc| {
                        doc.add_change(change)?;
                        Ok(())
                    })
                    .unwrap();

                info!(" change request : {:?}", change_request);
                let patch = backend
                    .apply_local_change(change_request.unwrap())
                    .unwrap()
                    .0;
                info!(" patch : {:?}", patch);

                // the textArea key contains the content of the client-side text area
                let change = LocalChange::set(
                    Path::root().key("textArea"),
                    //Value::Primitive(amp::ScalarValue::Str("Hello".to_string())),
                    Value::Text("Hello".chars().collect()),
                );

                let change_request = doc
                    .change::<_, InvalidChangeRequest>(Some("".into()), |doc| {
                        doc.add_change(change)?;
                        Ok(())
                    })
                    .unwrap();

                info!(" change request : {:?}", change_request);

                let patch = backend
                    .apply_local_change(change_request.unwrap())
                    .unwrap()
                    .0;
                info!(" patch : {:?}", patch);

                let changes = backend.get_changes(&[]);

                for ch in changes {
                    info!(" change : {:?}", ch.bytes);

                    let mut bin_msg = Vec::new();

                    bin_msg.extend(ch.bytes.iter().copied());
                    info!(" bin msg : {:?}", bin_msg);

                    websocket
                        .write_message(tungstenite::Message::Binary(bin_msg))
                        .unwrap();
                }

                info!(" doc state : {:?}", doc.state());

                loop {
                    let msg = websocket.read_message().unwrap();
                    if msg.is_binary() || msg.is_text() {
                        info!("Recieved message: {}", msg);
                    } else {
                        info!("Recieved non bin non txt message: {}", msg);
                    }
                }
                */
            });
        }
    });
}

// The main python module - glootalk
#[pymodule]
fn glootalk(py: Python, module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(start_server, module)?)?;
    // let submod = PyModule::new(py, "automerge")?;
    // init_submodule(submod)?;
    // module.add_submodule(submod)?;

    let submod = PyModule::new(py, "automerge")?;
    ambackend::init_submodule(submod)?;
    module.add_submodule(submod)?;

    Ok(())
}
