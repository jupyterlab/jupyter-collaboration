# Configuration

By default, any change made to a document is saved to disk in an SQLite database file called
`.jupyter_ystore.db` in the directory where JupyterLab was launched. This file helps in
preserving the timeline of documents, for instance between JupyterLab sessions, or when a user
looses connection and goes offline for a while. You should never have to touch it, and it is
fine to just ignore it, including in your version control system (don't commit this file). If
you happen to delete it, there shouldn't be any serious consequence either.

There are a number of settings that you can change:

```bash
# To enable or disable RTC(Real-Time Collaboration) (default: False).
# If True, RTC will be disabled.
jupyter lab --YDocExtension.disable_rtc=True

# The delay of inactivity (in seconds) after which a document is saved to disk (default: 1).
# If None, the document will never be saved.
jupyter lab --YDocExtension.document_save_delay=0.5

# The period (in seconds) to check for file changes on disk (default: 1).
# If 0, file changes will only be checked when saving.
jupyter lab --YDocExtension.file_poll_interval=2

# The delay (in seconds) to keep a document in memory in the back-end after all clients disconnect (default: 60).
# If None, the document will be kept in memory forever.
jupyter lab --YDocExtension.document_cleanup_delay=100

# The YStore class to use for storing Y updates (default: JupyterSQLiteYStore).
jupyter lab --YDocExtension.ystore_class=pycrdt_websocket.ystore.TempFileYStore
```
