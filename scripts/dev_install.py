# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import subprocess
from pathlib import Path
from typing import Optional


def execute(cmd: str, cwd: Optional[Path] = None) -> None:
    subprocess.run(cmd.split(" "), check=True, cwd=cwd)


def install_dev() -> None:
    install_build_deps = "python -m pip install jupyterlab>=4.4.0a2,<5"
    install_js_deps = "jlpm install"

    python_package_prefix = "projects"
    python_packages = ["jupyter-collaboration-ui", "jupyter-docprovider", "jupyter-server-ydoc"]

    execute(install_build_deps)
    execute(install_js_deps)

    for py_package in python_packages:
        real_package_name = py_package.replace("-", "_")
        execute(f"pip uninstall {real_package_name} -y")
        execute(f"pip install -e {python_package_prefix}/{py_package}[test]")

        # List of server extensions
        if py_package in ["jupyter-server-ydoc"]:
            execute(f"jupyter server extension enable {real_package_name}")

        # List of jupyterlab extensions
        if py_package in ["jupyter-collaboration-ui", "jupyter-docprovider"]:
            execute(
                f"jupyter labextension develop --overwrite {python_package_prefix}/{py_package} --overwrite"
            )


if __name__ == "__main__":
    install_dev()
