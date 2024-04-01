.. Copyright (c) Jupyter Development Team.
.. Distributed under the terms of the Modified BSD License.

Python API
==========

``jupyter_collaboration`` instantiates :any:`YDocExtension` and stores it under ``serverapp.settings`` dictionary, under the ``"jupyter_collaboration"`` key.
This instance can be used in other extensions to access the public API methods.

For example, to access a read-only view of the shared notebook model in your jupyter-server extension, you can use the :any:`get_document` method:

.. code-block::

   collaboration = serverapp.settings["jupyter_collaboration"]
   document = collaboration.get_document(
       path='Untitled.ipynb',
       content_type="notebook",
       file_format="json"
   )
   content = document.get()


API Reference
-------------

.. automodule:: jupyter_collaboration.app
  :members:
  :inherited-members:

.. automodule:: jupyter_collaboration.handlers
  :members:
  :inherited-members:
