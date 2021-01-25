import React from 'react';
import { render } from 'react-dom';

import AutomergeTextAreaPerf from './AutomergeTextArea';

import './../style/index.css';

render(
  <div>
    <AutomergeTextAreaPerf docId="perf" />
  </div>
  ,
  document.getElementById('root')
);
