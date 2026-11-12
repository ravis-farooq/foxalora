import { useEffect, useRef } from 'react';
import { Icon, Logo } from '../ui/icons';

export default function About({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);

  return (
    <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dialog about" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <button ref={close} type="button" className="icon-btn dialog-close" aria-label="Close" onClick={onClose}>{Icon.x}</button>
        <Logo size={48} className="brand" />
        <h2 id="about-title">Foxalora Mail</h2>
        <p className="muted">Version 0.1 (prototype)</p>
        <p>
          Your mail stays on your hosting provider’s server. Foxalora reads it when you open it and does not keep a copy.
        </p>
        <p className="muted small">
          Free software under the GNU General Public License v3 or later, with an exception for skins and plugins.
        </p>
      </section>
    </div>
  );
}
