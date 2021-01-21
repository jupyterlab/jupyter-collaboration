use log::{debug, info, LevelFilter};
use pyo3::conversion::FromPyObject;
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyInt, PyList, PyString};
use pyo3::wrap_pyfunction;
use std::collections::HashMap;

#[pyfunction]
fn str_str_dict(pyd: PyObject, py: Python) {
    let res: HashMap<&str, &str> = pyd.extract(py).unwrap();
    info!("The hashmap from the dict: {:?}", res);
}

#[pyfunction]
fn str_int_dict(pyd: PyObject, py: Python) {
    let res: HashMap<&str, i32> = pyd.extract(py).unwrap();
    info!("The hashmap resultant from str_int_dict: {:?}", res);
}

#[pyfunction]
fn str_list_dict(pyd: PyObject, py: Python) {
    let res: HashMap<&str, Vec<i32>> = pyd.extract(py).unwrap();
    info!("The hashmap from the str_list_dict: {:?}", res);
}

pub fn init_submodule(module: &PyModule) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(str_str_dict, module)?)?;
    module.add_function(wrap_pyfunction!(str_int_dict, module)?)?;
    module.add_function(wrap_pyfunction!(str_list_dict, module)?)?;
    Ok(())
}
