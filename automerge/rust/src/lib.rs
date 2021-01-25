use pyo3::prelude::*;
use std::fs::File;
// Logging
use log::LevelFilter;
use simplelog::*;
mod load;
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

    let submod = PyModule::new(py, "automerge")?;
    let submod_textarea = PyModule::new(py, "textarea")?;
    let submod_load = PyModule::new(py, "load")?;
    let submod_nbformatbackend = PyModule::new(py, "nbf")?;
    load::init_submodule(submod_load)?;
    nbformatbackend::init_submodule(submod_nbformatbackend)?;
    textarea::init_submodule(submod_textarea)?;
    module.add_submodule(submod)?;
    module.add_submodule(submod_textarea)?;
    module.add_submodule(submod_load)?;
    module.add_submodule(submod_nbformatbackend)?;
    Ok(())
}
