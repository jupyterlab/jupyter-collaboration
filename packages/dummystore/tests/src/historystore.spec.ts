// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/*-----------------------------------------------------------------------------
| Copyright (c) 2014-2019, PhosphorJS Contributors
|
| Distributed under the terms of the BSD 3-Clause License.
|
| The full license is in the file LICENSE, distributed with this software.
|----------------------------------------------------------------------------*/
import {
  expect
} from 'chai';

import {
  Fields,
  ListField,
  MapField,
  RegisterField,
  TextField
} from '@lumino/datastore';

import {
  HistoryStore
} from '../../src';

import {
  MessageLoop
} from '@lumino/messaging';


type CustomMetadata = { id: string };

type TestSchema = {
  id: string;
  fields: {
    content: TextField,
    count: RegisterField<number>,
    enabled: RegisterField<boolean>,
    tags: MapField<string>,
    links: ListField<string>,
    metadata: RegisterField<CustomMetadata>
  }
}

let schema1: TestSchema = {
  id: 'test-schema-1',
  fields: {
    content: Fields.Text(),
    count:Fields.Number(),
    enabled: Fields.Boolean(),
    tags: Fields.Map<string>(),
    links: Fields.List<string>(),
    metadata: Fields.Register<CustomMetadata>({ value: { id: 'identifier' }})
  }
};

let schema2: TestSchema = {
  id: 'test-schema-2',
  fields: {
    content: Fields.Text(),
    count:Fields.Number(),
    enabled: Fields.Boolean(),
    tags: Fields.Map<string>(),
    links: Fields.List<string>(),
    metadata: Fields.Register<CustomMetadata>({ value: { id: 'identifier' }})
  }
};

let state = {
  [schema1.id]: [
    {
      content: 'Lorem Ipsum',
      count: 42,
      enabled: true,
      links: ['www.example.com'],
      metadata: { id: 'myidentifier' }
    }
  ],
  [schema2.id]: [
    {
      content: 'Ipsum Lorem',
      count: 33,
      enabled: false,
      links: ['www.example.com', 'https://github.com/lumino/luminojs'],
      metadata: null
    }
  ]
};

