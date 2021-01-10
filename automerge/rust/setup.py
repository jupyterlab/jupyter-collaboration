from setuptools import setup
from setuptools_rust import RustExtension

setup(
    name="glootalk",
    version="0.1.1",
    packages=["glootalk"],
    author="Anirrudh Krishnan", 
    author_email="akrishnan@quansight.com",
    description='The glootalk python module.',
    url="https://github.com/anirrudh/glootalk",
    rust_extensions=[RustExtension("glootalk.glootalk", "Cargo.toml", debug=False)],
    include_package_data=True,
    zip_safe=False,
)
