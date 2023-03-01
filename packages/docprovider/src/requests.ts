/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection, Contents } from '@jupyterlab/services';

/**
 * Document session endpoint provided by `jupyter_collaboration`
 * See https://github.com/jupyterlab/jupyter_collaboration
 */
const DOC_SESSION_URL = 'api/collaboration/session';

export interface ISessionModel {
  format: Contents.FileFormat;
  type: Contents.ContentType;
  fileId: string;
  sessionId: string;
}

export async function requestDocSession(
  format: string,
  type: string,
  path: string
): Promise<ISessionModel> {
  const { makeSettings, makeRequest, ResponseError } = ServerConnection;

  const settings = makeSettings();
  const url = URLExt.join(
    settings.baseUrl,
    DOC_SESSION_URL,
    encodeURIComponent(path)
  );
  const data = {
    method: 'PUT',
    body: JSON.stringify({ format, type })
  };

  const response = await makeRequest(url, data, settings);

  if (response.status !== 200 && response.status !== 201) {
    throw new ResponseError(response);
  }

  return response.json();
}
