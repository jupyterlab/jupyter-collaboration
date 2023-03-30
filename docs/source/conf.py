# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import shutil
import time
from pathlib import Path
from subprocess import check_call

HERE = Path(__file__).parent.resolve()

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

project = "jupyter_collaboration"
copyright = f"2022-{time.localtime().tm_year}, Jupyter Development Team"  # noqa
author = "Jupyter Development Team"
release = "0.3.0"

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

extensions = ["myst_parser", "sphinx.ext.autodoc"]

templates_path = ["_templates"]
exclude_patterns = ["ts/**"]
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

html_extra_path = ["ts"]
html_theme = "pydata_sphinx_theme"
html_logo = "_static/jupyter_logo.svg"
html_favicon = "_static/logo-icon.png"
# Theme options are theme-specific and customize the look and feel of a theme
# further.  For a list of options available for each theme, see the
# documentation.
#
html_theme_options = {
    "logo": {
        "text": "Real-Time Collaboration",
        "image_dark": "jupyter_logo.svg",
        "alt_text": "JupyterLab Real-Time Collaboration",
    },
    "icon_links": [
        {
            "name": "jupyter.org",
            "url": "https://jupyter.org",
            "icon": "_static/jupyter_logo.svg",
            "type": "local",
        }
    ],
    "github_url": "https://github.com/jupyterlab/jupyter_collaboration",
    "use_edit_page_button": True,
    "show_toc_level": 1,
    "navbar_align": "left",
    "navbar_end": ["navbar-icon-links.html"],
    "footer_items": ["copyright.html"],
}

# Output for github to be used in links
html_context = {
    "github_user": "jupyterlab",  # Username
    "github_repo": "jupyter_collaboration",  # Repo name
    "github_version": "main",  # Version
    "conf_py_path": "/docs/source/",  # Path in the checkout to the docs root
}

myst_heading_anchors = 3


def setup(app):
    # Copy changelog.md file
    dest = HERE / "changelog.md"
    shutil.copy(str(HERE.parent.parent / "CHANGELOG.md"), str(dest))

    # Build JavaScript Docs
    js = HERE.parent.parent
    js_docs = HERE / "ts" / "api"
    if js_docs.exists():
        shutil.rmtree(js_docs)

    print("Building JavaScript API docs")
    check_call(["jlpm", "install"], cwd=str(js))
    check_call(["jlpm", "run", "docs"], cwd=str(js))
