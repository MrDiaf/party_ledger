import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// Forms use the terse `<label>Text</label><input/>` pattern. Link each such label to the control
// right after it (for screen readers and click-to-focus) instead of threading ids through every form.
let fieldId = 0;
new MutationObserver(() => {
  for (const label of document.querySelectorAll('label:not([for])')) {
    const control = label.nextElementSibling;
    if (control && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) {
      control.id ||= `field-${++fieldId}`;
      label.htmlFor = control.id;
    }
  }
}).observe(document.getElementById('root'), { childList: true, subtree: true });

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
