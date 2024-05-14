import React, { useState, useRef } from 'react';
import '../style/slider.css';
import { WebSocketProvider } from './yprovider';
import { requestDocFork, requestDocumentTimeline } from './requests';
import { historyIcon } from '@jupyterlab/ui-components';
import { Notification } from '@jupyterlab/apputils';

type Props = {
  apiURL: string;
  provider: WebSocketProvider;
  contentType: string;
  format: string;
};

export const TimelineSliderComponent: React.FC<Props> = ({
  apiURL,
  provider,
  contentType,
  format
}) => {
  const [data, setData] = useState({ roomId: '', timestamps: [] });
  const [currentTimestampIndex, setCurrentTimestampIndex] = useState(
    data.timestamps.length - 1
  );
  const [session, setSession]: any = useState();
  const [forkRoomID, setForkRoomID]: any = useState();
  const [toggle, setToggle] = useState(false);
  const [isBtn, setIsBtn] = useState(false);

  const isFirstChange = useRef(true);

  async function fetchTimeline(notebookPath: string) {
    try {
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
      let data = { roomId: '', timestamps: [] };
      if (text) {
        data = JSON.parse(text);
        setData(data);
        setCurrentTimestampIndex(data.timestamps.length - 1);
      }
      setToggle(true);

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }
  const handleClick = async () => {
    const response = await requestDocFork(
      `${session.format}:${session.type}:${session.fileId}`,
      'undo',
      'restore',
      0
    );
    if (response.code == 200) {
      Notification.success(response.status, { autoClose: 4000 });
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

      // create fork when first using the slider
      if (isFirstChange.current) {
        setIsBtn(true);
        isFirstChange.current = false;
        const obj = await provider.connectToFork(action, 'original', steps);
        setForkRoomID(obj.forkRoomId);
        setSession(obj.session);
      } else if (session && forkRoomID) {
        await requestDocFork(
          `${session.format}:${session.type}:${session.fileId}`,
          action,
          'fork',
          steps
        );
      }
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
    <div className="slider-container">
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
        <div className="timestamp-display">
          <input
            type="range"
            min={0}
            max={data.timestamps.length - 1}
            value={currentTimestampIndex}
            onChange={handleSliderChange}
            className="slider"
            style={{ height: '4.5px' }}
          />
          <div>
            <strong>
              {
                extractFilenameFromURL(apiURL).split('/')[
                  extractFilenameFromURL(apiURL).split('/').length - 1
                ]
              }{' '}
            </strong>{' '}
          </div>
          {isBtn && (
            <div className="restore-btn">
              <button
                onClick={handleClick}
                className="jp-ToolbarButtonComponent restore-btn"
                style={{ background: '#1976d2' }}
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
