/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import React, { useState, useRef } from 'react';
import '../style/slider.css';
import {
  requestUndoRedo,
  requestDocSession,
  requestDocumentTimeline
} from './requests';
import { historyIcon } from '@jupyterlab/ui-components';
import { Notification } from '@jupyterlab/apputils';
import { IForkProvider } from './ydrive';

type Props = {
  apiURL: string;
  provider: IForkProvider;
  contentType: string;
  format: string;
};

export const TimelineSliderComponent: React.FC<Props> = ({
  apiURL,
  provider,
  contentType,
  format
}) => {
  const [data, setData] = useState({
    roomId: '',
    timestamps: [],
    forkRoom: '',
    sessionId: ''
  });
  const [currentTimestampIndex, setCurrentTimestampIndex] = useState(
    data.timestamps.length - 1
  );
  const [toggle, setToggle] = useState(false);
  const [isBtn, setIsBtn] = useState(false);

  const isFirstChange = useRef(true);
  const isFirstSliderChange = useRef(true);
  const sessionRef = useRef<any>(null);

  async function fetchTimeline(notebookPath: string) {
    try {
      if (isFirstChange.current) {
        const response = await requestDocumentTimeline(
          format,
          contentType,
          notebookPath
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Not found');
          } else if (response.status === 503) {
            throw new Error('WebSocket closed');
          } else {
            throw new Error(`Failed to fetch data: ${response.statusText}`);
          }
        }

        const text = await response.text();
        let data = { roomId: '', timestamps: [], forkRoom: '', sessionId: '' };
        if (text) {
          Notification.warning(
            'Document is now in read-only mode. Changes will not be saved.',
            { autoClose: 2500 }
          );

          data = JSON.parse(text);
          setData(data);
          setCurrentTimestampIndex(data.timestamps.length - 1);
          provider.connectToForkDoc(data.forkRoom, data.sessionId);

          sessionRef.current = await requestDocSession(
            format,
            contentType,
            extractFilenameFromURL(apiURL)
          );
        }
        setToggle(true);
        isFirstChange.current = false;

        return data;
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }

  const handleRestore = async () => {
    if (!sessionRef.current) {
      console.error('Session is not initialized');
      return;
    }

    const response = await requestUndoRedo(
      `${sessionRef.current.format}:${sessionRef.current.type}:${sessionRef.current.fileId}`,
      'restore',
      0,
      data.forkRoom
    );

    if (response.code === 200) {
      Notification.success(response.status, { autoClose: 4000 });
      provider.reconnect();
      setToggle(false);
      isFirstChange.current = true;
    } else {
      Notification.error(response.status, { autoClose: 4000 });
    }
  };

  const handleSliderChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const currentTimestamp = parseInt(event.target.value);
    const steps = Math.abs(currentTimestamp - currentTimestampIndex);
    try {
      const action = determineAction(currentTimestamp);
      setCurrentTimestampIndex(currentTimestamp);

      if (isFirstSliderChange.current) {
        setIsBtn(true);
        isFirstSliderChange.current = false;
      }

      if (!sessionRef.current) {
        console.error('Session is not initialized');
        return;
      }

      await requestUndoRedo(
        `${sessionRef.current.format}:${sessionRef.current.type}:${sessionRef.current.fileId}`,
        action,
        steps,
        data.forkRoom
      );
    } catch (error: any) {
      console.error('Error fetching or applying updates:', error);
    }
  };

  function determineAction(currentTimestamp: number): 'undo' | 'redo' {
    return currentTimestamp < currentTimestampIndex ? 'undo' : 'redo';
  }

  function extractFilenameFromURL(url: string): string {
    try {
      const parsedURL = new URL(url);
      const pathname = parsedURL.pathname;
      const segments = pathname.split('/');

      return segments.slice(4 - segments.length).join('/');
    } catch (error) {
      console.error('Invalid URL:', error);
      return '';
    }
  }

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  return (
    <div className="jp-sliderContainer">
      <div
        onClick={() => {
          fetchTimeline(extractFilenameFromURL(apiURL));
        }}
        className="jp-mod-highlighted"
        title="Document Timeline"
      >
        <historyIcon.react marginRight="4px" />
      </div>
      {toggle && (
        <div className="jp-timestampDisplay">
          <input
            type="range"
            min={0}
            max={data.timestamps.length - 1}
            value={currentTimestampIndex}
            onChange={handleSliderChange}
            className="jp-Slider"
          />
          <div>
            <strong>{extractFilenameFromURL(apiURL).split('/').pop()} </strong>{' '}
          </div>
          {isBtn && (
            <div className="jp-restoreBtnContainer">
              <button
                onClick={handleRestore}
                className="jp-ToolbarButtonComponent jp-restoreBtn"
              >
                Restore version{' '}
                {formatTimestamp(data.timestamps[currentTimestampIndex])}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
