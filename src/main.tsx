import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { loadPersona, windowTitle } from './persona';

// 11/15 第 54 項：先知道這隻桌寵是誰（名字、稱號、滑桿預設值），再開畫面
loadPersona().finally(() => {
  document.title = windowTitle();
  createRoot(document.getElementById('root')!).render(<App />);
});
