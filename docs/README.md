# JupyterLab RTC Docs

This folder contains content for the [JupyterLab RTC ReadTheDocs website](https://jupyterlab-rtc.readthedocs.io).

```bash
# Install and build the doc site.
git clone https://github.com/jupyterlab/rtc && \
  cd rtc && \
  pip install -e .[rtd] && \
  cd docs && \
  make html && \
  open build/html/index.html
```
