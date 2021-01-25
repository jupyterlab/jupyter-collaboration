from setuptools import setup
from setuptools_rust import RustExtension

setup(
    name="jupyter_rtc_automerge",
    version="0.1.1",
    packages=["jupyter_rtc_automerge"],
    author="Jupyter RTC",
    author_email="",
    description='The Jupyter RTC Python module using Automerge backend.',
    url="https://github.com/jupyterlab/rtc",
    rust_extensions=[RustExtension(
        "jupyter_rtc_automerge.jupyter_rtc_automerge", "Cargo.toml", debug=False)],
    include_package_data=True,
    zip_safe=False,
)
