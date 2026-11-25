import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/index.css';
import App from './App.jsx';
import { SesionProvider } from './context/Sesion.jsx';
import { DialogosProvider } from './context/Dialogos.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SesionProvider>
        <DialogosProvider>
          <App />
        </DialogosProvider>
      </SesionProvider>
    </BrowserRouter>
  </StrictMode>,
);
