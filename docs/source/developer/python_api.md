% Copyright (c) Jupyter Development Team.

% Distributed under the terms of the Modified BSD License.

# Python APIDP

`jupyter_server_ydoc` instantiates {any}`YDocExtension` and stores it under `serverapp.settings` dictionary, under the `"jupyter_server_ydoc"` key.
This instance can be used in other extensions to access the public API methods.

For example, to access a read-only view of the shared notebook model in your jupyter-server extension, you can use the {any}`get_document` method:

```
collaboration = serverapp.settings["jupyter_server_ydoc"]
document = collaboration.get_document(
    path='Untitled.ipynb',
    content_type="notebook",
    file_format="json"
)
content = document.get()
```

## API Reference

```{eval-rst}
.. automodule:: jupyter_server_ydoc.app
  :members:
  :inherited-members:
```

```{eval-rst}
.. automodule:: jupyter_server_ydoc.handlers
  :members:
  :inherited-members:
```
