# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import json
from pathlib import Path

import click
import tomlkit
from jupyter_releaser.util import get_version, run
from pkg_resources import parse_version

LERNA_CMD = "jlpm run lerna version --no-push --force-publish --no-git-tag-version"


def increment_version(current, spec):
    curr = parse_version(current)

    if spec == "major":
        spec = f"{curr.major + 1}.0.0.a0"

    elif spec == "minor":
        spec = f"{curr.major}.{curr.minor + 1}.0.a0"

    elif spec == "release":
        p, x = curr.pre
        if p == "a":
            p = "b"
        elif p == "b":
            p = "rc"
        elif p == "rc":
            p = None
        suffix = f"{p}0" if p else ""
        spec = f"{curr.major}.{curr.minor}.{curr.micro}{suffix}"

    elif spec == "next":
        spec = f"{curr.major}.{curr.minor}."
        if curr.pre:
            p, x = curr.pre
            spec += f"{curr.micro}{p}{x + 1}"
        else:
            spec += f"{curr.micro + 1}"

    elif spec == "patch":
        spec = f"{curr.major}.{curr.minor}."
        if curr.pre:
            spec += f"{curr.micro}"
        else:
            spec += f"{curr.micro + 1}"
    else:
        raise ValueError("Unknown version spec")

    return spec


@click.command()
@click.option("--force", default=False, is_flag=True)
@click.option("--skip-if-dirty", default=False, is_flag=True)
@click.argument("spec", nargs=1)
def bump(force, skip_if_dirty, spec):
    status = run("git status --porcelain").strip()
    if len(status) > 0:
        if skip_if_dirty:
            return
        raise Exception("Must be in a clean git state with no untracked files")

    current = get_version()
    version = parse_version(increment_version(current, spec))

    # convert the Python version
    js_version = f"{version.major}.{version.minor}.{version.micro}"
    if version.pre:
        p, x = version.pre
        p = p.replace("a", "alpha").replace("b", "beta")
        js_version += f"-{p}.{x}"

    # bump the JS packages
    lerna_cmd = f"{LERNA_CMD} {js_version}"
    if force:
        lerna_cmd += " --yes"
    run(lerna_cmd)

    HERE = Path(__file__).parent.parent.resolve()

    project_pins = {}

    # bump the Python packages
    for version_file in HERE.glob("projects/**/_version.py"):
        content = version_file.read_text().splitlines()
        variable, current = content[0].split(" = ")
        if variable != "__version__":
            raise ValueError(
                f"Version file {version_file} has unexpected content;"
                f" expected __version__ assignment in the first line, found {variable}"
            )
        current = current.strip("'\"")
        version_spec = increment_version(current, spec)
        version_file.write_text(f'__version__ = "{version_spec}"\n')
        project = version_file.parent.name
        project_pins[project] = version_spec

    # bump the required version in jupyter-collaboration metapackage
    # to ensure that users can just upgrade `jupyter-collaboration`
    # and get all fixes for free.
    # Formatting based on https://stackoverflow.com/questions/70721025/tomlkit-nicely-formatted-array-with-inline-tables
    metapackage = "jupyter-collaboration"
    metapackage_toml_path = HERE / "projects" / metapackage / "pyproject.toml"
    metapackage_toml = tomlkit.parse(metapackage_toml_path.read_text())
    metapackage_toml.get("project").remove("dependencies")
    dependencies = tomlkit.array()
    for key in sorted(project_pins):
        if key != metapackage.replace("-", "_"):
            dependencies.add_line(key + ">=" + project_pins[key])
    metapackage_toml.get("project").add("dependencies", dependencies.multiline(True))
    metapackage_toml_path.write_text(tomlkit.dumps(metapackage_toml))

    path = HERE.joinpath("package.json")
    if path.exists():
        with path.open(mode="r") as f:
            data = json.load(f)

        data["version"] = js_version

        with path.open(mode="w") as f:
            json.dump(data, f, indent=2)

    else:
        raise FileNotFoundError(f"Could not find package.json under dir {path!s}")


if __name__ == "__main__":
    bump()
