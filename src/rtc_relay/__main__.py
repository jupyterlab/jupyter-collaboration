
from .handler import CollaborationHandler

import tornado.web
import tornado.options

tornado.options.define("port", default=8888, help="run on the given port", type=int)


class Application(tornado.web.Application):
    def __init__(self):
        handlers = [(r"/", CollaborationHandler)]
        super(Application, self).__init__(handlers)



def main():
    tornado.options.parse_command_line()
    app = Application()
    app.listen(tornado.options.options.port)
    tornado.ioloop.IOLoop.current().start()


if __name__ == "__main__":
    main()