import { createRoot } from 'react-dom/client';
import App from './App';
import { syncViewport } from './shared/viewport';
import './styles.css';

const cleanupViewport = syncViewport();
import.meta.hot?.dispose(cleanupViewport);

createRoot(document.getElementById('root')!).render(<App />);
