// stdlib
use std::fs::File;

// Python Wrappers
use pyo3::prelude::*;

// Logging
use log::LevelFilter;
use simplelog::*;

mod ambackend;
mod load;
mod nbformatbackend;

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

    let submod = PyModule::new(py, "automerge")?;
    let submod_load = PyModule::new(py, "load")?;
    let submod_nbformatbackend = PyModule::new(py, "nbf")?;
    ambackend::init_submodule(submod)?;
    load::init_submodule(submod_load)?;
    nbformatbackend::init_submodule(submod_nbformatbackend)?;
    module.add_submodule(submod)?;
    module.add_submodule(submod_load)?;
    module.add_submodule(submod_nbformatbackend)?;
    Ok(())
}
