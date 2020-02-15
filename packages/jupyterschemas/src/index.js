"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var datastore_1 = require("@lumino/datastore");
// Q: Do we add "refrefsh xxx" method?
// N: Yes.
// Q: Do we fully normalize into tables?
// A: No, only enough to allow collaboration.
//    So anything that might need to be merged should be its own field.
//    Also, we want to minimize the size of diffs.
// Q: Where should selections go?
// A: ?
// Q: Should output refer to cells or vice versa?
// A: ?
// Q: Why does this have to proxy all iopub messages?
// A: So that it can keep kernel state up to date: https://jupyter-client.readthedocs.io/en/stable/messaging.html#request-reply
// Q: Should we use REST or websockets?
// A: https://www.cncf.io/blog/2018/04/12/crcp-the-curiously-reoccurring-communications-pattern/
// https://github.com/wamp-proto/wamp-proto
// https://nats.io/blog/resgate_nats/
exports.TABLES = {
    kernelspecs: {
        // have all as one field instead of many fields, because won't ever change this
        // so having by-field diffs isn't important
        kernelspec: datastore_1.Fields.Register({ value: null })
    },
    status: {
        // Table with only one row
        started: datastore_1.Fields.String(),
        last_activity: datastore_1.Fields.String(),
        connections: datastore_1.Fields.Number(),
        kernels: datastore_1.Fields.Number()
    },
    terminals: {
        name: datastore_1.Fields.String()
    },
    kernels: {
        name: datastore_1.Fields.String(),
        last_activity: datastore_1.Fields.String(),
        connections: datastore_1.Fields.Number(),
        execution_state: datastore_1.Fields.Number()
    },
    sessions: {
        path: datastore_1.Fields.String(),
        name: datastore_1.Fields.String(),
        type: datastore_1.Fields.String(),
        kernel_id: datastore_1.Fields.String()
    },
    contents: {
        name: datastore_1.Fields.String(),
        path: datastore_1.Fields.String(),
        type: datastore_1.Fields.Register({
            value: null
        }),
        writeable: datastore_1.Fields.Boolean(),
        created: datastore_1.Fields.String(),
        last_modified: datastore_1.Fields.String(),
        size: datastore_1.Fields.Register({
            value: null
        }),
        mimetype: datastore_1.Fields.Register({
            value: null
        }),
        format: datastore_1.Fields.Register({
            value: null
        })
    },
    text_content: {
        // Should relation be to content or from this one?
        content_id: datastore_1.Fields.String(),
        content: datastore_1.Fields.Text()
    },
    base64_content: {
        content_id: datastore_1.Fields.String(),
        content: datastore_1.Fields.String()
    },
    folders: {
        content_id: datastore_1.Fields.String(),
        content: datastore_1.Fields.List()
    },
    notebooks: {
        content_id: datastore_1.Fields.String(),
        nbformat: datastore_1.Fields.Number(),
        nbformatMinor: datastore_1.Fields.Number(),
        cells: datastore_1.Fields.List(),
        metadata: datastore_1.Fields.Map()
    },
    cells: {
        attachments: datastore_1.Fields.Map(),
        executionCount: datastore_1.Fields.Register({ value: null }),
        metadata: datastore_1.Fields.Map(),
        mimeType: datastore_1.Fields.String(),
        outputs: datastore_1.Fields.List(),
        text: datastore_1.Fields.Text(),
        trusted: datastore_1.Fields.Boolean(),
        type: datastore_1.Fields.Register({ value: "code" })
    },
    outputs: {
        trusted: datastore_1.Fields.Boolean(),
        type: datastore_1.Fields.String(),
        executionCount: datastore_1.Fields.Register({ value: null }),
        data: datastore_1.Fields.Register({ value: {} }),
        metadata: datastore_1.Fields.Register({ value: {} }),
        raw: datastore_1.Fields.Register({ value: {} })
    }
};
