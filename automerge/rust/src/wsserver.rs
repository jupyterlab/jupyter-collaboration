extern crate tokio_tungstenite;
extern crate tungstenite;

// Websocket
use std::net::TcpListener;
use std::thread::spawn;
use tungstenite::server::accept;

// stdlib
use std::fs::File;

// Python Wrappers
use pyo3::prelude::*;
use pyo3::wrap_pyfunction;

// Thread
use std::thread;

// Logging
use log::{debug, info, LevelFilter};
use simplelog::*;

// Start a tungstenite based websocket server
#[pyfunction]
pub fn start_server(port: usize, log_fs_path: &str) {
    CombinedLogger::init(vec![
        TermLogger::new(LevelFilter::Warn, Config::default(), TerminalMode::Mixed),
        WriteLogger::new(
            LevelFilter::Info,
            Config::default(),
            File::create(log_fs_path.to_owned() + "/glootalkrs_wss.log").unwrap(),
        ),
    ])
    .unwrap();

    thread::spawn(move || {
        let mut web_localhost: String = "127.0.0.1:".to_owned();
        let url = web_localhost + &port.to_string();
        info!("glootalkrs | Starting WebSocket Server on {}", url);
        let server = TcpListener::bind(url).unwrap();
        for stream in server.incoming() {
            spawn(move || {
                let mut websocket = accept(stream.unwrap()).unwrap();
                loop {
                    let msg = websocket.read_message().unwrap();
                    if msg.is_binary() || msg.is_text() {
                        info!("Recieved message: {}", msg);
                        websocket.write_message(msg).unwrap();
                    }
                }
            });
        }
    });
}
