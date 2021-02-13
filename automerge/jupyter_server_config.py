c.ServerApp.jpserver_extensions={
  'jupyterlab': True,
  'jupyter_rtc': True
  }
c.ServerApp.allow_origin="*"
c.ServerApp.token=""
c.ServerProxy.servers = {
  'jupyter_rtc_proxy': {
    'port': 4321,
    'command': ['yarn', 'automerge:start-server'],
    'absolute_url': False
  }
}