describe('dummystore', () => {

  describe('HistoryStore', () => {

    let datastore: HistoryStore;
    beforeEach(() => {
      datastore = HistoryStore.create({
        schemas: [schema1, schema2],
      });
    });

    afterEach(() => {
      datastore.dispose();
    });

    describe('create()', () => {

      it('should create a new datastore', () => {
        let datastore = HistoryStore.create({ schemas: [schema1] });
        expect(datastore).to.be.instanceof(HistoryStore);
      });

      it('should throw an error for an invalid schema', () => {
        let invalid1 = {
          id: 'invalid-schema',
          fields: {
            '@content': Fields.Text(),
          }
        };
        expect(() => {
          HistoryStore.create({ schemas: [invalid1] });
        }).to.throw(/validation failed/);
        let invalid2 = {
          id: 'invalid-schema',
          fields: {
            '$content': Fields.Text(),
          }
        };
        expect(() => {
          HistoryStore.create({ schemas: [invalid2] });
        }).to.throw(/validation failed/);
      });

    });

    describe('dispose()', () => {

      it('should be safe to call more than once', () => {
        datastore.dispose();
        datastore.dispose();
      });

    });

    describe('isDisposed()', () => {

      it('should indicate whether the datastore is disposed', () => {
        expect(datastore.isDisposed).to.be.false;
        datastore.dispose();
        expect(datastore.isDisposed).to.be.true;
      });

    });

    describe('changed', () => {

      it('should should emit upon changes to the datastore', () => {
        let called = false;
        let id = '';
        datastore.changed.connect((_, change) => {
          called = true;
          expect(change.type).to.equal('transaction');
          expect(change.transactionId).to.equal(id);
          expect(change.storeId).to.equal(0);
          expect(change.change['test-schema-1']).to.not.be.undefined;
          expect(change.change['test-schema-2']).to.be.undefined;
        });
        let t1 = datastore.get(schema1);
        id = datastore.beginTransaction();
        t1.update({ 'my-record': { enabled: true } });
        datastore.endTransaction();
        expect(called).to.be.true;
      });

    });

    describe('id', () => {

      it('should return the default value', () => {
        expect(datastore.id).to.equal(0);
      });

    });

    describe('inTransaction', () => {

      it('should indicate whether the datastore is in a transaction', () => {
        expect(datastore.inTransaction).to.be.false;
        datastore.beginTransaction();
        expect(datastore.inTransaction).to.be.true;
        datastore.endTransaction();
        expect(datastore.inTransaction).to.be.false;
      });

    });

    describe('version', () => {

      it('should increase with each transaction', () => {
        let version = datastore.version;
        let t1 = datastore.get(schema1);
        let t2 = datastore.get(schema2);

        datastore.beginTransaction();
        t2.update({ 'my-record': { enabled: true } });
        datastore.endTransaction();

        expect(datastore.version).to.be.above(version);
        version = datastore.version;

        datastore.beginTransaction();
        t1.update({ 'my-record': { enabled: true } });
        datastore.endTransaction();

        expect(datastore.version).to.be.above(version);
      });

    });

    describe('iter()', () => {

      it('should return an iterator over the tables of the datastore', () => {
        let iterator = datastore.iter();
        let t1 = iterator.next();
        let t2 = iterator.next();
        expect(t1!.schema).to.equal(schema1);
        expect(t2!.schema).to.equal(schema2);
        expect(iterator.next()).to.be.undefined;
      });

    });

    describe('get()', () => {

      it('should return a table for a schema', () => {
        let t1 = datastore.get(schema1);
        let t2 = datastore.get(schema2);
        expect(t1.schema).to.equal(schema1);
        expect(t2.schema).to.equal(schema2);
      });

      it('should throw an error for a nonexistent schema', () => {
        let schema3 = { ...schema2, id: 'new-schema' };
        expect(() => { datastore.get(schema3); }).to.throw(/No table found/);
      });

    });

    describe('beginTransaction()', () => {

      it('should allow for mutations on the datastore', () => {
        let t1 = datastore.get(schema1);
        expect(datastore.inTransaction).to.be.false;
        expect(() => {
          t1.update({ 'my-record': { enabled: true } });
        }).to.throw(/A table can only be updated/);
        datastore.beginTransaction();
        t1.update({ 'my-record': { enabled: true } });
        expect(datastore.inTransaction).to.be.true;
        datastore.endTransaction();
        expect(datastore.inTransaction).to.be.false;
      });

      it('should return a transaction id', () => {
        expect(datastore.beginTransaction()).to.not.equal('');
        datastore.endTransaction();
      });

      it('should throw if called multiple times', () => {
        datastore.beginTransaction();
        expect(() => datastore.beginTransaction()).to.throw(/Already/);
        datastore.endTransaction();
      });

      it('should automatically close a transaction later', async () => {
        datastore.beginTransaction();
        expect(datastore.inTransaction).to.be.true;
        // Flush the message loop to trigger processing of the queue.
        MessageLoop.flush();
        expect(datastore.inTransaction).to.be.false;
      });

    });

    describe('endTransaction()', () => {

      it('should emit a changed signal with the user-facing changes', () => {
        let called = false;
        let id = '';
        datastore.changed.connect((_, change) => {
          called = true;
          expect(change.type).to.equal('transaction');
          expect(change.transactionId).to.equal(id);
          expect(change.storeId).to.equal(0);
          expect(change.change['test-schema-2']).to.not.be.undefined;
          expect(change.change['test-schema-1']).to.be.undefined;
        });
        let t2 = datastore.get(schema2);
        id = datastore.beginTransaction();
        t2.update({ 'my-record': { enabled: true } });
        datastore.endTransaction();
        expect(called).to.be.true;
      });

      it('should throw if there is not a transaction begun', () => {
        expect(() => datastore.endTransaction()).to.throw(/No transaction/);
      });

    });


    describe('undo()', () => {

      it('should throw without anything to undo', async () => {
        let datastore = HistoryStore.create({
          schemas: [schema1, schema2]
        });
        let thrown = false;
        try {
          await datastore.undo('');
        } catch {
          thrown = true;
        } finally {
          expect(thrown).to.be.true;
          datastore.dispose();
        }
      });

      it('should throw if invoked during a transaction',  async () => {
        let thrown = false;
        try {
          datastore.beginTransaction();
          await datastore.undo('');
        } catch {
          thrown = true;
        } finally {
          datastore.endTransaction();
          expect(thrown).to.be.true;
        }
      });

      it('should unapply a transaction by id', async () => {
        let t2 = datastore.get(schema2);
        let id = datastore.beginTransaction();
        t2.update({ 'my-record': { enabled: true } });
        datastore.endTransaction();
        let record = t2.get('my-record')!;
        expect(record.enabled).to.be.true;
        await datastore.undo(id);
        record = t2.get('my-record')!;
        expect(record.enabled).to.be.false;
      });

      it('should emit a changed signal when undoing a change', async () => {
        let t2 = datastore.get(schema2);
        let id = datastore.beginTransaction();
        t2.update({ 'my-record': { enabled: true } });
        datastore.endTransaction();
        let record = t2.get('my-record')!;
        expect(record.enabled).to.be.true;

        let called = false;
        datastore.changed.connect((sender, args) => {
          expect(args.type).to.equal('undo');
          expect(args.transactionId).to.equal(id);
          called = true;
        });
        await datastore.undo(id);
        expect(called).to.be.true;
      });

    });

    describe('redo()', () => {

      it('should throw without anything to redo', async () => {
        let datastore = HistoryStore.create({
          schemas: [schema1, schema2]
        });
        let thrown = false;
        try {
          await datastore.redo('');
        } catch {
          thrown = true;
        } finally {
          expect(thrown).to.be.true;
          datastore.dispose();
        }
      });

      it('should throw if invoked during a transaction',  async () => {
        let thrown = false;
        try {
          datastore.beginTransaction();
          await datastore.redo('');
        } catch {
          thrown = true;
        } finally {
          datastore.endTransaction();
          expect(thrown).to.be.true;
        }
      });

      it('should reapply a transaction by id', async () => {
        let t2 = datastore.get(schema2);
        let id = datastore.beginTransaction();
        t2.update({
          'my-record': {
            enabled: true,
            content: { index: 0, remove: 0, text: 'hello, world' }
          }
        });
        datastore.endTransaction();
        let record = t2.get('my-record')!;
        expect(record.enabled).to.be.true;
        expect(record.content).to.equal('hello, world');
        await datastore.undo(id);
        record = t2.get('my-record')!;
        expect(record.enabled).to.be.false;
        expect(record.content).to.equal('');
        await datastore.redo(id);
        record = t2.get('my-record')!;
        expect(record.enabled).to.be.true;
        expect(record.content).to.equal('hello, world');
      });

      it('should emit a changed signal when redoing a change', async () => {
        let t2 = datastore.get(schema2);
        let id = datastore.beginTransaction();
        t2.update({ 'my-record': { enabled: true } });
        datastore.endTransaction();
        let record = t2.get('my-record')!;
        expect(record.enabled).to.be.true;
        await datastore.undo(id);

        let called = false;
        datastore.changed.connect((sender, args) => {
          expect(args.type).to.equal('redo');
          expect(args.transactionId).to.equal(id);
          called = true;
        });
        await datastore.redo(id);
        expect(called).to.be.true;
      });

    });


  });

});
