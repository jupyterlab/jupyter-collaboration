"""myst-parser package setup."""
from importlib import import_module

from setuptools import find_packages, setup

setup(
    name="jupyter-rtc",
    version=import_module("jupyter_rtc").__version__,
    description=(
        "Real Time Collaboration for Jupyter and beyond."
    ),
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/jupyterlb/rct",
    project_urls={"Documentation": "https://jupyter-rtc.readthedocs.io"},
    license="MIT",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.3",
        "Programming Language :: Python :: 3.4",
        "Programming Language :: Python :: 3.5",
        "Programming Language :: Python :: 3.6",
        "Programming Language :: Python :: Implementation :: CPython",
        "Programming Language :: Python :: Implementation :: PyPy",
    ],
    keywords="jupyter rtc",
    python_requires=">=3.6",
    install_requires=[
        "fastapi",
        "typing",
    ],
    extras_require={
        "sphinx": [],
        "code_style": [
            "flake8<3.8.0,>=3.7.0", 
            "black", 
            "pre-commit==1.17.0"
        ],
        "testing": [
            "coverage",
            "pytest>=3.6,<4",
            "pytest-cov",
            "pytest-regressions",
            "beautifulsoup4",
        ],
        # Note: This is only required for internal use
        "rtd": [
            "myst_parser",
            "markdown-it-py~=0.4.5",
            "pyyaml",
            "docutils>=0.15",
            "sphinx>=2,<3",
            "sphinxcontrib-bibtex", 
            "ipython", 
            "sphinx-book-theme", 
            "sphinx_tabs"
        ],
    },
    zip_safe=True,
)