import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import { Alert } from '../common/alert';

const NOTICE_URL =
  'https://pushchain.github.io/push-chain-website/pr-preview/pr-1093/content/notice.json';

type NoticeData = {
  id: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  bodytext: string;
  apps?: string | string[] | null;
  env?: string;
};

type NoticeClientProps = {
  app: string;
};

const NoticeWrapper = styled.div`
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 1200px;
  z-index: 99999;
  display: flex;
  justify-content: center;
  box-sizing: border-box;

  & > * {
    pointer-events: all;
  }
`;

export function NoticeClient({ app }: NoticeClientProps) {
  const [notice, setNotice] = useState<NoticeData | null>(null);

  useEffect(() => {
    fetch(NOTICE_URL)
      .then((res) => res.json())
      .then(setNotice)
      .catch(() => setNotice(null));
  }, []);

  if (!notice) return null;

  let appList: string[] = [];

  if (Array.isArray(notice.apps)) {
    appList = notice.apps.map((a) => a.toLowerCase());
  } else if (typeof notice.apps === 'string') {
    appList = notice.apps.split(',').map((a) => a.trim().toLowerCase());
  }

  const shouldShow =
    appList.includes('*') || appList.includes(app.toLowerCase());

  if (!shouldShow) return null;

  const content = (
    <NoticeWrapper>
      <Alert
        heading={notice.title}
        description={notice.bodytext}
        showIcon
        variant={notice.type || 'info'}
        css={`
          width: 100%;
        `}
        onClose={() => setNotice(null)}
      />
    </NoticeWrapper>
  );

  return ReactDOM.createPortal(content, document.body);
}
