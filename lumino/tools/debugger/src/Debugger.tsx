// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Schema } from "@lumino/datastore";
import AppBar from "@material-ui/core/AppBar";
import Paper from "@material-ui/core/Paper";
import Tab from "@material-ui/core/Tab";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableContainer from "@material-ui/core/TableContainer";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Tabs from "@material-ui/core/Tabs";
import * as React from "react";
import { useIds, useRecordValue, useSchemas } from "@jupyterlab-rtc/node";

const Debugger: React.FC = () => {
  const schemas = useSchemas();

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
        <Tabs
          value={value}
          onChange={handleChange}
          variant="scrollable"
          scrollButtons="auto"
        >
          {schemas.map(({ id }) => (
            <Tab key={id} label={id} />
          ))}
        </Tabs>
      </AppBar>
      {schemas.map((schema, index) =>
        value === index ? <TableView schema={schema} key={index} /> : <></>
      )}
    </div>
  );
};
export default Debugger;

const TableView: React.FC<{ schema: Schema }> = ({ schema }) => {
  const columns = ["ID", ...Object.keys(schema.fields)];
  const ids = useIds(schema);
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            {columns.map((title) => (
              <TableCell key={title}>{title}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {ids.map((id) => (
            <Row key={id} schema={schema} id={id} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const Row: React.FC<{ schema: Schema; id: string }> = ({ schema, id }) => {
  const value = useRecordValue(schema, id);
  const fields = ["$id", ...Object.keys(schema.fields)];
  return (
    <TableRow>
      {fields.map((field) => (
        <TableCell key={field}>{JSON.stringify(value[field])}</TableCell>
      ))}
    </TableRow>
  );
};
