import { FileBrowser } from '@/components/files/FileBrowser';

export const metadata = { title: 'Starred' };

export default function StarredPage() {
  return (
    <FileBrowser
      emptyState={{
        title: 'No starred files',
        body: 'Star a file from its row or the preview to keep it within reach.',
        seed: 29,
      }}
    />
  );
}
