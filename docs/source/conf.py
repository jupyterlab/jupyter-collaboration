# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import shutil
from pathlib import Path
from subprocess import check_call

HERE = Path(__file__).parent.resolve()

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

project = "jupyterlab_rtc"
copyright = "2022, Jupyter Development Team"
author = "Jupyter Development Team"
release = "0.3.0"

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

extensions = ["myst_parser", "sphinx.ext.autodoc"]

templates_path = ["_templates"]
exclude_patterns = ["_static/api/**"]
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

# html_static_path = ['_static']

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
    "github_url": "https://github.com/jupyterlab/jupyterlab_rtc",
    "use_edit_page_button": True,
    "show_toc_level": 1,
    "navbar_align": "left",
    "navbar_end": ["navbar-icon-links.html"],
    "footer_items": ["copyright.html"],
}

# Output for github to be used in links
html_context = {
    "github_user": "jupyterlab",  # Username
    "github_repo": "jupyterlab_rtc",  # Repo name
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
    js_docs = HERE / "api"
    collaboration = js_docs / "collaboration"
    docprovider = js_docs / "docprovider"
    extension = js_docs / "rtc-extension"
    # dest_dir = Path(app.outdir) / "api"

    print(f"collaboration {collaboration!s}, {collaboration.exists()}")
    print(f"docprovider {docprovider!s}, {docprovider.exists()}")
    print(f"extension {extension!s}, {extension.exists()}")
    if collaboration.exists() and docprovider.exists() and extension.exists():
        # avoid rebuilding docs because it takes forever
        # `make clean` to force a rebuild
        print(f"already have {js_docs!s}")
    else:
        print("Building JavaScript API docs")
        check_call(["npm", "install"], cwd=str(js))
        check_call(["npm", "run", "build"], cwd=str(js))
        check_call(["npm", "run", "docs"], cwd=str(js))

    # Copy JavaScript Docs
    # print(f"Copying {js_docs!s} -> {dest_dir!s}")
    # if dest_dir.exists():
    #    shutil.rmtree(str(dest_dir))
    # shutil.copytree(str(js_docs), str(dest_dir))
