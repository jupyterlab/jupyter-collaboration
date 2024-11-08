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
  init: RequestInit = {}
): Promise<T> {
  // Make request to Jupyter API
  const settings = ServerConnection.makeSettings();
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
  path: string
): Promise<ISessionModel> {
  const settings = ServerConnection.makeSettings();
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
  path: string
): Promise<any> {
  const settings = ServerConnection.makeSettings();

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
  forkRoom: string
): Promise<any> {
  const settings = ServerConnection.makeSettings();
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
