<!--
jupyter-ydoc documentation master file, created by
sphinx-quickstart on Wed Nov 23 12:45:39 2022.
You can adapt this file completely to your liking, but it should at least
contain the root `toctree` directive.
-->

# Welcome to JupyterLab Real-Time collaboration documentation!


From JupyterLab v4, file documents and notebooks have collaborative
editing using the [Yjs shared editing framework](https://github.com/yjs/yjs).
Editors are not collaborative by default; to activate it, install the extension
`jupyter_collaboration`.

Installation using mamba/conda:

```sh
mamba install -c conda-forge jupyter-collaboration
```

Installation using pip:

```sh
pip install jupyter-collaboration
```

The new collaborative editing feature enables collaboration in real-time
between multiple clients without user roles. When sharing the URL of a
document to other users, they will have access to the same environment you
are working on (they can e.g. write and execute the cells of a notebook).

Moreover, you can see the cursors from other users with an anonymous
username, a username that will disappear in a few seconds to make room
for what is essential, the document's content.

![Shared cursors](images/rtc_shared_cursors.png)

A nice improvement from Real Time Collaboration (RTC) is that you don't need to worry
about saving a document anymore. It is automatically taken care of: each change made by
any user to a document is saved after one second by default. You can see it with the dirty indicator
being set after a change, and cleared after saving. This even works if the file is modified
outside of JupyterLab's editor, for instance in the back-end with a third-party editor or
after changing branch in a version control system such as `git`. In this case, the file is
watched and any change will trigger the document update within the next second, by default.

Something you need to be aware of is that not all editors in JupyterLab support RTC
synchronization. Additionally, opening the same underlying document using different editor
types currently results in a different type of synchronization.
For example, in JupyterLab, you can open a Notebook using the Notebook
editor or a plain text editor, the so-called Editor. Those editors are
not synchronized through RTC because, under the hood, they use a different model to
represent the document's content, what we call `DocumentModel`. If you
modify a Notebook with one editor, it will update the content in the other editor within
one second, going through the file change detection mentioned above.

Overall, document write access is much more streamlined with RTC. You will never see any warning
message indicating that the file was modified by someone else, and asking if you want to keep
your changes or revert to the saved content. There cannot be any conflict, everyone works in sync
on the same document.


```{toctree}
:maxdepth: 1
:caption: Contents

configuration
developer/contributing
changelog
```
