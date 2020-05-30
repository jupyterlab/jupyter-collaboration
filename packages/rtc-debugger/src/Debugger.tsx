// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Datastore } from "rtc-node";
import { toArray } from "@lumino/algorithm";
import MaterialTable from "material-table";
import * as React from "react";
import { Schema, Table } from "@lumino/datastore";
import AppBar from "@material-ui/core/AppBar";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";
import { useObservableState } from "observable-hooks";

const Debugger: React.FC<{ datastore: Datastore }> = ({ datastore }) => {
  const tables = toArray(datastore.stateDatastore.datastore);

  const [value, setValue] = React.useState(0);
  const handleChange = (
    event: React.ChangeEvent<{}>,
    newValue: number
  ): void => {
    setValue(newValue);
  };
  return (
    <div>
      <AppBar position="static">
        <Tabs value={value} onChange={handleChange}>
          {tables.map(({ schema: { id } }) => (
            <Tab key={id} label={id} />
          ))}
        </Tabs>
      </AppBar>
      {tables.map((table, index) =>
        value === index ? (
          <TableView table={table} key={index} datastore={datastore} />
        ) : (
          <></>
        )
      )}
    </div>
  );
};
export default Debugger;

const TableView: React.FC<{ table: Table<Schema>; datastore: Datastore }> = ({
  table,
  datastore,
}) => {
  useObservableState(datastore.stateDatastore.changed);
  return (
    <MaterialTable
      title='Datastore Debugger'
      columns={[
        { title: "ID", field: "$id" },
        ...Object.keys(table.schema.fields).map((field) => ({
          title: field,
          field,
        })),
      ]}
      data={toArray(table.iter())}
    />
  );
};
