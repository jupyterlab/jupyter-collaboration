# Jupyter RTC Docs

This folder contains content for the [Jupyter RTC ReadTheDocs website](https://jupyter-rtc.readthedocs.io).

```bash
# Install and build the doc site.
git clone https://github.com/jupyterlab/rtc && \
  cd rtc && \
  pip install -e .[rtd] && \
  cd docs && \
  make html && \
  open build/html/index.html
```
