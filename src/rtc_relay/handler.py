import json
import uuid
import typing
import logging
from tornado import gen, web
from tornado.websocket import WebSocketHandler

from .messages import (
    create_error_reply,
    create_history_reply,
    create_permissions_reply,
    create_serial_reply,
    create_transaction_reply,
    create_transactions_ack,
)
from .collaboration import Collaboration

logger = logging.Logger(__name__)


def filter_duplicates(transactions, is_duplicate):
    for (t, d) in zip(transactions, is_duplicate):
        if not d:
            yield t


class DatastoreHandler:
    collaborations: "typing.Dict[int, Collaboration]" = {}


class WSBaseHandler(WebSocketHandler, DatastoreHandler):
    """Base class for websockets reusing jupyter code"""

    def get_compression_options(self):
        return self.settings.get("websocket_compression_options", None)


class CollaborationHandler(WSBaseHandler):
    """Request handler for the datastore API"""

    def initialize(self) -> None:
        logger.info("Initializing datastore connection %s", self.request.path)
        # Hard code static for now
        self.collaboration = Collaboration("_", self.datastore_file)
        self.store_transaction_serial = -1
        self.history_inited = False

    def check_origin(self, origin):
        return True

    @property
    def datastore_file(self):
        return self.settings.setdefault("datastore_file", ":memory:")

    @property
    def rtc_recovery_timeout(self):
        return self.settings.get("rtc_recovery_timeout", 120)

    def open(self):
        logger.info("Datastore open called...")
        self.collaboration.add_client(self)

        super(CollaborationHandler, self).open()
        logger.info("Opened datastore websocket")

    def cleanup_closed(self) -> None:
        """Cleanup after clean close, or after recovery timeout on unclean close.
        """
        assert self.collaboration
        # Unmark as dangling if needed:
        try:
            self.collaboration.forget_dangling(self)
        except KeyError:
            pass

        if self.datastore_file != ":memory:" and not self.collaboration.has_clients:
            self.collaboration.close()

    def on_close(self) -> None:
        assert self.collaboration
        clean_close = self.close_code in (1000, 1001)
        self.collaboration.remove_client(self)
        if clean_close:
            self.cleanup_closed()
        else:
            # Un-clean close after a store was established
            self.collaboration.mark_dangling(
                self, self.rtc_recovery_timeout, self.cleanup_closed
            )

        super(CollaborationHandler, self).on_close()
        logger.info("Closed datastore websocket")

    def send_error_reply(self, parent_msg_id, reason) -> None:
        msg = create_error_reply(parent_msg_id, reason)
        logger.error(reason)
        self.write_message(json.dumps(msg))

    def on_message(self, message) -> None:
        msg = json.loads(message)
        msg_type = msg.pop("msgType", None)
        msg_id = msg.pop("msgId", None)
        reply = None
        assert self.collaboration

        logger.info(
            "Received datastore message %s: \n%s"
            % (msg_type, json.dumps(msg, indent=2))
        )

        if msg_type == "transaction-broadcast":

            # Get the transactions:
            content = msg.pop("content", None)
            if content is None:
                logger.warning("Malformed transaction broadcast message received")
                return
            transactions = content.pop("transactions", None)
            if transactions is None:
                logger.warning("Malformed transaction broadcast message received")
                return

            # Ensure that transaction serials increment as expected:
            for t in transactions:
                if t["serial"] != self.store_transaction_serial + 1:
                    # TODO: ! Missing a transaction, recover !
                    raise ValueError(
                        "Missing transaction %d from %r"
                        % (self.store_transaction_serial, self)
                    )
                self.store_transaction_serial += 1

            # Check for any duplicates before adding
            is_duplicate = self.collaboration.db.has_transactions(
                t["id"] for t in transactions
            )

            # Add to transaction store, generating a central serial for each
            serials = self.collaboration.db.add_transactions(transactions)

            # Create an acknowledgment message to the source
            reply = create_transactions_ack(msg_id, transactions, serials)
            self.write_message(json.dumps(reply))

            # Broadcast the tranasctions to all other stores
            # First, filter away duplicates
            filtered = filter_duplicates(transactions, is_duplicate)
            self.collaboration.broadcast_transactions(self, filtered, serials)

        elif msg_type == "history-request":

            content = msg.pop("content", {})
            checkpoint_id = content.pop("checkpointId", None)
            history = self.collaboration.db.history(checkpoint_id)
            reply = create_history_reply(
                msg_id, tuple(history.transactions), history.state
            )
            self.write_message(json.dumps(reply))
            self.history_inited = True

        elif msg_type == "transaction-request":
            content = msg.pop("content", None)
            if content is None:
                return
            transactionIds = content.pop("transactionIds", [])
            transactions = tuple(self.collaboration.db.get_transactions(transactionIds))
            reply = create_transaction_reply(msg_id, transactions)
            self.write_message(json.dumps(reply))

        elif msg_type == "serial-request":
            content = msg.pop("content", None)
            if content is None:
                return
            serials = content.pop("serials", [])
            transactions = tuple(self.collaboration.db.get_serials(serials))
            reply = create_serial_reply(msg_id, transactions)
            self.write_message(json.dumps(reply))

        elif msg_type == "permissions-request":
            self.write_message(json.dumps(reply))

        elif msg_type == "serial-update":
            content = msg.pop("content", None)
            if content is None:
                return
            serial = content.pop("serial", None)
            if serial is not None:
                self.collaboration.update_serial(self, serial)
