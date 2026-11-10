import { useState } from 'react';
import { fileUrl } from '../../services/api.js';
import { checkFiles } from '../../utils/validators.js';

/** Image thumbnails (click to enlarge) + document links. Files are served by the authenticated API. */
export function AttachmentGallery({ files = [] }) {
  const [open, setOpen] = useState(null);
  const images = files.filter((f) => f.mimeType?.startsWith('image/'));
  const docs = files.filter((f) => !f.mimeType?.startsWith('image/'));
  if (!files.length) return null;
  return (
    <>
      {images.length > 0 && (
        <div className="gallery">
          {images.map((f) => (
            <img key={f.id} src={fileUrl(f.id)} alt={f.name} loading="lazy" tabIndex={0}
              onClick={() => setOpen(f)} onKeyDown={(e) => e.key === 'Enter' && setOpen(f)} />
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="row small" style={{ marginTop: '.5rem' }}>
          {docs.map((f) => <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer">📄 {f.name}</a>)}
        </div>
      )}
      {open && (
        <div className="lightbox" role="dialog" aria-label="Image preview" onClick={() => setOpen(null)} onKeyDown={(e) => e.key === 'Escape' && setOpen(null)} tabIndex={-1}>
          <img src={fileUrl(open.id)} alt={open.name} />
        </div>
      )}
    </>
  );
}

/** File input with client-side type/size checks (server re-validates actual content). */
export function FilePicker({ label, name, multiple, max, files, onChange, accept = 'image/jpeg,image/png,image/webp,application/pdf', error }) {
  const handle = (e) => {
    const list = [...e.target.files];
    const problem = (max && list.length > max ? `Select at most ${max} files` : '') || checkFiles(list);
    onChange(problem ? [] : list, problem);
    if (problem) e.target.value = '';
  };
  return (
    <div className={`field ${error ? 'invalid' : ''}`}>
      <label htmlFor={name}>{label}</label>
      <input autoComplete="off" id={name} name={name} type="file" multiple={multiple} accept={accept} onChange={handle} />
      {files?.length > 0 && <div className="small muted">{files.map((f) => f.name).join(', ')}</div>}
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  );
}
