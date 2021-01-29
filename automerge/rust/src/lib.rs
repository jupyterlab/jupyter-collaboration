use pyo3::prelude::*;
use std::fs::File;
// Logging
use log::LevelFilter;
use simplelog::*;
mod hashmap;
mod nbformatbackend;
mod textarea;

// The main python module - jupyter_rtc_automerge
#[pymodule]
fn jupyter_rtc_automerge(py: Python, module: &PyModule) -> PyResult<()> {
    CombinedLogger::init(vec![
        TermLogger::new(LevelFilter::Warn, Config::default(), TerminalMode::Mixed),
        WriteLogger::new(
            LevelFilter::Info,
            Config::default(),
            File::create("./jupyter_rtc_automerge.log").unwrap(),
        ),
    ])
    .unwrap();

    let submod_textarea = PyModule::new(py, "textarea")?;
    textarea::init_submodule(submod_textarea)?;
    module.add_submodule(submod_textarea)?;

    let submod_nbformatbackend = PyModule::new(py, "nb")?;
    nbformatbackend::init_submodule(submod_nbformatbackend)?;
    module.add_submodule(submod_nbformatbackend)?;

    let submod_hashmap = PyModule::new(py, "hashmap")?;
    hashmap::init_submodule(submod_hashmap)?;
    module.add_submodule(submod_hashmap)?;

    Ok(())
}
