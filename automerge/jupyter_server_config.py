c.ServerApp.jpserver_extensions = {
  'jupyterlab': True,
  'jupyter_rtc': True,
  'jupyter_auth': True,
}
# from jupyter_auth import github
# c.ServerApp.login_handler_class = github.LoginHandler
c.ServerApp.allow_origin = "*"
c.ServerApp.token = ""
c.ServerProxy.servers = {
  'jupyter_rtc_proxy': {
    'port': 4321,
    'command': ['node', 'packages/server/src/AutomergeServer.js'],
    'absolute_url': False
  }
}
