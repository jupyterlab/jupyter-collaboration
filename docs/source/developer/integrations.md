# Integrations

## JupyterLab

The overall roadmap is defined in [Real Time Collaboration Plan](https://github.com/jupyterlab/team-compass/issues/30).

### Early 2019 Exploration

At the beginning off 2019, we had two branches for JupyterLab 1.0.3 and Phosphor.js.

- <https://github.com/vidartf/jupyterlab/tree/rtc> (pushed also to <https://github.com/datalayer-contrib/jupyterlab/tree/rtc-2019>)
- <https://github.com/vidartf/phosphor/commits/feature-tables3-extras> (pushed also to <https://github.com/datalayer-contrib/jupyterlab-lumino/tree/rtc-2019>)

You can try them with `docker run -p 8888:8888 ellisonbg/jupyterlab-rtc start.sh jupyter lab --dev-mode --no-browser` (Dockerfile for this lives in <https://github.com/ellisonbg/jupyterlab-rtc>, repository also forked to <https://github.com/datalayer-contrib/jupyterlab-rtc-docker-2019>).

We have ported those changes to latest August 2020 `JupyterLab` and `Lumino` in the folowing branches.

- https://github.com/datalayer-contrib/jupyterlab/tree/rtc-2019-updated
- https://github.com/datalayer-contrib/jupyterlab-lumino/tree/rtc-2019-updated

![JupyterLab 2019 Updated](images/jlab-2019-1-updated.gif "JupyterLab 2019 Updated")

### Late 2019 Exploration

A second attempt has been done in the second half of 2019.

Most of the work for that second attempt is living in [a Pull Request to JupyterLab](https://github.com/jupyterlab/jupyterlab/pull/6871) and is documented in [an Issue](https://github.com/jupyterlab/jupyterlab/issues/5382).

## Next Step

We need to review those two explorations to learn from them and define how to integrate the components developed in this repository at the light of these learnings.

The discussions around this new RTC integration into JupytetrLab are tracked in [jupyterlab/rtc#27](https://github.com/jupyterlab/rtc/issues/27).
