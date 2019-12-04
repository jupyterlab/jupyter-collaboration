# Real Time Collaboration

This monorepo contains current work on Real Time collaboration for use in JupyterLab and other web applications.

* `js/rtc-client`: Real time collaboration client in Javascript, builds on `@lumino/datastore`
* `py/rtc_relay`: Python patch relay server to syncrhonize patches for `js/rtc-client`
* `js/jupyter-rtc`: Holds schema for Jupyter RTC tables that are used in server and client.
* `js/jupyter-rtc-server`: Server to keep datastore in sync with jupyter server.
* `js/jupyter-rtc-client`: Client to access Jupyter data, uses `py/rtc_relay.
