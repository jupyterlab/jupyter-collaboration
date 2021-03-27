# JupyterLab Real Time Collaboration ![.github/workflows/nodejs.yml](https://github.com/jupyterlab/rtc/workflows/.github/workflows/nodejs.yml/badge.svg)

This **Real Time Collaboration** (RTC) monorepo contains work on real-time collaboration for use in JupyterLab solely.

- The current focus is on using the CRDT [Y.js](https://github.com/yjs) library. The development is being done in [jupyter-rtc/jupyterlab](https://github.com/jupyter-rtc/jupyterlab) repository and aims to be merged in the upstream [JupyterLab](https://github.com/jupyterlab/jupyterlab) repository.
- This repository contains works done with the [Lumino](https://github.com/jupyterlab/lumino) and [Automerge](https://github.com/automerge/automerge) CRDT libraries.

For Jupyter cross-components (JupyterLab / Jupyter Server / JupyterHub) RTC implementations, please go to the dedicated repositories hosted in [jupyter-rtc](https://github.com/jupyter-rtc) GitHub organisation.

## Docs

- General considerations around CRDT are available on [https://jupyterlab-rtc.readthedocs.io](https://jupyterlab-rtc.readthedocs.io).
- Specific design and howto for Jupyter cross-components (JupyterLab / Jupyter Server / JupyterHub) are available on [https://jupyter-rtc.readthedocs.io](https://jupyterlab-rtc.readthedocs.io).

## Project Meetings

We have a `bi-weekly` meeting call. Please come and join [on Zoom](https://zoom.us/j/98101649538?pwd=aW15K0gxTHZiQ2tOL21UK21MYmN4QT09). All are welcome to come and just listen or discuss any work related to this project. For the time, place and notes, see [this HackMD](https://hackmd.io/@_4xc7QhhSHKODRQn1uiulw/BkV24I3qL/edit). We also use [the same HackMD](https://hackmd.io/@_4xc7QhhSHKODRQn1uiulw/BkV24I3qL/edit) to set an agenda and to capture notes for these meetings (see [jupyterlab/rtc#3](https://github.com/jupyterlab/rtc/issues/3) for the historical notes). Some meetings have been recorded and are available on [this YouTube playlist](https://www.youtube.com/playlist?list=PLUrHeD2K9Cmk5PpU7a3Pf5zEteJ-_kA81).

## Learning Pathway

We are striving to keep meetings productive and on topic. If you are joining us for the first time or need a refresher about the project's scope, we recommend reading the following documents.

- The [Specifications](https://jupyterlab-rtc.readthedocs.io/en/latest/developer/specs.html): We are working on creating living specifications for the protocol(s) created here. We're doing our best but it may not always be totally in sync with explorations in the repo, until they are settled on.
- The [Design](https://jupyterlab-rtc.readthedocs.io/en/latest/developer/design.html) document.
- The [Architecture](https://jupyterlab-rtc.readthedocs.io/en/latest/developer/architecture.html) document.
- Vision as explained in the [Grant Proposal for CZI](https://jupyterlab-rtc.readthedocs.io/en/latest/organisation/czi-2020.html).

## Contribute

The [contribute](https://jupyterlab-rtc.readthedocs.io/en/latest/organisation/contribute.html) page contains more specific information. To develop on the source code, start with the [instructions for the examples](https://jupyterlab-rtc.readthedocs.io/en/latest/developer/examples.html). We welcome any and all contributions and ideas here! This is a big task and we will need as much help as we can get.
