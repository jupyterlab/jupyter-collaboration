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
const DOC_FORK_URL = 'api/collaboration/undo_redo';
const TIMELINE_URL = 'api/collaboration/timeline';

export const ROOM_FORK_URL = 'api/collaboration/fork';

/**
 * Document session model
 */
export interface ISessionModel {
  /**
   * Document format; 'text', 'base64',...
   */
  format: Contents.FileFormat;
  /**
   * Document type
   */
  type: Contents.ContentType;
  /**
   * File unique identifier
   */
  fileId: string;
  /**
   * Server session identifier
   */
  sessionId: string;
  /**
   * Document session identifier.
   *
   * Identifies the current Yjs history lineage of the document room; it
   * changes whenever the room history is rebuilt from a diverging source
   * (e.g. after a server restart without a persisted YStore, or an
   * out-of-band file change while the room was evicted). Absent when the
   * server predates document sessions.
   */
  documentSessionId?: string | null;
}

/**
 * A document model from the contents REST API.
 */
export interface IContentsModel {
  /**
   * The content of the document.
   */
  content: any;
  /**
   * Hash of the document content on disk, when supported by the server.
   */
  hash?: string | null;
  /**
   * The algorithm used to compute the hash.
   */
  hash_algorithm?: string;
}

/**
 * Fetch the current server-side content (and its hash) of a document
 * through the contents REST API.
 *
 * @param path - The document file path.
 * @param format - The document format (e.g. `'text'` or `'json'`).
 * @param type - The document content type (e.g. `'notebook'`).
 * @param serverSettings - The server settings.
 * @returns The contents model with content and hash.
 */
export async function requestDocumentContent(
  path: string,
  format: string,
  type: string,
  serverSettings?: ServerConnection.ISettings
): Promise<IContentsModel> {
  const settings = serverSettings ?? ServerConnection.makeSettings();
  const params: Record<string, string | number> = {
    content: 1,
    hash: 1,
    type
  };
  if (format === 'text' || format === 'base64') {
    // The contents API only accepts 'text' and 'base64' as the format
    // query parameter; notebooks ('json') must not pass it.
    params.format = format;
  }
  const url =
    URLExt.join(settings.baseUrl, 'api/contents', URLExt.encodeParts(path)) +
    URLExt.objectToQueryString(params);

  // This request typically runs right after a server restart was detected:
  // the browser may try to reuse a dead pooled connection (on which the
  // request would hang indefinitely), and the server may still be coming
  // back up. Both are recoverable, and giving up early is costly - the
  // caller can then no longer tell an out-of-band change from the user's
  // own unsaved edits, and has to fall back to asking the user. So retry,
  // on a dead connection as well as on a server-side error, backing off in
  // between and granting each attempt more time than the last.
  let response: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, 500 * 2 ** (attempt - 1))
      );
    }
    try {
      response = await ServerConnection.makeRequest(
        url,
        { signal: AbortSignal.timeout(8000 * (attempt + 1)) },
        settings
      );
      if (response.status >= 500) {
        lastError = new Error(`Server responded with ${response.status}`);
        response = null;
        continue;
      }
      break;
    } catch (error) {
      lastError = error;
      response = null;
    }
  }
  if (response === null) {
    throw new ServerConnection.NetworkError(lastError as Error);
  }

  let data: any = await response.text();
  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.error('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data as IContentsModel;
}

/**
 * Call the API extension
 *
 * @param endPoint API REST end point for the extension
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
export async function requestAPI<T = any>(
  endPoint = '',
  init: RequestInit = {},
  serverSettings?: ServerConnection.ISettings
): Promise<T> {
  // Make request to Jupyter API
  const settings = serverSettings ?? ServerConnection.makeSettings();
  const requestUrl = URLExt.join(settings.baseUrl, endPoint);

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as any);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.error('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}

export async function requestDocSession(
  format: string,
  type: string,
  path: string,
  serverSettings?: ServerConnection.ISettings
): Promise<ISessionModel> {
  const settings = serverSettings ?? ServerConnection.makeSettings();
  const url = URLExt.join(
    settings.baseUrl,
    DOC_SESSION_URL,
    encodeURIComponent(path)
  );
  const body = {
    method: 'PUT',
    body: JSON.stringify({ format, type })
  };

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(url, body, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as Error);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.log('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}

export async function requestDocumentTimeline(
  format: string,
  type: string,
  path: string,
  serverSettings?: ServerConnection.ISettings
): Promise<any> {
  const settings = serverSettings ?? ServerConnection.makeSettings();

  let url = URLExt.join(settings.baseUrl, TIMELINE_URL, path);
  url = url.concat(`?format=${format}&&type=${type}`);
  const body = {
    method: 'GET'
  };

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(url, body, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as Error);
  }

  return response;
}

export async function requestUndoRedo(
  roomid: string,
  action: 'undo' | 'redo' | 'restore',
  steps: number,
  forkRoom: string,
  serverSettings?: ServerConnection.ISettings
): Promise<any> {
  const settings = serverSettings ?? ServerConnection.makeSettings();
  let url = URLExt.join(
    settings.baseUrl,
    DOC_FORK_URL,
    encodeURIComponent(roomid)
  );

  url = url.concat(`?action=${action}&&steps=${steps}&&forkRoom=${forkRoom}`);

  const body = { method: 'PUT' };

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(url, body, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as Error);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.log('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}
