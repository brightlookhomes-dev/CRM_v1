import api, { errorMessage } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { ConfirmDialog } from '../../components/common/Modal.jsx';

/**
 * Shared "are you sure?" flow for every permanent delete.
 * kind: project | bill | update | user. The server independently requires confirm:"DELETE".
 */
const PATH = { project: 'projects', bill: 'bills', update: 'project-updates', user: 'users' };
const WARN = {
  project: 'This permanently erases the project and ALL its updates, decisions, bills, payments, files and assignments. It cannot be undone. (The audit log keeps a record that it happened.)',
  bill: 'This permanently erases the bill, every version and review, and its uploaded files. It cannot be undone.',
  update: 'This permanently erases the update and its photos/documents. Project progress is not rolled back. It cannot be undone.',
  user: 'This permanently erases the login. Users who created records (projects, updates, bills…) cannot be deleted — deactivate them instead.',
};

export default function PermanentDelete({ kind, id, name, onCancel, onDeleted }) {
  const toast = useToast();
  return (
    <ConfirmDialog title={`Permanently delete ${kind}?`} danger confirmText="Delete forever" confirmPhrase="DELETE"
      message={<><strong>Are you sure you want to delete “{name}”?</strong><br />{WARN[kind]}</>}
      onCancel={onCancel}
      onConfirm={async () => {
        try {
          await api.delete(`/${PATH[kind]}/${id}/permanent`, { data: { confirm: 'DELETE' } });
          toast.success(`${kind[0].toUpperCase()}${kind.slice(1)} permanently deleted`);
          onDeleted();
        } catch (e) { toast.error(errorMessage(e)); onCancel(); }
      }} />
  );
}
