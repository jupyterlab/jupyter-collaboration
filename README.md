# JupyterLab Real Time Collaboration Plan!


![](./diagram.png)



## `jupyterlab/lumino-datastore`


Includes client and server side components for synchronized CRDTs in the browser.




## `jupyterlab/jupyter-datastore`

The Jupyter Datastore package gives you an up to date data model of the Jupyter Server data structures in your browser. It also provides an interface to take actions on the Jupyter Server.

It is meant to be a building block for any Jupyter web UIs.

Goals:

* Save notebook outputs even when client is closed
* Add undo/redo
* Sync models between browser windows


RTC models in [`./spec.ts`](./spec.ts)

API spec in [`main.py`](./main.py), translated to OpenAPI spec in [`spec.json`](./spec.json) which will be implemented in Node.

---


https://jupyter-client.readthedocs.io/en/stable/messaging.html

http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#/contents/post_api_contents__path_

https://github.com/jupyter/jupyter/wiki/Jupyter-Notebook-Server-API


Generating spec:


```bash
python main.py > spec.json
```