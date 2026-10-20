import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('页面缺少 #root 挂载点');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
