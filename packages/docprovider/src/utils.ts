/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

export enum MessageType {
  ROOM = 124,
  CHAT = 125
}

export enum RoomMessage {
  RELOAD = 0,
  OVERWRITE = 1,
  FILE_CHANGED = 2,
  FILE_OVERWRITTEN = 3,
  DOC_OVERWRITTEN = 4,
  SESSION_TOKEN = 5
}
