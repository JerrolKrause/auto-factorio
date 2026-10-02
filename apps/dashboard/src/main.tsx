import { createRoot } from 'react-dom/client';
import { App } from './view.js';
import './style.css';
import './workshop.css';
import './workspace.css';
createRoot(document.getElementById('root')!).render(<App />);
