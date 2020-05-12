
from .handler import CollaborationHandler

import tornado.web
import tornado.options

tornado.options.define("port", default=8888, help="run on the given port", type=int)



def main():
    tornado.options.parse_command_line()
    app = tornado.web.Application([(r"/", CollaborationHandler)], debug=True)
    app.listen(tornado.options.options.port)
    tornado.ioloop.IOLoop.current().start()


if __name__ == "__main__":
    main()