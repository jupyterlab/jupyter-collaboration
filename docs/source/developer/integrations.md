# Integrations

## JupyterLab

The overall roadmap for RTC in JupyterLab is defined in the [Real Time Collaboration Plan](https://github.com/jupyterlab/team-compass/issues/30).

The discussions to integrate the RTC components into JupyterLab are tracked in [jupyterlab/rtc#27](https://github.com/jupyterlab/rtc/issues/27).

### Iteration 1

At the beginning of 2019, we had two branches for `JupyterLab 1.0.3` and `Phosphor.js`.

- <https://github.com/vidartf/jupyterlab/tree/rtc>, pushed also to <https://github.com/datalayer-contrib/jupyterlab/tree/rtc-2019>.
- <https://github.com/vidartf/phosphor/commits/feature-tables3-extras>, pushed also to <https://github.com/datalayer-contrib/jupyterlab-lumino/tree/rtc-2019>.

You can try this first iteration with a Dockerfile that lives in <https://github.com/ellisonbg/jupyterlab-rtc>, repository also forked to <https://github.com/datalayer-contrib/jupyterlab-rtc-docker-2019-1>.

```
docker run -p 8888:8888 ellisonbg/jupyterlab-rtc start.sh jupyter lab --dev-mode --no-browser
```

We have ported those changes to August 2020 `JupyterLab` and `Lumino` master in the following 2 branches.

- <https://github.com/datalayer-contrib/jupyterlab/tree/rtc-2019-master>
- <https://github.com/datalayer-contrib/jupyterlab-lumino/tree/rtc-2019-master>

### Iteration 2

A continuation of this work had been done in the second half of 2019. Most of the work for that second attempt is living in:

- A Pull Request <https://github.com/jupyterlab/jupyterlab/pull/6871>
- An Issue <https://github.com/jupyterlab/jupyterlab/issues/5382>

### Iteration 3

We have updated Iteration 2 to August 2020 `JupyterLab` and `Lumino` master branches in the following 2 branches.

- <https://github.com/datalayer-contrib/jupyterlab/tree/rtc-2019-2-master>
- <https://github.com/datalayer-contrib/jupyterlab-lumino/tree/rtc-2019-2-master>

Current status for that:

- The `toc`, `logconsole` and `debugger` extensions have been removed as they have been recently added to JupyterLab code base. If it makes sense, we should update them also.
- TODO the cell split and movement does not work.
- TODO The recently added shadow DOM seems to break the caret collaborator css.

### Next Iteration

The next step is to define how to integrate the components developed in this repository at the light of these learnings.
